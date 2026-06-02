"""Debug IO callback - full LLM round-trip + tool call/response capture.

Gated by the ``AGENT_DEBUG_LOG`` env var. When set to ``1`` / ``true`` / a
directory path, every model request, model response, tool call, and tool
response in this session is appended as one JSON line to a per-session file:

    <debug_dir>/<session_id>-<started_at>.jsonl

Use this to debug stuck autonomous runs, SQL-variant loops, or unexpected
prompt drift. Off by default; never fires in production unless explicitly
opted in.

Wiring (see ``agent.py``):
    debug_io = make_debug_io_callbacks()
    if debug_io is not None:
        before_model = [debug_io.before_model, ...]
        before_tool  = [..., debug_io.before_tool]
        after_tool   = [..., debug_io.after_tool, ...]
        # Note: ADK has no after_model_callback hook in the public API of
        # the version we use; we capture the response by inspecting the
        # NEXT before_model_callback's contents (the function_response is
        # part of the contents at that point) - see _capture_prior_response.

Output schema (one line per event):
    {
      "ts": ISO-8601 UTC,
      "session_id": str,
      "agent_id": str | None,
      "kind": "model_request" | "tool_call" | "tool_response",
      "agent_name": str,
      "model": str | None,        # model_request only
      "system_instruction": str,  # model_request only, truncated to 8000 chars
      "user_messages": [...],     # model_request only - last 3 user/model turns
      "tool_name": str | None,    # tool events only
      "tool_args": {...},         # tool_call only
      "tool_response": {...},     # tool_response only
      "tool_status": str | None,  # tool_response only
    }

Volume: a 25-call autonomous run produces ~50-80 lines, ~50-200 KB.
"""

from __future__ import annotations

import json
import logging
import os
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from google.adk.agents.callback_context import CallbackContext
from google.adk.models.llm_request import LlmRequest
from google.adk.tools.base_tool import BaseTool
from google.adk.tools.tool_context import ToolContext

logger = logging.getLogger(__name__)

# How many trailing characters of the system instruction to keep per request.
# Full instruction is huge (~30 KB) and rarely changes between turns, so we
# truncate to keep files readable. Bump if you're debugging prompt drift.
_SYSTEM_INSTRUCTION_TRUNC = 8000

# How many of the most recent contents (user / model / function_response
# parts) to capture per model request. Keeps the file scannable.
_RECENT_CONTENTS_KEEP = 6


_write_locks: dict[str, threading.Lock] = {}
_write_locks_master = threading.Lock()


def _get_lock(path: str) -> threading.Lock:
    with _write_locks_master:
        lock = _write_locks.get(path)
        if lock is None:
            lock = threading.Lock()
            _write_locks[path] = lock
        return lock


def _resolve_debug_dir() -> Optional[Path]:
    """Return the debug output directory if AGENT_DEBUG_LOG is enabled.

    Accepted values for AGENT_DEBUG_LOG:
      - "1", "true", "yes", "on" (case-insensitive) - use the default dir
        ``api/agent/evals/runs/_debug/``.
      - any other non-empty string - treated as the directory path.
      - empty / unset - debug logging is OFF, returns None.
    """
    raw = os.environ.get("AGENT_DEBUG_LOG", "").strip()
    if not raw:
        return None
    if raw.lower() in ("0", "false", "no", "off"):
        return None
    if raw.lower() in ("1", "true", "yes", "on"):
        # Default location - same parent as eval runs so it's easy to find.
        default = Path(__file__).resolve().parent / "evals" / "runs" / "_debug"
        default.mkdir(parents=True, exist_ok=True)
        return default
    p = Path(raw)
    p.mkdir(parents=True, exist_ok=True)
    return p


def _resolve_log_path(state: dict, debug_dir: Path) -> Path:
    """Return the file path for this session's debug log.

    Cached on session state under ``_debug_io_path`` to keep the same file
    across all callbacks in one run.
    """
    cached = state.get("_debug_io_path")
    if cached:
        return Path(cached)

    session_id = state.get("session_id") or "no-session"
    started = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    fname = f"{session_id}-{started}.jsonl"
    path = debug_dir / fname
    state["_debug_io_path"] = str(path)
    return path


def _safe_serialize(obj: Any, depth: int = 0) -> Any:
    """Best-effort JSON-safe representation. Strings, dicts, lists pass through."""
    if depth > 6:
        return f"<truncated:{type(obj).__name__}>"
    if obj is None or isinstance(obj, (bool, int, float, str)):
        return obj
    if isinstance(obj, (list, tuple)):
        return [_safe_serialize(x, depth + 1) for x in obj]
    if isinstance(obj, dict):
        return {str(k): _safe_serialize(v, depth + 1) for k, v in obj.items()}
    if hasattr(obj, "isoformat"):
        return obj.isoformat()
    if hasattr(obj, "model_dump"):
        try:
            return _safe_serialize(obj.model_dump(), depth + 1)
        except Exception:
            return repr(obj)
    if hasattr(obj, "__dict__"):
        try:
            return _safe_serialize(vars(obj), depth + 1)
        except Exception:
            return repr(obj)
    return repr(obj)


