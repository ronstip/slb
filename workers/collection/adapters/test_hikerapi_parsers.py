"""Unit tests for the HikerAPI Instagram parsers (native IG media shape)."""

from datetime import datetime, timezone

from workers.collection.adapters.hikerapi_parsers import (
    parse_hikerapi_instagram_channel,
    parse_hikerapi_instagram_post,
)

# A native IG reels-SERP media object (snake_case), trimmed to the fields the
# parser reads. Modeled on the @fifaworldcup-tier viral reels the pilot found.
_HIKER_ITEM = {
    "pk": "3300000000000000001",
    "id": "3300000000000000001_555",
    "code": "C9XYZ",
    "media_type": 2,
    "product_type": "clips",
    "like_count": 358000,
    "comment_count": 4200,
    "play_count": 7800000,
    "taken_at": 1739000000,
    "caption": {"text": "GOAL!! #worldcup"},
    "user": {
        "pk": "555",
        "username": "fifaworldcup",
        "full_name": "FIFA World Cup",
        "is_verified": True,
        "follower_count": 50_000_000,
    },
    "image_versions2": {"candidates": [{"url": "https://cdn.example/thumb.jpg", "width": 720, "height": 1280}]},
    "video_versions": [{"url": "https://cdn.example/video.mp4"}],
}


def test_post_basic_fields():
    post = parse_hikerapi_instagram_post(_HIKER_ITEM)
    assert post.platform == "instagram"
    assert post.post_id == "3300000000000000001"
    assert post.channel_handle == "fifaworldcup"
    assert post.channel_id == "555"
    # Canonical /p/{code}/ form (matches Apify/Vetric → cross-provider dedup).
    assert post.post_url == "https://www.instagram.com/p/C9XYZ/"
    assert post.posted_at == datetime.fromtimestamp(1739000000, tz=timezone.utc)
    assert post.post_type == "video"
    assert post.likes == 358000
    assert post.comments_count == 4200
    assert post.views == 7800000
    assert post.content == "GOAL!! #worldcup"
    assert post.crawl_provider == "hikerapi"
    # IMAGE first (the feed thumbnail), video second (for enrichment download).
    assert post.media_urls[0] == "https://cdn.example/thumb.jpg"
    assert post.media_urls[1] == "https://cdn.example/video.mp4"
    assert post.platform_metadata["product_type"] == "clips"


def test_views_fall_back_to_ig_play_count():
    item = dict(_HIKER_ITEM)
    item.pop("play_count")
    item["ig_play_count"] = 999
    assert parse_hikerapi_instagram_post(item).views == 999


def test_views_fall_back_to_view_count():
    item = {k: v for k, v in _HIKER_ITEM.items() if k not in ("play_count",)}
    item["view_count"] = 12345
    assert parse_hikerapi_instagram_post(item).views == 12345


def test_caption_text_top_level_fallback():
    item = {k: v for k, v in _HIKER_ITEM.items() if k != "caption"}
    item["caption_text"] = "top-level caption"
    assert parse_hikerapi_instagram_post(item).content == "top-level caption"


def test_post_id_hashes_from_url_when_pk_missing():
    item = {k: v for k, v in _HIKER_ITEM.items() if k not in ("pk", "id")}
    post = parse_hikerapi_instagram_post(item)
    assert post.post_id
    assert len(post.post_id) == 16  # _hash_id of the /p/{code}/ url


def test_product_type_feed_uses_media_type_code():
    item = dict(_HIKER_ITEM)
    item["product_type"] = "feed"
    item["media_type"] = 1
    assert parse_hikerapi_instagram_post(item).post_type == "image"
    item["media_type"] = 8
    assert parse_hikerapi_instagram_post(item).post_type == "carousel"


def test_taken_at_string_epoch():
    # The v1 hashtag chunk endpoints return taken_at as a STRING epoch
    # (verified live 2026-06-10) - must parse, not crash.
    item = dict(_HIKER_ITEM)
    item["taken_at"] = "1739000000"
    post = parse_hikerapi_instagram_post(item)
    assert post.posted_at == datetime.fromtimestamp(1739000000, tz=timezone.utc)


def test_taken_at_iso_string_from_chunk_endpoints():
    # REAL shape of hashtag_medias_*_chunk_v1 (verified live 2026-06-11):
    # taken_at is an ISO-8601 string, with the epoch in a separate taken_at_ts.
    # Previously float("2026-...Z") raised -> silent epoch-0 -> dropped by the
    # collection time-window filter (929/1000 posts on collection 61e8797...).
    item = dict(_HIKER_ITEM)
    item["taken_at"] = "2026-06-10T20:10:42Z"
    item["taken_at_ts"] = 1781122242
    post = parse_hikerapi_instagram_post(item)
    assert post.posted_at == datetime.fromtimestamp(1781122242, tz=timezone.utc)


def test_taken_at_ts_preferred_over_iso_string():
    # taken_at_ts (int epoch) is the most robust field - use it when present.
    item = {k: v for k, v in _HIKER_ITEM.items() if k != "taken_at"}
    item["taken_at"] = "2026-06-10T20:10:42Z"
    item["taken_at_ts"] = 1781122242
    assert parse_hikerapi_instagram_post(item).posted_at == datetime.fromtimestamp(
        1781122242, tz=timezone.utc
    )


def test_taken_at_garbage_falls_back_to_epoch_zero():
    item = dict(_HIKER_ITEM)
    item["taken_at"] = "not-a-number"
    post = parse_hikerapi_instagram_post(item)
    assert post.posted_at == datetime.fromtimestamp(0, tz=timezone.utc)


def test_channel_parsing():
    ch = parse_hikerapi_instagram_channel(_HIKER_ITEM)
    assert ch.platform == "instagram"
    assert ch.channel_id == "555"
    assert ch.channel_handle == "fifaworldcup"
    assert ch.channel_url == "https://www.instagram.com/fifaworldcup/"
    assert ch.subscribers == 50_000_000
    assert ch.channel_metadata["verified"] is True
    assert ch.channel_metadata["full_name"] == "FIFA World Cup"
