"""Low-level HTTP client for the X (Twitter) API v2.

Uses OAuth 2.0 App-Only Bearer Token (read-only). Enforces a single-token
client-side throttle so PAYG accounts don't trip the per-second cap, and
honors `x-rate-limit-reset` on 429 to back off until the bucket refills.
"""

import logging
import threading
import time
from typing import Any

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

logger = logging.getLogger(__name__)

BASE_URL = "https://api.x.com/2"
_REQUEST_TIMEOUT = 30


class XAPIError(Exception):
    """Raised when the X API returns a non-2xx response we can't recover from."""

    def __init__(self, status_code: int, message: str, url: str):
        self.status_code = status_code
        self.url = url
        super().__init__(f"X API {status_code} for {url}: {message}")


class XAPIClient:
    def __init__(self, bearer_token: str, min_request_interval_sec: float = 1.0):
        if not bearer_token:
            raise ValueError("XAPIClient requires a bearer token")
        self._bearer_token = bearer_token
        self._min_interval = min_request_interval_sec
        self._session = self._build_session()
        self._throttle_lock = threading.Lock()
        self._last_request_time = 0.0

    def _build_session(self) -> requests.Session:
        session = requests.Session()
        session.headers.update({
            "Authorization": f"Bearer {self._bearer_token}",
            "Accept": "application/json",
            "User-Agent": "slb-x-api-client/1.0",
        })
        # Retry on transient errors only. 429 is handled explicitly in
        # _handle_response so we can read x-rate-limit-reset and sleep
        # the right amount instead of the urllib3 backoff_factor heuristic.
        retry = Retry(
            total=3,
            backoff_factor=2.0,
            status_forcelist=[500, 502, 503, 504],
            allowed_methods=["GET"],
        )
        adapter = HTTPAdapter(max_retries=retry)
        session.mount("https://", adapter)
        return session

    def _throttle(self) -> None:
        with self._throttle_lock:
            elapsed = time.monotonic() - self._last_request_time
            if elapsed < self._min_interval:
                time.sleep(self._min_interval - elapsed)
            self._last_request_time = time.monotonic()

    def get(self, path: str, params: dict[str, Any] | None = None) -> dict:
        url = f"{BASE_URL}/{path.lstrip('/')}"
        self._throttle()
        resp = self._session.get(url, params=params, timeout=_REQUEST_TIMEOUT)
        return self._handle_response(resp, url, params)

    def _handle_response(
        self,
        resp: requests.Response,
        url: str,
        params: dict[str, Any] | None,
    ) -> dict:
        self._log_rate_limit_headers(resp, url)

        if resp.status_code == 429:
            reset = resp.headers.get("x-rate-limit-reset")
            wait_sec: float
            if reset and reset.isdigit():
                wait_sec = max(0.0, float(reset) - time.time()) + 0.5
            else:
                wait_sec = 15.0
            wait_sec = min(wait_sec, 60.0)  # don't stall workers more than a minute
            logger.warning(
                "X API 429 for %s — sleeping %.1fs then retrying once", url, wait_sec,
            )
            time.sleep(wait_sec)
            self._throttle()
            resp = self._session.get(url, params=params, timeout=_REQUEST_TIMEOUT)
            self._log_rate_limit_headers(resp, url)

        if resp.status_code >= 400:
            raise XAPIError(resp.status_code, resp.text[:500], url)
        return resp.json()

    @staticmethod
    def _log_rate_limit_headers(resp: requests.Response, url: str) -> None:
        remaining = resp.headers.get("x-rate-limit-remaining")
        if remaining is not None:
            try:
                if int(remaining) <= 5:
                    logger.warning(
                        "X API rate-limit low: %s remaining for %s (reset=%s)",
                        remaining, url, resp.headers.get("x-rate-limit-reset"),
                    )
            except ValueError:
                pass
        monthly = resp.headers.get("x-app-limit-24hour-remaining")
        if monthly is not None:
            try:
                if int(monthly) <= 100:
                    logger.warning(
                        "X API monthly cap low: %s reads remaining (24h header)",
                        monthly,
                    )
            except ValueError:
                pass
