import json
import logging
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from google.adk.runners import Runner
from google.genai import types
from sse_starlette.sse import EventSourceResponse

from api.agent.agent import APP_NAME, create_runner
from api.schemas.requests import ChatRequest
from api.schemas.responses import CollectionStatusResponse
from config.settings import get_settings
from workers.shared.firestore_client import FirestoreClient

logger = logging.getLogger(__name__)

app = FastAPI(title="Social Listening Platform", version="0.1.0")

_runner: Runner | None = None


def get_runner() -> Runner:
    global _runner
    if _runner is None:
        _runner = create_runner()
    return _runner


@app.post("/chat")
async def chat(request: ChatRequest):
    """SSE endpoint — streams agent events to the client."""
    runner = get_runner()
    user_id = request.user_id
    session_id = request.session_id or str(uuid4())

    # Get or create session
    try:
        session = await runner.session_service.get_session(
            app_name=APP_NAME, user_id=user_id, session_id=session_id
        )
    except Exception:
        session = None

    if session is None:
        session = await runner.session_service.create_session(
            app_name=APP_NAME,
            user_id=user_id,
            session_id=session_id,
            state={"user_id": user_id, "session_id": session_id},
        )

    content = types.Content(
        role="user", parts=[types.Part.from_text(text=request.message)]
    )

    async def event_stream():
        try:
            async for event in runner.run_async(
                user_id=user_id, session_id=session_id, new_message=content
            ):
                # Extract event data
                event_data = _extract_event_data(event)
                if event_data:
                    yield {
                        "event": event_data["event_type"],
                        "data": json.dumps(event_data),
                    }

                if event.is_final_response():
                    text = _extract_text(event)
                    yield {
                        "event": "done",
                        "data": json.dumps(
                            {
                                "event_type": "done",
                                "session_id": session_id,
                                "content": text,
                            }
                        ),
                    }
        except Exception as e:
            logger.exception("Error in event stream")
            yield {
                "event": "error",
                "data": json.dumps({"event_type": "error", "content": str(e)}),
            }

    return EventSourceResponse(event_stream())


@app.get("/collection/{collection_id}", response_model=CollectionStatusResponse)
async def get_collection_status(collection_id: str):
    """Read collection status from Firestore."""
    settings = get_settings()
    fs = FirestoreClient(settings)
    status = fs.get_collection_status(collection_id)
    if not status:
        raise HTTPException(status_code=404, detail="Collection not found")

    return CollectionStatusResponse(
        collection_id=collection_id,
        status=status.get("status", "unknown"),
        posts_collected=status.get("posts_collected", 0),
        posts_enriched=status.get("posts_enriched", 0),
        posts_embedded=status.get("posts_embedded", 0),
        error_message=status.get("error_message"),
        config=status.get("config"),
    )


@app.get("/health")
async def health():
    return {"status": "ok"}


def _extract_event_data(event) -> dict | None:
    """Extract structured data from an ADK event."""
    if not event.content or not event.content.parts:
        return None

    for part in event.content.parts:
        if part.text:
            return {
                "event_type": "text",
                "content": part.text,
                "author": event.author,
            }
        if part.function_call:
            return {
                "event_type": "tool_call",
                "content": part.function_call.name,
                "metadata": {
                    "name": part.function_call.name,
                    "args": dict(part.function_call.args) if part.function_call.args else {},
                },
                "author": event.author,
            }
        if part.function_response:
            return {
                "event_type": "tool_result",
                "content": part.function_response.name,
                "metadata": {
                    "name": part.function_response.name,
                },
                "author": event.author,
            }
    return None


def _extract_text(event) -> str:
    """Extract text content from a final response event."""
    if not event.content or not event.content.parts:
        return ""
    texts = [part.text for part in event.content.parts if part.text]
    return "\n".join(texts)
