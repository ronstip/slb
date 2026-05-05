"""Unit tests for Apify dataset → Post/Channel parsers.

Fixtures are minimal frozen samples that mirror the shape each actor returns.
If an actor's output schema changes, update the fixture and adjust the
parser — the registry will catch missing parsers at adapter init time.
"""

from datetime import datetime, timezone

import pytest

from workers.collection.adapters.apify_parsers import (
    _PARSER_REGISTRY,
    get_parsers,
    parse_apidojo_ig_hashtag_channel,
    parse_apidojo_ig_hashtag_post,
    parse_apify_instagram_channel,
    parse_apify_instagram_post,
    parse_clockworks_tiktok_channel,
    parse_clockworks_tiktok_post,
    parse_scrapeforge_facebook_channel,
    parse_scrapeforge_facebook_post,
)


# ---------------------------------------------------------------------------
# Fixtures — captured from real actor runs (smoke_apify_out.json).
# ---------------------------------------------------------------------------

_IG_FIXTURE = {
    "inputUrl": "https://www.instagram.com/explore/tags/photography/",
    "id": "3411111111111111111",
    "shortCode": "C5XXX",
    "url": "https://www.instagram.com/p/C5XXX/",
    "type": "Sidecar",
    "caption": "Hello world #foo",
    "hashtags": ["foo"],
    "mentions": [],
    "timestamp": "2026-04-15T10:30:00.000Z",
    "ownerUsername": "alice",
    "ownerFullName": "Alice Example",
    "ownerId": "555",
    "ownerIsVerified": True,
    "ownerFollowersCount": 1234,
    "displayUrl": "https://scontent.cdninstagram.com/img.jpg",
    "images": [],
    "likesCount": 42,
    "commentsCount": 7,
    "videoViewCount": None,
    "productType": "feed",
}


# apidojo/instagram-hashtag-scraper output shape — captured 2026-05-05 from
# logs/runs/pilot_apidojo_ig_climate_*.json. Differs from the legacy shape:
# singular likeCount/commentCount, nested owner.{id,username,fullName},
# nested image.url / video.{playCount,url}, ISO createdAt, and `type="post"`
# with isVideo/isCarousel booleans encoding the actual media type.
_IG_APIDOJO_IMAGE_FIXTURE = {
    "inputSource": "https://www.instagram.com/explore/tags/climate/",
    "id": "3890140629775419536",
    "code": "DX8jkq8FAiQ",
    "url": "https://www.instagram.com/p/DX8jkq8FAiQ/",
    "createdAt": "2026-05-05T06:02:05.000Z",
    "likeCount": 27,
    "commentCount": 1,
    "caption": "Image post about #climate",
    "isAvailable": True,
    "isVideo": False,
    "isCarousel": False,
    "type": "post",
    "owner": {
        "id": "6619572681",
        "username": "progressivepower",
        "fullName": "Progressive Power",
        "isPrivate": False,
        "isVerified": False,
    },
    "image": {"url": "https://scontent.cdninstagram.com/img.jpg", "width": 1318, "height": 1648},
}


_IG_APIDOJO_VIDEO_FIXTURE = {
    "inputSource": "https://www.instagram.com/explore/tags/climate/",
    "id": "3890218057409399637",
    "code": "DX81LZCsotV",
    "url": "https://www.instagram.com/p/DX81LZCsotV/",
    "createdAt": "2026-05-05T08:47:10.000Z",
    "likeCount": 13,
    "commentCount": 0,
    "caption": "Reel about climate",
    "isAvailable": True,
    "isVideo": True,
    "isCarousel": False,
    "type": "post",
    "owner": {
        "id": "3087465",
        "username": "suepr",
        "fullName": "Sue Pritchard",
        "isPrivate": False,
        "isVerified": False,
    },
    "video": {
        "id": "1308744247470282v",
        "url": "https://scontent.cdninstagram.com/clip.mp4",
        "playCount": 4823,
        "duration": 238,
        "width": 1080,
        "height": 1920,
    },
}


_FB_FIXTURE = {
    "post_id": "fb_post_123",
    "type": "post",
    "url": "https://www.facebook.com/groups/123/posts/fb_post_123/",
    "message": "A facebook post",
    "message_rich": "A facebook post",
    "timestamp": 1745000000,  # 2025-04-18 UTC-ish
    "comments_count": 12,
    "reactions_count": 100,
    "reshare_count": 5,
    "reactions": {"like": 80, "love": 20, "haha": 0, "wow": 0, "sad": 0, "angry": 0, "care": 0},
    "author": {
        "id": "page_42",
        "name": "Some Page",
        "url": "https://www.facebook.com/somepage",
        "profile_picture_url": "https://scontent.fb.com/avatar.jpg",
    },
    "image": "https://scontent.fb.com/img.jpg",
    "video": None,
    "video_files": None,
    "associated_group_id": "123",
}


