"""Shared Cloud Tasks dispatch — used by every endpoint that hands work
off to the worker service.

Was inlined in collection_service.py; extracted so engagement / comments /
any future per-action worker handler can reuse the same wiring (OIDC token,
outbound headers, 30-min dispatch deadline).
"""

import json
import logging

from api.middleware.request_id import outbound_headers
from config.settings import get_settings

logger = logging.getLogger(__name__)


def dispatch_worker_task(path: str, payload: dict) -> None:
    """Dispatch a Cloud Task to the worker service at the given handler path.

    Args:
        path: Worker handler path (must start with '/'), e.g. '/collection/run',
            '/engagement/run', '/comments/run'.
        payload: JSON-serializable body posted to the worker.
    """
    from google.cloud import tasks_v2

    settings = get_settings()
    client = tasks_v2.CloudTasksClient()
    parent = client.queue_path(
        settings.gcp_project_id,
        settings.gcp_region,
        settings.cloud_tasks_queue,
    )
    worker_url = settings.worker_service_url.rstrip("/")
    if not path.startswith("/"):
        path = "/" + path
    http_request = {
        "http_method": tasks_v2.HttpMethod.POST,
        "url": f"{worker_url}{path}",
        "headers": outbound_headers({"Content-Type": "application/json"}),
        "body": json.dumps(payload).encode(),
    }
    if settings.cloud_tasks_service_account:
        http_request["oidc_token"] = {
            "service_account_email": settings.cloud_tasks_service_account,
            "audience": worker_url,
        }
    task = {
        "http_request": http_request,
        # Max allowed by Cloud Tasks (30min). Workers always return 200 so
        # retries won't happen, but this prevents premature timeout.
        "dispatch_deadline": {"seconds": 1800},
    }
    client.create_task(parent=parent, task=task)
    logger.info("Dispatched Cloud Task -> %s", path)
