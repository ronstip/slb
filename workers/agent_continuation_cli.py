"""CLI entry for running agent continuation as an independent subprocess.

Usage: python -m workers.agent_continuation_cli <agent_id>

Why a separate process: in dev, uvicorn `--reload` kills daemon threads when
source files change, leaving the agent stuck in `status=running` with no
worker driving it. A subprocess is detached from uvicorn's lifecycle, so
file edits don't interrupt the run.
"""
import logging
import sys

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)


def main() -> None:
    if len(sys.argv) != 2:
        print("usage: python -m workers.agent_continuation_cli <agent_id>", file=sys.stderr)
        sys.exit(2)
    agent_id = sys.argv[1]

    from workers.agent_continuation import _run_agent_continuation
    _run_agent_continuation(agent_id)


if __name__ == "__main__":
    main()
