"""Low-level HTTP client for the Vetric API.

Handles authentication, retries with exponential backoff, and
per-platform base URL routing.
"""

import logging
import time
from typing import Any

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

logger = logging.getLogger(__name__)

_REQUEST_TIMEOUT = 45  # Vetric documents a 48s timeout; 45s gives margin

_BASE_URLS = {
    "instagram": "https://api.vetric.io/instagram/v1",
    "tiktok": "https://api.vetric.io/tiktok/v1",
    "facebook": "https://api.vetric.io/facebook/v1",
    "twitter": "https://api.vetric.io/twitter/v1",
    "reddit": "https://api.vetric.io/reddit/v1",
    "linkedin": "https://api.vetric.io/linkedin/v1",
    "youtube": "https://api.vetric.io/youtube/v1",
}


class VetricAPIError(Exception):
    """Raised when Vetric returns a non-2xx response."""

    def __init__(self, status_code: int, message: str, url: str):
        self.status_code = status_code
        self.url = url
        super().__init__(f"Vetric API {status_code} for {url}: {message}")


class VetricClient:
    def __init__(self, api_keys: dict[str, str]):
        self._api_keys = api_keys
        self._session = self._build_session()
        self._min_interval = 0.5
        self._last_request_time = 0.0

    def _build_session(self) -> requests.Session:
        session = requests.Session()
        session.headers.update({
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

    def _get_api_key(self, platform: str) -> str:
        key = self._api_keys.get(platform)
        if not key:
            raise ValueError(f"No Vetric API key configured for platform: {platform}")
        return key

    def _throttle(self) -> None:
        elapsed = time.monotonic() - self._last_request_time
        if elapsed < self._min_interval:
            time.sleep(self._min_interval - elapsed)
        self._last_request_time = time.monotonic()

    def get(self, platform: str, path: str, params: dict[str, Any] | None = None) -> dict:
        url = f"{_BASE_URLS[platform]}/{path.lstrip('/')}"
        self._throttle()
        headers = {"x-api-key": self._get_api_key(platform)}
        resp = self._session.get(url, params=params, headers=headers, timeout=_REQUEST_TIMEOUT)
        return self._handle_response(resp, url)

    def post(self, platform: str, path: str, body: dict[str, Any] | None = None) -> dict:
        url = f"{_BASE_URLS[platform]}/{path.lstrip('/')}"
        self._throttle()
        headers = {"x-api-key": self._get_api_key(platform)}
        resp = self._session.post(url, json=body, headers=headers, timeout=_REQUEST_TIMEOUT)
        return self._handle_response(resp, url)

    def _handle_response(self, resp: requests.Response, url: str) -> dict:
        if resp.status_code >= 400:
            raise VetricAPIError(resp.status_code, resp.text[:500], url)
        return resp.json()