_TIKTOK_FIXTURE = {
    "id": "7300000000000000001",
    "text": "tiktok caption #tag",
    "textLanguage": "en",
    "createTime": 1713607200,
    "createTimeISO": "2026-04-20T14:00:00Z",
    "isAd": False,
    "isSlideshow": False,
    "webVideoUrl": "https://www.tiktok.com/@bob/video/7300000000000000001",
    "authorMeta": {
        "id": "user42",
        "name": "bob",
        "nickName": "Bob",
        "profileUrl": "https://www.tiktok.com/@bob",
        "avatar": "https://p16.tiktok.com/avatar.jpg",
        "fans": 9000,
        "video": 120,
        "verified": False,
        "signature": "hi",
    },
    "videoMeta": {
        "coverUrl": "https://p16.tiktok.com/cover.jpg",
        "downloadAddr": "https://...",
        "duration": 30,
        "height": 1280,
        "width": 720,
    },
    "musicMeta": {"musicName": "song", "musicAuthor": "artist"},
    "diggCount": 500,
    "shareCount": 10,
    "commentCount": 25,
    "playCount": 12000,
    "collectCount": 8,
    "hashtags": [{"name": "tag"}],
    "mentions": [],
    "searchQuery": "recipes",
}


# ---------------------------------------------------------------------------
# Instagram
# ---------------------------------------------------------------------------

def test_instagram_post_basic_fields():
    post = parse_apify_instagram_post(_IG_FIXTURE)
    assert post.platform == "instagram"
    assert post.post_id == "3411111111111111111"
    assert post.channel_handle == "alice"
    assert post.channel_id == "555"
    assert post.post_url == "https://www.instagram.com/p/C5XXX/"
    assert post.posted_at == datetime(2026, 4, 15, 10, 30, tzinfo=timezone.utc)
    assert post.post_type == "carousel"
    assert post.likes == 42
    assert post.comments_count == 7
    assert post.crawl_provider == "apify"
    assert "scontent.cdninstagram.com" in post.media_urls[0]
    assert post.platform_metadata["hashtags"] == ["foo"]
    assert post.platform_metadata["input_url"].endswith("/photography/")


def test_instagram_post_falls_back_to_hashed_id_when_no_id():
    item = dict(_IG_FIXTURE)
    item["id"] = None
    post = parse_apify_instagram_post(item)
    assert post.post_id  # not empty
    assert len(post.post_id) == 16  # _hash_id length


def test_instagram_video_views_prefers_videoPlayCount():
    item = dict(_IG_FIXTURE)
    item["type"] = "Video"
    item["videoPlayCount"] = 12000
    item["videoViewCount"] = 8000  # actor sometimes ships both — playCount wins
    post = parse_apify_instagram_post(item)
    assert post.post_type == "video"
    assert post.views == 12000


def test_instagram_video_views_falls_back_when_playCount_missing():
    item = dict(_IG_FIXTURE)
    item["type"] = "Reel"
    item["videoPlayCount"] = None
    item["videoViewCount"] = 5000
    post = parse_apify_instagram_post(item)
    assert post.views == 5000


def test_instagram_image_post_has_no_views():
    # Image/Sidecar posts never carry view fields — should remain None.
    post = parse_apify_instagram_post(_IG_FIXTURE)
    assert post.post_type == "carousel"
    assert post.views is None


def test_instagram_channel_parsing():
    ch = parse_apify_instagram_channel(_IG_FIXTURE)
    assert ch.platform == "instagram"
    assert ch.channel_handle == "alice"
    assert ch.channel_id == "555"
    assert ch.channel_url == "https://www.instagram.com/alice/"
    assert ch.subscribers == 1234
    assert ch.channel_metadata["verified"] is True


# ---------------------------------------------------------------------------
# Instagram — apidojo/instagram-hashtag-scraper
# ---------------------------------------------------------------------------

def test_apidojo_ig_image_post_normalizes_nested_fields():
    post = parse_apidojo_ig_hashtag_post(_IG_APIDOJO_IMAGE_FIXTURE)
    assert post.platform == "instagram"
    assert post.post_id == "3890140629775419536"
    # owner.username and owner.id flatten correctly
    assert post.channel_handle == "progressivepower"
    assert post.channel_id == "6619572681"
    # createdAt -> posted_at
    assert post.posted_at == datetime(2026, 5, 5, 6, 2, 5, tzinfo=timezone.utc)
    # singular likeCount/commentCount lift to plural fields
    assert post.likes == 27
    assert post.comments_count == 1
    # type="post" + isVideo=False + isCarousel=False -> image
    assert post.post_type == "image"
    # image.url flattens to displayUrl, included in media_urls
    assert any("img.jpg" in u for u in post.media_urls)
    assert post.views is None  # images carry no view count


