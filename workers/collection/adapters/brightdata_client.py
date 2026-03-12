"""Low-level HTTP client for the Bright Data Datasets API.

Handles authentication, retries with exponential backoff, and the
async trigger → poll → download lifecycle.
"""

import json
import logging
import time

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

logger = logging.getLogger(__name__)

_BASE_URL = "https://api.brightdata.com/datasets/v3"
_TRIGGER_TIMEOUT = 120   # Trigger can take 60-90s while BD queues the job
_REQUEST_TIMEOUT = 60    # For poll/status requests
_DOWNLOAD_TIMEOUT = 180  # Snapshot downloads can be large


def _parse_response_data(text: str) -> list[dict]:
    """Parse Bright Data response — handles both JSON array and NDJSON formats."""
    stripped = text.strip()
    if not stripped:
        logger.warning("Empty response body from Bright Data")
        return []

    # Attempt 1: standard JSON (array or single object)
    try:
        data = json.loads(stripped)
        if isinstance(data, list):
            valid = [item for item in data if isinstance(item, dict)]
            if len(valid) < len(data):
                logger.warning("BD response: skipped %d non-dict elements", len(data) - len(valid))
            return valid
        if isinstance(data, dict):
            return [data]
        logger.warning("Unexpected JSON type from BD: %s", type(data).__name__)
        return []
    except json.JSONDecodeError:
        pass

    # Attempt 2: NDJSON (one JSON object per line)
    results: list[dict] = []
    parse_errors = 0
    for line in stripped.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
            if isinstance(obj, dict):
                results.append(obj)
            elif isinstance(obj, list):
                results.extend(item for item in obj if isinstance(item, dict))
        except json.JSONDecodeError:
            parse_errors += 1
            if parse_errors <= 3:
                logger.warning("Skipping malformed NDJSON line: %.200s", line)

    if parse_errors:
        logger.warning("BD NDJSON: %d parse errors out of %d total lines", parse_errors, parse_errors + len(results))
    return results


class BrightDataAPIError(Exception):
    """Raised when Bright Data returns a non-2xx response or a snapshot fails."""

    def __init__(self, status_code: int, message: str, snapshot_id: str | None = None):
        self.status_code = status_code
        self.snapshot_id = snapshot_id
        super().__init__(f"BrightData API {status_code}: {message}")


class BrightDataClient:
    def __init__(
        self,
        api_token: str,
        poll_max_wait_sec: int = 300,
        poll_initial_interval_sec: float = 5.0,
    ):
        self._api_token = api_token
        self._poll_max_wait_sec = poll_max_wait_sec
        self._poll_initial_interval_sec = poll_initial_interval_sec
        self._session = self._build_session()

    def _build_session(self) -> requests.Session:
        session = requests.Session()
        session.headers.update({
            "Authorization": f"Bearer {self._api_token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        })
        retry = Retry(
            total=3,
            backoff_factor=2.0,
            status_forcelist=[429, 500, 502, 503, 504],
            allowed_methods=["GET", "POST"],
        )
        adapter = HTTPAdapter(max_retries=retry)
        session.mount("https://", adapter)
        return session

    def trigger_scrape(
        self,
        dataset_id: str,
        inputs: list[dict],
        discover_by: str = "keyword",
        include_errors: bool = True,
        limit_per_input: int | None = None,
    ) -> str | list[dict]:
        """POST /datasets/v3/scrape. Returns snapshot_id (async) or data list (sync)."""
        params = {
            "dataset_id": dataset_id,
            "type": "discover_new",
            "discover_by": discover_by,
            "notify": "false",
            "include_errors": str(include_errors).lower(),
        }
        if limit_per_input is not None:
            params["limit_per_input"] = str(limit_per_input)
        resp = self._session.post(
            f"{_BASE_URL}/scrape",
            params=params,
            json={"input": inputs},
            timeout=_TRIGGER_TIMEOUT,
        )
        if resp.status_code >= 400:
            raise BrightDataAPIError(resp.status_code, resp.text[:500])

        # Try to parse as single JSON object (async response with snapshot_id)
        try:
            data = resp.json()
            if isinstance(data, dict) and data.get("snapshot_id"):
                logger.info("Bright Data scrape triggered, snapshot_id=%s", data["snapshot_id"])
                return data["snapshot_id"]
            if isinstance(data, list):
                return data
        except (json.JSONDecodeError, ValueError):
            pass

        # Sync response returned as NDJSON or JSON array
        return _parse_response_data(resp.text)

    def poll_snapshot(self, snapshot_id: str) -> dict:
        """GET /datasets/v3/progress/{snapshot_id}. Returns status dict."""
        resp = self._session.get(
            f"{_BASE_URL}/progress/{snapshot_id}",
            timeout=_REQUEST_TIMEOUT,
        )
        if resp.status_code >= 400:
            raise BrightDataAPIError(resp.status_code, resp.text[:500], snapshot_id)
        return resp.json()

    def download_snapshot(self, snapshot_id: str) -> list[dict]:
        """GET /datasets/v3/snapshot/{snapshot_id}. Parses NDJSON or JSON response."""
        resp = self._session.get(
            f"{_BASE_URL}/snapshot/{snapshot_id}",
            timeout=_DOWNLOAD_TIMEOUT,
        )
        if resp.status_code >= 400:
            raise BrightDataAPIError(resp.status_code, resp.text[:500], snapshot_id)

        results = _parse_response_data(resp.text)
        if not results:
            logger.error(
                "Snapshot %s: 0 parseable records. Response length=%d, content-type=%s, first 500 chars: %.500s",
                snapshot_id, len(resp.text), resp.headers.get("Content-Type", "?"), resp.text,
            )
        else:
            logger.info("Downloaded snapshot %s: %d records", snapshot_id, len(results))
        return results

    def scrape_and_wait(
        self,
        dataset_id: str,
        inputs: list[dict],
        discover_by: str = "keyword",
        include_errors: bool = True,
        limit_per_input: int | None = None,
    ) -> list[dict]:
        """High-level: trigger + poll with exponential backoff + download."""
        result = self.trigger_scrape(dataset_id, inputs, discover_by, include_errors, limit_per_input)

        # Sync response — data returned directly
        if isinstance(result, list):
            return result

        # Async — poll until ready
        snapshot_id = result
        interval = self._poll_initial_interval_sec
        elapsed = 0.0
        poll_backoff = 1.5
        max_poll_interval = 30.0

        while elapsed < self._poll_max_wait_sec:
            time.sleep(interval)
            elapsed += interval

            status = self.poll_snapshot(snapshot_id)
            state = status.get("status")
            logger.debug(
                "Polling snapshot %s: status=%s, elapsed=%.0fs",
                snapshot_id, state, elapsed,
            )

            if state == "ready":
                return self.download_snapshot(snapshot_id)
            elif state == "failed":
                raise BrightDataAPIError(
                    0, f"Snapshot {snapshot_id} failed: {status}", snapshot_id
                )

            interval = min(interval * poll_backoff, max_poll_interval)

        raise BrightDataAPIError(
            0,
            f"Polling timed out after {self._poll_max_wait_sec}s for snapshot {snapshot_id}",
            snapshot_id,
        )
