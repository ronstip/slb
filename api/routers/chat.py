"""The /chat SSE endpoint — streams agent events to the client."""

import asyncio
import json
import logging
import threading
import time as _time
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from google.adk.agents.run_config import RunConfig, StreamingMode
from google.genai import types
from sse_starlette.sse import EventSourceResponse

from api.agent.runner_factory import get_runner, resolve_model_alias
from api.auth.dependencies import CurrentUser, get_current_user
from api.rate_limiting import limiter
from api.schemas.requests import ChatRequest
from api.services.artifact_service import (
    persist_tool_result_artifact,
    write_artifact_id_to_event,
)
from api.services.chat_session import (
    refresh_live_state,
    restore_and_flush,
    setup_chat_session,
    window_events_for_llm,
)
from api.services.session_naming import name_session_background
from api.utils.event_parsing import extract_event_data, extract_final_text

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/chat")
@limiter.limit("20/minute")
async def chat(request: Request, chat_request: ChatRequest, user: CurrentUser = Depends(get_current_user)):
    """SSE endpoint — streams agent events to the client."""
    t_start = _time.perf_counter()
    runner = get_runner(model=resolve_model_alias(chat_request.model))
    user_id = user.uid
    session_id = chat_request.session_id or str(uuid4())

    t0 = _time.perf_counter()
    session, flow = await setup_chat_session(runner, user, chat_request, session_id)
    trimmed_prefix = window_events_for_llm(session, flow)
    refresh_live_state(session, user_id)
    logger.info("PERF session_init=%.3fs events=%d", _time.perf_counter() - t0, len(session.events))

    content = types.Content(
        role="user", parts=[types.Part.from_text(text=chat_request.message)]
    )

    if not session.state.get("first_message"):
        session.state["first_message"] = chat_request.message
    session.state["message_count"] = session.state.get("message_count", 0) + 1

    if user.is_anonymous and session.state.get("message_count", 0) > 15:
        raise HTTPException(status_code=429, detail="Sign up for a free account to continue chatting")

    # Track usage in background (3 Firestore writes). Skip while impersonating
    # so we don't pollute the target user's metrics.
    if user.impersonated_by is None:
        from api.services.usage_service import track_query
        threading.Thread(
            target=track_query, args=(user_id, user.org_id, session_id), daemon=True
        ).start()

    logger.info("PERF pre_runner=%.3fs", _time.perf_counter() - t_start)

    async def event_stream():
        _flushed = False
        try:
            run_config = RunConfig(streaming_mode=StreamingMode.SSE)
            streamed_text = False
            streamed_thinking = False
            t_runner_start = _time.perf_counter()
            t_first_token = None

            async for event in runner.run_async(
                user_id=user_id, session_id=session_id, new_message=content,
                run_config=run_config,
            ):
                # Client clicked Stop (or navigated away) → abort the runner
                # before doing more work. Without this the agent keeps emitting
                # events server-side even though no one is reading them.
                if await request.is_disconnected():
                    logger.info("client disconnected, stopping runner for session %s", session_id)
                    break

                is_partial = getattr(event, "partial", None) is True
                if t_first_token is None and is_partial:
                    t_first_token = _time.perf_counter()
                    logger.info("PERF time_to_first_token=%.3fs", t_first_token - t_runner_start)

                if is_partial:
                    if event.content and event.content.parts:
                        for part in event.content.parts:
                            if part.text and getattr(part, "thought", False):
                                thought_text = part.text.strip()
                                if thought_text:
                                    streamed_thinking = True
                                    yield {
                                        "event": "thinking",
                                        "data": json.dumps({
                                            "event_type": "thinking",
                                            "content": thought_text,
                                            "author": event.author,
                                        }),
                                    }
                            elif part.text:
                                streamed_text = True
                                yield {
                                    "event": "partial_text",
                                    "data": json.dumps({
                                        "event_type": "partial_text",
                                        "content": part.text,
                                        "author": event.author,
                                    }),
                                }
                    continue

                for event_data in extract_event_data(event, suppress_text=streamed_text, suppress_thinking=streamed_thinking):
                    et = event_data["event_type"]

                    # Persist artifacts BEFORE yielding so the Firestore
                    # _artifact_id is included in the event sent to the client.
                    if et == "tool_result":
                        tr_name = event_data.get("metadata", {}).get("name", "")
                        tr_result = event_data.get("metadata", {}).get("result", {})
                        if isinstance(tr_result, dict):
                            active_agent_id = session.state.get("active_agent_id") if session else None
                            # Artifact persistence must not tear down the SSE
                            # stream — log and continue without _artifact_id
                            # so the client still receives the tool_result.
                            try:
                                aid = persist_tool_result_artifact(
                                    tr_name, tr_result, user_id, user.org_id, session_id,
                                    agent_id=active_agent_id,
                                )
                            except Exception:
                                logger.exception(
                                    "Artifact persistence failed for tool %s in session %s",
                                    tr_name, session_id,
                                )
                                aid = None
                            if aid:
                                tr_result["_artifact_id"] = aid
                                write_artifact_id_to_event(event, tr_name, aid)

                    yield {
                        "event": et,
                        "data": json.dumps(event_data),
                    }

                    if et == "tool_result":
                        streamed_text = False
                        streamed_thinking = False

                if event.is_final_response():
                    text = extract_final_text(event)
                    session_title = session.state.get("session_title", "New Session")

                    yield {
                        "event": "done",
                        "data": json.dumps({
                            "event_type": "done",
                            "session_id": session_id,
                            "session_title": session_title,
                            "content": text,
                        }),
                    }
                    logger.info(
                        "PERF total=%.3fs runner=%.3fs",
                        _time.perf_counter() - t_start,
                        _time.perf_counter() - t_runner_start,
                    )

                    restore_and_flush(runner, session, trimmed_prefix)
                    _flushed = True

                    asyncio.create_task(
                        name_session_background(runner, user_id, session_id)
                    )

            # If the runner ends without emitting a final_response (e.g., when
            # the before_model_callback stops the ReAct loop after ask_user),
            # we still need to flush so state persists for the next turn.
            if not _flushed:
                restore_and_flush(runner, session, trimmed_prefix)
                _flushed = True

        except Exception as e:
            logger.exception("Error in event stream")
            yield {
                "event": "error",
                "data": json.dumps({"event_type": "error", "content": str(e)}),
            }
        finally:
            if not _flushed:
                logger.warning("event_stream finalizer: flushing session %s (stream interrupted)", session_id)
                try:
                    restore_and_flush(runner, session, trimmed_prefix)
                except Exception:
                    # Last-resort guard: stream interrupted and flush itself
                    # failing. Log and exit — we've already done our best.
                    logger.exception("Failed to flush session %s in finally block", session_id)

    return EventSourceResponse(event_stream())