def test_apidojo_ig_video_post_extracts_play_count():
    post = parse_apidojo_ig_hashtag_post(_IG_APIDOJO_VIDEO_FIXTURE)
    # isVideo=True -> post_type "video"
    assert post.post_type == "video"
    # nested video.playCount lifts to views
    assert post.views == 4823
    # video.url present in media_urls
    assert any("clip.mp4" in u for u in post.media_urls)


def test_apidojo_ig_channel_parsing():
    ch = parse_apidojo_ig_hashtag_channel(_IG_APIDOJO_IMAGE_FIXTURE)
    assert ch.platform == "instagram"
    assert ch.channel_handle == "progressivepower"
    assert ch.channel_id == "6619572681"
    assert ch.channel_url == "https://www.instagram.com/progressivepower/"
    # apidojo doesn't include followerCount on hashtag-scraped items
    assert ch.subscribers is None
    assert ch.channel_metadata["verified"] is False
    assert ch.channel_metadata["full_name"] == "Progressive Power"


# ---------------------------------------------------------------------------
# Facebook
# ---------------------------------------------------------------------------

def test_facebook_post_basic_fields():
    post = parse_scrapeforge_facebook_post(_FB_FIXTURE)
    assert post.platform == "facebook"
    assert post.post_id == "fb_post_123"
    assert post.channel_handle == "Some Page"
    assert post.channel_id == "page_42"
    assert post.post_url.startswith("https://www.facebook.com/")
    assert post.likes == 100  # reactions_count wins over reactions sum
    assert post.shares == 5
    assert post.comments_count == 12
    assert post.posted_at.tzinfo is not None  # tz-aware
    assert post.post_type == "image"
    assert post.crawl_provider == "apify"
    assert post.platform_metadata["associated_group_id"] == "123"


def test_facebook_post_likes_falls_back_to_reactions_sum():
    item = dict(_FB_FIXTURE)
    item.pop("reactions_count")
    post = parse_scrapeforge_facebook_post(item)
    # 80 like + 20 love = 100
    assert post.likes == 100


def test_facebook_post_id_hashed_from_url_when_missing():
    item = {k: v for k, v in _FB_FIXTURE.items() if k != "post_id"}
    post = parse_scrapeforge_facebook_post(item)
    assert post.post_id
    assert len(post.post_id) == 16


def test_facebook_channel_parsing():
    ch = parse_scrapeforge_facebook_channel(_FB_FIXTURE)
    assert ch.platform == "facebook"
    assert ch.channel_handle == "Some Page"
    assert ch.channel_id == "page_42"
    assert ch.channel_url == "https://www.facebook.com/somepage"


# ---------------------------------------------------------------------------
# TikTok
# ---------------------------------------------------------------------------

def test_tiktok_post_basic_fields():
    post = parse_clockworks_tiktok_post(_TIKTOK_FIXTURE)
    assert post.platform == "tiktok"
    assert post.post_id == "7300000000000000001"
    assert post.channel_handle == "bob"
    assert post.channel_id == "user42"
    assert post.posted_at == datetime(2026, 4, 20, 14, 0, tzinfo=timezone.utc)
    assert post.post_type == "video"
    assert post.likes == 500
    assert post.comments_count == 25
    assert post.views == 12000
    assert post.saves == 8
    assert post.crawl_provider == "apify"
    assert post.platform_metadata["hashtags"] == ["tag"]
    assert post.platform_metadata["search_query"] == "recipes"


def test_tiktok_slideshow_marked_as_carousel():
    item = dict(_TIKTOK_FIXTURE, isSlideshow=True)
    post = parse_clockworks_tiktok_post(item)
    assert post.post_type == "carousel"


def test_tiktok_channel_parsing():
    ch = parse_clockworks_tiktok_channel(_TIKTOK_FIXTURE)
    assert ch.platform == "tiktok"
    assert ch.channel_handle == "bob"
    assert ch.channel_id == "user42"
    assert ch.subscribers == 9000
    assert ch.total_posts == 120
    assert ch.channel_url == "https://www.tiktok.com/@bob"


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

def test_registry_returns_known_pair():
    parse_post, parse_channel = get_parsers("instagram", "apify/instagram-scraper")
    assert parse_post is parse_apify_instagram_post
    assert parse_channel is parse_apify_instagram_channel


def test_registry_raises_for_unknown_actor():
    with pytest.raises(ValueError, match="No Apify parser registered"):
        get_parsers("instagram", "some/other-actor")


def test_registry_covers_all_supported_platforms():
    platforms_in_registry = {p for (p, _) in _PARSER_REGISTRY}
    assert {"instagram", "facebook", "tiktok"} <= platforms_in_registry
