"""Cross-platform post-URL parsing.

Front-door parser used by the API layer when a user pastes a post URL and asks
us to ingest that specific post. Returns the platform + native post id so the
caller can build a `CreateCollectionRequest` with `post_urls=[...]` and route
through the unified pipeline.

Adapter-internal helpers (e.g. `extract_twitter_id` in `x_api_parsers.py`) stay
where they are — this module is additive, not a refactor. Add a new platform
by registering a parser in `_PARSERS`.
"""

from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class ParsedPostUrl:
    platform: str       # "twitter", "instagram", "tiktok", ...
    post_id: str        # platform-native id
    canonical_url: str  # query string stripped


_X_STATUS_RE = re.compile(r"^(?P<base>https?://(?:www\.)?(?:twitter|x)\.com/[^/?#]+/status/(?P<id>\d+))")


def _twitter(url: str) -> ParsedPostUrl | None:
    m = _X_STATUS_RE.match(url)
    if not m:
        return None
    return ParsedPostUrl(
        platform="twitter",
        post_id=m.group("id"),
        canonical_url=m.group("base"),
    )


_IG_POST_RE = re.compile(
    r"^https?://(?:www\.)?instagram\.com/(?P<kind>p|reel|reels|tv)/(?P<code>[A-Za-z0-9_-]+)"
)


def _instagram(url: str) -> ParsedPostUrl | None:
    m = _IG_POST_RE.match(url)
    if not m:
        return None
    # Normalise /reels/ → /reel/ (singular); instagram.com itself redirects
    # plural to singular. /p/ and /tv/ keep their kind.
    kind = "reel" if m.group("kind") in ("reel", "reels") else m.group("kind")
    code = m.group("code")
    return ParsedPostUrl(
        platform="instagram",
        post_id=code,
        canonical_url=f"https://www.instagram.com/{kind}/{code}/",
    )


# Register new platform parsers here. Order matters only when domains overlap.
_PARSERS = (_twitter, _instagram)


def parse_post_url(url: str) -> ParsedPostUrl | None:
    """Detect platform + post id from a paste-submitted URL.

    Returns None when no registered parser recognises the URL as a single-post
    permalink (search results, profile URLs, and unsupported platforms all
    return None).
    """
    if not url or not isinstance(url, str):
        return None
    url = url.strip()
    if not url:
        return None
    for fn in _PARSERS:
        result = fn(url)
        if result is not None:
            return result
    return None
