"""Per-collection-run file logging.

Attaches a FileHandler to the root logger for the lifetime of one
PipelineRunner.run() call so every log line emitted during that run —
including from worker threads and adapter code — is captured to a file
named after the collection. A stable `latest.log` is rewritten at the
start of each run so `tail -f logs/runs/latest.log` always follows the
most recent run.

File layout::

    logs/runs/<UTC-timestamp>_<collection-id>.log   # unique per run
    logs/runs/latest.log                             # truncated each run

The handler is attached/detached via a context manager so a crash inside
the run still flushes and removes the handler — no leaked file handles.
"""

from __future__ import annotations

import logging
import shutil
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

LOG_DIR = Path("logs") / "runs"
LATEST_NAME = "latest.log"

_FORMAT = "%(asctime)s %(levelname)-7s [%(threadName)s] %(name)s: %(message)s"


@contextmanager
def collection_run_log(collection_id: str, agent_id: str | None = None) -> Iterator[Path]:
    """Attach a per-run FileHandler to the root logger; yield the log path.

    Two handlers are attached: one writes to the unique per-run file
    (append mode) and one to ``latest.log`` (truncated at the start so a
    new run replaces the previous run's contents). Both are removed in
    the ``finally`` so the next run starts clean.
    """
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    short_id = collection_id[:8] if collection_id else "unknown"
    run_path = LOG_DIR / f"{timestamp}_{short_id}.log"
    latest_path = LOG_DIR / LATEST_NAME

    # Truncate latest.log up front. We open in 'w' mode so any prior run's
    # contents are wiped — `tail -f latest.log` will follow the new run.
    latest_handler = logging.FileHandler(latest_path, mode="w", encoding="utf-8")
    run_handler = logging.FileHandler(run_path, mode="a", encoding="utf-8")
    formatter = logging.Formatter(_FORMAT)
    for h in (latest_handler, run_handler):
        h.setLevel(logging.INFO)
        h.setFormatter(formatter)

    root = logging.getLogger()
    # Make sure root captures INFO; if a parent process set it higher, our
    # handlers would never see records.
    if root.level > logging.INFO or root.level == logging.NOTSET:
        root.setLevel(logging.INFO)
    root.addHandler(latest_handler)
    root.addHandler(run_handler)

    header = (
        f"=== run start collection_id={collection_id} "
        f"agent_id={agent_id or '-'} log={run_path} ==="
    )
    logging.getLogger("workers.pipeline.run_logger").info(header)

    try:
        yield run_path
    finally:
        logging.getLogger("workers.pipeline.run_logger").info(
            "=== run end collection_id=%s ===", collection_id,
        )
        for h in (latest_handler, run_handler):
            try:
                root.removeHandler(h)
                h.flush()
                h.close()
            except Exception:  # noqa: BLE001
                pass
        # Mirror the per-run file to latest.log one more time so a reader
        # opening latest.log AFTER the run finishes still sees the full
        # log (latest_handler was truncated then appended-to in lockstep).
        try:
            shutil.copyfile(run_path, latest_path)
        except OSError:
            pass
