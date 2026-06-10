"""Tests for media_downloader video handling, esp. Facebook reels/videos.

Facebook video posts arrive as a page URL (facebook.com/reel/...), not a direct
CDN file. download_media must route them through yt-dlp (off post_url) so the real
video lands in GCS, and must NOT store the page URL as a bogus image ref.
"""
from datetime import datetime, timezone

import workers.collection.media_downloader as md
from workers.collection.models import Post


class _FakeGCS:
    """download_from_url fails for page URLs (HTML), succeeds for real image CDNs."""

    def __init__(self, ok_substrings=("i.ytimg.com", "fbcdn.net", "scontent")):
        self.ok_substrings = ok_substrings
        self.calls = []

    def download_from_url(self, url, collection_id, post_id, index):
        self.calls.append(url)
        if any(s in url for s in self.ok_substrings):
            return {
                "gcs_uri": f"gs://bucket/{post_id}_{index}.jpg",
                "media_type": "image",
                "content_type": "image/jpeg",
                "size_bytes": 123,
                "original_url": url,
            }
        return {"gcs_uri": None, "media_type": "unknown", "content_type": "unknown",
                "size_bytes": 0, "original_url": url, "error": "404"}


def _post(**kw):
    base = dict(
        post_id="p1", platform="facebook", channel_handle="c", post_url="",
        posted_at=datetime.fromtimestamp(0, tz=timezone.utc), post_type="text",
        media_urls=[], media_refs=[],
    )
    base.update(kw)
    return Post(**base)


def _fake_ytdlp_ref(post_url):
    return {"gcs_uri": "gs://bucket/p1_yt.mp4", "media_type": "video",
            "content_type": "video/mp4", "size_bytes": 999, "original_url": post_url}


def test_fb_reel_pageurl_routed_to_ytdlp_not_stored_as_image(monkeypatch):
    """scrapeforge style: the reel page URL is in media_urls. It must become a
    GCS video via yt-dlp, never a bogus image ref."""
    called = {}

    def _fake(gcs, url, c, pid, idx):
        called["url"] = url
        return _fake_ytdlp_ref(url)

    monkeypatch.setattr(md, "_download_via_ytdlp", _fake)
    post = _post(
        post_type="video",
        post_url="https://www.facebook.com/reel/4527978807480302/",
        media_urls=["https://www.facebook.com/reel/4527978807480302/"],
    )
    refs = md.download_media(_FakeGCS(), post, "col1")

    assert called["url"] == post.post_url
    assert any(r["media_type"] == "video" and r["gcs_uri"] for r in refs), refs
    # The page URL must NOT be stored as an image
    assert not any(r["media_type"] == "image" and "/reel/" in r.get("original_url", "") for r in refs), refs


def test_fb_video_with_thumbnail_keeps_image_and_adds_video(monkeypatch):
    """page-actor style: media_urls has a real thumbnail; video resolved via post_url."""
    monkeypatch.setattr(md, "_download_via_ytdlp",
                        lambda gcs, url, c, pid, idx: _fake_ytdlp_ref(url))
    post = _post(
        post_type="video",
        post_url="https://www.facebook.com/watch/?v=123",
        media_urls=["https://scontent.fbcdn.net/thumb.jpg"],
    )
    refs = md.download_media(_FakeGCS(), post, "col1")
    assert any(r["media_type"] == "image" and r["gcs_uri"] for r in refs), refs
    assert any(r["media_type"] == "video" for r in refs), refs


def test_fb_image_post_no_ytdlp(monkeypatch):
    """Non-video FB post must not trigger yt-dlp."""
    monkeypatch.setattr(md, "_download_via_ytdlp",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("yt-dlp should not run")))
    post = _post(
        post_type="image",
        post_url="https://www.facebook.com/some/post/1",
        media_urls=["https://scontent.fbcdn.net/img.jpg"],
    )
    refs = md.download_media(_FakeGCS(), post, "col1")
    assert refs and all(r["media_type"] == "image" for r in refs)


def test_tiktok_fallback_preserved(monkeypatch):
    """Existing TikTok page-URL fallback still fires when no CDN video obtained."""
    monkeypatch.setattr(md, "_download_via_ytdlp",
                        lambda gcs, url, c, pid, idx: _fake_ytdlp_ref(url))
    post = _post(
        platform="tiktok", post_type="video",
        post_url="https://www.tiktok.com/@u/video/123",
        media_urls=["https://p16.tiktokcdn.com/thumb.jpg"],
    )
    refs = md.download_media(_FakeGCS(), post, "col1")
    assert any(r["media_type"] == "video" for r in refs), refs
