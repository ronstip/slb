"""Interactive CLI to chat with the social listening agent.

Usage:
    uv run python scripts/chat.py

Supports the full product cycle:
  1. Ask a question -> agent calls design_research
  2. Approve config -> agent calls start_collection
  3. Worker runs inline (mock data, no Cloud Tasks needed)
  4. Check progress -> agent calls get_progress
  5. Get insights -> agent calls get_insights, returns narrative + data
  6. Refresh engagements -> agent calls refresh_engagements

Type 'quit' or 'exit' to end the session.
"""

import asyncio
import logging
import os
import sys
from pathlib import Path
from uuid import uuid4

# Ensure project root is on the path so `api` and `workers` packages are importable
_project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_project_root))

# Load .env into os.environ so google-genai Client picks up Vertex AI config
_env_file = _project_root / ".env"
if _env_file.exists():
    for line in _env_file.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip())

from google.genai import types

# Color codes for terminal output
RESET = "\033[0m"
BOLD = "\033[1m"
DIM = "\033[2m"
YELLOW = "\033[33m"
CYAN = "\033[36m"
GREEN = "\033[32m"
RED = "\033[31m"
WHITE = "\033[37m"


def setup_logging():
    logging.basicConfig(
        level=logging.INFO,
        format=f"{DIM}%(asctime)s %(name)s %(levelname)s{RESET} %(message)s",
        datefmt="%H:%M:%S",
    )
    # Quiet down noisy loggers
    logging.getLogger("google").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)


async def run_chat():
    # Import here so .env is loaded before anything else
    from api.agent.agent import APP_NAME, create_runner

    runner = create_runner()
    user_id = "default_user"
    session_id = str(uuid4())

    # Create session
    session = await runner.session_service.create_session(
        app_name=APP_NAME,
        user_id=user_id,
        session_id=session_id,
        state={"user_id": user_id, "session_id": session_id},
    )

    print(f"\n{BOLD}{CYAN}Social Listening Agent{RESET}")
    print(f"{DIM}Session: {session_id}{RESET}")
    print(f"{DIM}Type 'quit' to exit.{RESET}\n")

    while True:
        try:
            user_input = input(f"{BOLD}You:{RESET} ").strip()
        except (EOFError, KeyboardInterrupt):
            print(f"\n{DIM}Goodbye!{RESET}")
            break

        if not user_input:
            continue
        if user_input.lower() in ("quit", "exit"):
            print(f"{DIM}Goodbye!{RESET}")
            break

        content = types.Content(
            role="user", parts=[types.Part.from_text(text=user_input)]
        )

        print(f"\n{BOLD}{GREEN}Agent:{RESET} ", end="", flush=True)

        try:
            async for event in runner.run_async(
                user_id=user_id, session_id=session_id, new_message=content
            ):
                _print_event(event)

        except Exception as e:
            print(f"\n{RED}Error: {e}{RESET}")
            logging.getLogger(__name__).exception("Agent error")

        print()  # blank line after response


def _print_event(event):
    """Print an agent event with color coding."""
    if not event.content or not event.content.parts:
        return

    for part in event.content.parts:
        if part.function_call:
            args_str = ""
            if part.function_call.args:
                args_str = ", ".join(
                    f"{k}={_truncate(str(v), 60)}"
                    for k, v in part.function_call.args.items()
                )
            print(
                f"\n  {YELLOW}[tool] {part.function_call.name}({args_str}){RESET}",
                flush=True,
            )
        elif part.function_response:
            result = part.function_response.response
            status = ""
            if isinstance(result, dict):
                status = result.get("status", "")
                msg = result.get("message", "")
                if msg:
                    status = f"{status}: {_truncate(msg, 100)}"
            print(
                f"  {DIM}[result] {part.function_response.name} -> {status}{RESET}",
                flush=True,
            )
        elif part.text:
            if event.is_final_response():
                print(part.text, end="", flush=True)


def _truncate(s: str, max_len: int) -> str:
    if len(s) <= max_len:
        return s
    return s[: max_len - 3] + "..."


def main():
    setup_logging()
    asyncio.run(run_chat())


if __name__ == "__main__":
    main()