def _summarize_part(part: Any) -> dict:
    """Pull the interesting fields off a genai Part - text / function_call / function_response."""
    out: dict[str, Any] = {}
    text = getattr(part, "text", None)
    if text:
        out["text"] = text[:2000]
    fc = getattr(part, "function_call", None)
    if fc:
        out["function_call"] = {
            "name": getattr(fc, "name", None),
            "args": _safe_serialize(getattr(fc, "args", None)),
        }
    fr = getattr(part, "function_response", None)
    if fr:
        resp = getattr(fr, "response", None)
        out["function_response"] = {
            "name": getattr(fr, "name", None),
            "response": _safe_serialize(resp),
        }
    thought = getattr(part, "thought", None)
    if thought:
        # Thinking parts can be huge - truncate aggressively.
        thought_text = getattr(part, "text", "") or ""
        out["thought"] = thought_text[:1500]
    return out


def _summarize_content(content: Any) -> dict:
    role = getattr(content, "role", None) or "?"
    parts = getattr(content, "parts", None) or []
    return {"role": role, "parts": [_summarize_part(p) for p in parts]}


def _append_event(path: Path, event: dict) -> None:
    """Append one event line atomically (per-file lock + open-append-close)."""
    lock = _get_lock(str(path))
    line = json.dumps(event, default=str, ensure_ascii=False)
    try:
        with lock:
            with open(path, "a", encoding="utf-8") as f:
                f.write(line + "\n")
    except Exception:
        # Debug logging must never crash a real run.
        logger.exception("debug_io: write failed for %s", path)


# ─── Public callback factory ─────────────────────────────────────────────


@dataclass
class DebugIOCallbacks:
    before_model: Any
    before_tool: Any
    after_tool: Any


def make_debug_io_callbacks() -> Optional[DebugIOCallbacks]:
    """Return debug-IO callbacks if AGENT_DEBUG_LOG is set, otherwise None.

    Caller should check for None and skip wiring if disabled.
    """
    debug_dir = _resolve_debug_dir()
    if debug_dir is None:
        return None

    logger.info("AGENT_DEBUG_LOG enabled - writing to %s", debug_dir)

    def before_model(
        callback_context: CallbackContext,
        llm_request: LlmRequest,
    ):
        """Capture the outgoing model request."""
        state = callback_context.state
        path = _resolve_log_path(state, debug_dir)

        # System instruction: support both str and Content-like objects.
        sys_instr = getattr(llm_request.config, "system_instruction", None) if llm_request.config else None
        if sys_instr is None:
            sys_text = ""
        elif isinstance(sys_instr, str):
            sys_text = sys_instr
        else:
            parts = getattr(sys_instr, "parts", None) or []
            sys_text = "".join(getattr(p, "text", "") or "" for p in parts)
        sys_text_trunc = sys_text[-_SYSTEM_INSTRUCTION_TRUNC:] if len(sys_text) > _SYSTEM_INSTRUCTION_TRUNC else sys_text

        contents = (llm_request.contents or [])[-_RECENT_CONTENTS_KEEP:]

        event = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "session_id": state.get("session_id"),
            "agent_id": state.get("active_agent_id"),
            "kind": "model_request",
            "agent_name": getattr(callback_context, "agent_name", "?"),
            "model": getattr(llm_request, "model", None),
            "system_instruction_tail": sys_text_trunc,
            "system_instruction_total_chars": len(sys_text),
            "recent_contents": [_summarize_content(c) for c in contents],
        }
        _append_event(path, event)
        return None

    def before_tool(
        tool: BaseTool,
        args: dict[str, Any],
        tool_context: ToolContext,
    ):
        state = tool_context.state
        path = _resolve_log_path(state, debug_dir)
        event = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "session_id": state.get("session_id"),
            "agent_id": state.get("active_agent_id"),
            "kind": "tool_call",
            "agent_name": getattr(tool_context, "agent_name", "?"),
            "tool_name": tool.name,
            "tool_args": _safe_serialize(args),
        }
        _append_event(path, event)
        return None

    def after_tool(
        tool: BaseTool,
        args: dict[str, Any],
        tool_context: ToolContext,
        tool_response: dict,
    ):
        state = tool_context.state
        path = _resolve_log_path(state, debug_dir)
        status = (
            tool_response.get("status") if isinstance(tool_response, dict) else None
        )
        event = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "session_id": state.get("session_id"),
            "agent_id": state.get("active_agent_id"),
            "kind": "tool_response",
            "agent_name": getattr(tool_context, "agent_name", "?"),
            "tool_name": tool.name,
            "tool_status": status,
            "tool_response": _safe_serialize(tool_response),
        }
        _append_event(path, event)
        return None

    return DebugIOCallbacks(
        before_model=before_model,
        before_tool=before_tool,
        after_tool=after_tool,
    )
