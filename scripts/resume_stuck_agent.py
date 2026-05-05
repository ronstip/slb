"""One-off: resume a specific stuck agent run.

Flips agent status back to 'running' and invokes the agent continuation
synchronously. Safe to run repeatedly — the continuation function itself
handles resumption from whatever state the todos are in.
"""
import os
import sys
from pathlib import Path

# Load .env into os.environ before any imports
project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(project_root))

env_path = project_root / ".env"
if env_path.exists():
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())

import asyncio
import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

AGENT_ID = "cd11fc5f-3921-450c-9cb7-9731b524857a"


async def main() -> None:
    from workers.shared.firestore_client import FirestoreClient
    from workers.agent_continuation import _async_agent_continuation
    from config.settings import get_settings

    fs = FirestoreClient(get_settings())
    agent = fs.get_agent(AGENT_ID)
    if not agent:
        print(f"Agent {AGENT_ID} not found")
        return

    print(f"Before: status={agent.get('status')!r} continuation_ready={agent.get('continuation_ready')}")
    print("Flipping status -> running, completed_at -> None")
    fs.update_agent(AGENT_ID, status="running", completed_at=None)
    fs.add_agent_log(AGENT_ID, "Manual resume: continuing agent phase from analyze step", source="continuation")

    print("Invoking continuation (this may take 20-50 minutes)...")
    await _async_agent_continuation(AGENT_ID)
    print("Continuation finished.")


if __name__ == "__main__":
    asyncio.run(main())
