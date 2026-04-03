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
        scrape_type: str = "discover_new",
    ) -> str | list[dict]:
        """POST /datasets/v3/scrape (or /trigger for bare requests). Returns snapshot_id or data list."""
        if scrape_type == "bare":
            # Some datasets (e.g. Facebook Groups) don't support discovery params.
            # Use the /trigger endpoint with just dataset_id.
            params = {
                "dataset_id": dataset_id,
                "include_errors": str(include_errors).lower(),
            }
            endpoint = f"{_BASE_URL}/trigger"
            logger.info("BD trigger (bare): dataset=%s, inputs=%d", dataset_id, len(inputs))
        else:
            params = {
                "dataset_id": dataset_id,
                "type": scrape_type,
                "notify": "false",
                "include_errors": str(include_errors).lower(),
            }
            if scrape_type == "discover_new":
                params["discover_by"] = discover_by
            if limit_per_input is not None:
                params["limit_per_input"] = str(limit_per_input)
            endpoint = f"{_BASE_URL}/scrape"
            logger.info("BD scrape: type=%s, discover_by=%s, inputs=%d, limit=%s", scrape_type, discover_by, len(inputs), limit_per_input)
        resp = self._session.post(
            endpoint,
            params=params,
            json=inputs if scrape_type == "bare" else {"input": inputs},
            timeout=_TRIGGER_TIMEOUT,
        )
        if resp.status_code >= 400:
            raise BrightDataAPIError(resp.status_code, resp.text[:500])

        # Try to parse as single JSON object (async response with snapshot_id)
        try:
            data = resp.json()
            if isinstance(data, dict) and data.get("snapshot_id"):
                logger.info("BD snapshot triggered: %s (async)", data["snapshot_id"])
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
        """GET /datasets/v3/snapshot/{snapshot_id}. Parses NDJSON or JSON response.

        BrightData sometimes marks a snapshot as "ready" prematurely, then returns
        {'status': 'building', 'message': 'Dataset is not ready yet, try again in 30s'}
        on the actual download. We detect this and retry up to _DOWNLOAD_BUILD_RETRIES times.
        """
        _DOWNLOAD_BUILD_RETRIES = 6   # 6 × 30s = up to 3 extra minutes
        _DOWNLOAD_BUILD_WAIT = 30     # seconds — matches BD's own suggestion

        for attempt in range(_DOWNLOAD_BUILD_RETRIES + 1):
            t0 = time.monotonic()
            resp = self._session.get(
                f"{_BASE_URL}/snapshot/{snapshot_id}",
                timeout=_DOWNLOAD_TIMEOUT,
            )
            elapsed = time.monotonic() - t0
            if resp.status_code >= 400:
                raise BrightDataAPIError(resp.status_code, resp.text[:500], snapshot_id)

            results = _parse_response_data(resp.text)

            # Detect premature "ready": BD serves a single building-status error object
            if (
                results
                and all(
                    r.get("status") == "building" or r.get("message", "").startswith("Dataset is not ready")
                    for r in results
                )
            ):
                if attempt < _DOWNLOAD_BUILD_RETRIES:
                    logger.warning(
                        "Snapshot %s: BD returned 'building' on download (attempt %d/%d, %.1fs) — "
                        "waiting %ds before retry",
                        snapshot_id, attempt + 1, _DOWNLOAD_BUILD_RETRIES, elapsed, _DOWNLOAD_BUILD_WAIT,
                    )
                    time.sleep(_DOWNLOAD_BUILD_WAIT)
                    continue
                logger.error(
                    "Snapshot %s: still returning 'building' after %d retries — giving up",
                    snapshot_id, _DOWNLOAD_BUILD_RETRIES,
                )
                return []

            if not results:
                logger.error(
                    "Snapshot %s: 0 parseable records (%.1fs). Response length=%d, "
                    "content-type=%s, first 500 chars: %.500s",
                    snapshot_id, elapsed, len(resp.text),
                    resp.headers.get("Content-Type", "?"), resp.text,
                )
            else:
                logger.info(
                    "Downloaded snapshot %s: %d records in %.1fs (attempt %d)",
                    snapshot_id, len(results), elapsed, attempt + 1,
                )
            return results

        return []  # unreachable but satisfies type checker

    def try_download_snapshot(self, snapshot_id: str) -> list[dict] | None:
        """Attempt to download a known snapshot. Returns records if ready, None otherwise."""
        try:
            status = self.poll_snapshot(snapshot_id)
            state = status.get("status")
            if state == "ready":
                return self.download_snapshot(snapshot_id)
            if state == "failed":
                logger.warning("Snapshot %s has failed status", snapshot_id)
                return None
            logger.debug("Snapshot %s not ready yet (status=%s)", snapshot_id, state)
            return None
        except BrightDataAPIError as e:
            logger.warning("Failed to check snapshot %s: %s", snapshot_id, e)
            return None

    def scrape_and_wait(
        self,
        dataset_id: str,
        inputs: list[dict],
        discover_by: str = "keyword",
        include_errors: bool = True,
        limit_per_input: int | None = None,
        snapshot_callback: "callable | None" = None,
        scrape_type: str = "discover_new",
    ) -> list[dict]:
        """High-level: trigger + poll with exponential backoff + download."""
        t_trigger = time.monotonic()
        result = self.trigger_scrape(dataset_id, inputs, discover_by, include_errors, limit_per_input, scrape_type=scrape_type)
        trigger_elapsed = time.monotonic() - t_trigger
        logger.info("BD trigger completed in %.1fs", trigger_elapsed)

        # Sync response — data returned directly
        if isinstance(result, list):
            logger.info("BD sync response: %d records (no polling needed)", len(result))
            return result

        # Async — poll until ready
        snapshot_id = result

        # Persist snapshot ID for crash recovery before polling starts
        if snapshot_callback:
            try:
                snapshot_callback(snapshot_id, dataset_id, discover_by)
            except Exception:
                logger.warning("snapshot_callback failed for %s", snapshot_id, exc_info=True)
        interval = self._poll_initial_interval_sec
        elapsed = 0.0
        poll_backoff = 1.15
        max_poll_interval = 5.0
        last_state = None
        last_log_elapsed = 0.0
        t_poll_start = time.monotonic()

        # Track time spent in "closing" state — BD sometimes stalls here.
        # We attempt early downloads periodically, but NEVER give up — the
        # snapshot may legitimately take a long time to finalize.  We rely on
        # poll_max_wait_sec as the only hard timeout.
        _CLOSING_DOWNLOAD_THRESHOLD = 120  # seconds in "closing" before we try downloading
        closing_entered_at: float | None = None

        while elapsed < self._poll_max_wait_sec:
            time.sleep(interval)
            elapsed += interval

            status = self.poll_snapshot(snapshot_id)
            state = status.get("status")

            # Log on state change or every 30 seconds
            if state != last_state or (elapsed - last_log_elapsed) >= 30:
                logger.info("BD snapshot %s: %s (%.0fs)", snapshot_id, state, elapsed)
                last_state = state
                last_log_elapsed = elapsed

            if state == "ready":
                poll_elapsed = time.monotonic() - t_poll_start
                logger.info("BD snapshot %s ready after %.1fs polling (trigger=%.1fs)", snapshot_id, poll_elapsed, trigger_elapsed)
                records = self.download_snapshot(snapshot_id)
                total_elapsed = time.monotonic() - t_trigger
                logger.info(
                    "BD scrape_and_wait total=%.1fs (trigger=%.1fs poll=%.1fs) → %d records",
                    total_elapsed, trigger_elapsed, poll_elapsed, len(records),
                )
                return records
            elif state == "failed":
                raise BrightDataAPIError(
                    0, f"Snapshot {snapshot_id} failed: {status}", snapshot_id
                )
            elif state == "closing":
                # BD "closing" means data collection finished but the snapshot
                # is being finalised.  If it stays here too long, the data is
                # likely downloadable already — attempt an early download.
                if closing_entered_at is None:
                    closing_entered_at = elapsed
                elif (elapsed - closing_entered_at) >= _CLOSING_DOWNLOAD_THRESHOLD:
                    logger.warning(
                        "BD snapshot %s stuck in 'closing' for %.0fs — attempting download",
                        snapshot_id, elapsed - closing_entered_at,
                    )
                    try:
                        records = self.download_snapshot(snapshot_id)
                        # Filter out BrightData "not ready yet" error items — these look
                        # like real records but are actually status messages indicating the
                        # snapshot isn't actually ready.  Returning them would cause the
                        # caller to retry with a new scrape, creating a cascade of retries.
                        valid_records = [
                            r for r in records
                            if not (isinstance(r, dict) and r.get("status") in ("closing", "building"))
                        ]
                        if valid_records:
                            total_elapsed = time.monotonic() - t_trigger
                            logger.info(
                                "BD early download succeeded: %d records (total=%.1fs)",
                                len(valid_records), total_elapsed,
                            )
                            return valid_records
                        if records:
                            logger.info(
                                "BD early download returned only error items (%d) — will keep polling",
                                len(records),
                            )
                        else:
                            logger.info("BD early download returned 0 records — will keep polling")
                    except BrightDataAPIError as e:
                        logger.info("BD early download failed (%s) — will keep polling", e)
                    # Reset so we don't hammer download every poll cycle
                    closing_entered_at = elapsed
            else:
                # Any other state resets the closing tracker
                closing_entered_at = None

            interval = min(interval * poll_backoff, max_poll_interval)

        raise BrightDataAPIError(
            0,
            f"Polling timed out after {self._poll_max_wait_sec}s for snapshot {snapshot_id}",
            snapshot_id,
        )
