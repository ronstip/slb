"""Mock data provider that generates realistic social media data.

Uses power-law distributions for engagement metrics to simulate
real social media patterns (few viral posts, many low-engagement posts).
"""

import hashlib
import random
import time
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from workers.collection.adapters.base import DataProviderAdapter
from workers.collection.models import Batch, Channel, Post

# -- Fake content pools --

_INSTAGRAM_HANDLES = [
    "glossier", "drunkmelephant", "tatcha", "theordinary",
    "celobeauty", "skincarebyhyram", "jamescharles",
    "beautybyjj", "glowrecipe", "summerfridays",
    "fentyskin", "milkmakeup", "kbeautylove",
    "skinfluencer.co", "dewyvibes", "cleanbeautylife",
]

_TIKTOK_HANDLES = [
    "@skincarebyhyram", "@drunkmelephant", "@glossier",
    "@dermdoctor", "@skincaretips101", "@beautyhacks",
    "@glowupqueen", "@tatcharitual", "@skincarejunkie",
    "@cleanbeauty", "@morningroutine", "@nighttimeroutine",
    "@kbeautyfinds", "@skintok", "@dewyskin",
]

_REDDIT_SUBREDDITS = [
    "r/SkincareAddiction", "r/MakeupAddiction", "r/BeautyGuruChatter",
    "r/AsianBeauty", "r/Sephora", "r/drugstoreMUA",
]

_REDDIT_AUTHORS = [
    "skincare_enthusiast", "beauty_lover_23", "cleanbeautystan",
    "serumqueen", "retinolwarrior", "niacinamide_fan",
    "SPF_or_die", "gentlecleanser", "doubleCleanseGirl",
]

_THEMES = [
    "skincare routine", "product review", "morning routine",
    "night routine", "ingredient breakdown", "before and after",
    "haul", "dupes", "clean beauty", "anti-aging", "acne treatment",
    "sunscreen review", "moisturizer comparison", "serum ranking",
    "packaging design", "brand ethics", "sustainability",
    "price comparison", "sensitive skin", "oily skin tips",
]

_SENTIMENTS = ["positive", "positive", "positive", "neutral", "neutral", "negative", "mixed"]

_CONTENT_TEMPLATES = {
    "instagram": [
        "Obsessed with this {product} from @{brand}! My skin has never looked better ✨ #skincare #{brand}",
        "Honest review of @{brand}'s new {product} — is it worth the hype? 🤔 #{brand} #skincarereview",
        "My current skincare lineup featuring @{brand} 💕 Swipe for full routine! #skincareroutine",
        "@{brand} {product} — 3 weeks in and here are my thoughts... #{brand} #beautytips",
        "POV: you finally found a {product} that works 😭✨ Thank you @{brand}! #glowup",
        "Can we talk about @{brand}'s packaging? 😍 Almost too pretty to use #{brand}",
        "Comparing @{brand_a} vs @{brand_b} {product} — full breakdown in caption 👇 #skincarecomparison",
    ],
    "tiktok": [
        "Is @{brand}'s {product} actually worth it? Let me break it down #skincare #{brand} #fyp",
        "My ENTIRE skincare routine using @{brand} products #skincareroutine #glowup",
        "POV: the {product} from @{brand} actually works #skincaretok #{brand}",
        "Rating @{brand}'s top 5 products — which ones are actually good? #{brand} #skincare",
        "Get ready with me featuring @{brand}'s new {product}! #grwm #{brand}",
        "I tried @{brand}'s viral {product} so you don't have to #{brand} #skincare #review",
    ],
    "reddit": [
        "[Review] {brand} {product} — {weeks} week update with photos",
        "Has anyone else noticed {brand}'s {product} formula changed?",
        "PSA: {brand} {product} is currently on sale at Sephora",
        "{brand} vs {brand_b} for {concern} — which one should I pick?",
        "My HG routine featuring {brand} — dry/sensitive skin",
        "Unpopular opinion: {brand}'s {product} is overrated",
    ],
}

_PRODUCTS = [
    "Cloud Paint", "Boy Brow", "Milky Jelly Cleanser", "Protini Moisturizer",
    "Lala Retro Cream", "C-Firma Serum", "Dewy Skin Cream", "Niacinamide Serum",
    "Retinol Serum", "Vitamin C Drops", "Hyaluronic Acid", "SPF 50 Sunscreen",
    "Cleansing Balm", "Toner Pads", "Sheet Mask", "Eye Cream",
]

_CONCERNS = [
    "acne scars", "hyperpigmentation", "fine lines", "dehydration",
    "oily T-zone", "dark circles", "redness", "texture",
]


def _power_law_int(min_val: int, max_val: int, alpha: float = 2.5) -> int:
    """Generate a power-law distributed integer (many small, few large)."""
    if max_val <= 0:
        return 0
    # Shift to avoid zero base in power-law calculation
    lo = max(min_val, 1)
    hi = max(max_val, lo + 1)
    u = random.random()
    x = ((hi ** (1 - alpha) - lo ** (1 - alpha)) * u + lo ** (1 - alpha)) ** (1 / (1 - alpha))
    result = int(min(max(x, lo), hi))
    return result if min_val > 0 else result - 1


def _generate_post_id(platform: str, handle: str, index: int) -> str:
    raw = f"{platform}:{handle}:{index}:{uuid4().hex[:8]}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def _random_date(start: datetime, end: datetime) -> datetime:
    delta = end - start
    random_seconds = random.randint(0, int(delta.total_seconds()))
    return start + timedelta(seconds=random_seconds)


def _generate_content(platform: str, keywords: list[str]) -> tuple[str, str | None]:
    """Generate realistic post content. Returns (content, title)."""
    brand = random.choice(keywords) if keywords else "GenericBrand"
    brand_b = random.choice([k for k in keywords if k != brand]) if len(keywords) > 1 else "OtherBrand"
    product = random.choice(_PRODUCTS)
    concern = random.choice(_CONCERNS)

    templates = _CONTENT_TEMPLATES.get(platform, _CONTENT_TEMPLATES["instagram"])
    template = random.choice(templates)

    content = template.format(
        brand=brand, brand_a=brand, brand_b=brand_b,
        product=product, concern=concern,
        weeks=random.randint(1, 12),
    )

    title = None
    if platform == "reddit":
        title = content
        content = f"I've been using {brand}'s {product} for about {random.randint(1, 12)} weeks now. "
        content += f"Here are my thoughts on it for anyone dealing with {concern}. "
        content += "Full review and photos in the post."

    return content, title


def _generate_comments(count: int, keywords: list[str]) -> list[dict]:
    comment_templates = [
        "Love this! 😍", "Where can I buy this?", "Been using it for months!",
        "Does it work for sensitive skin?", "The packaging is so cute",
        "Overrated imo", "This changed my skin!", "How long did it take to see results?",
        "Thanks for the honest review", "Adding to cart rn 🛒",
        "I prefer {brand} tbh", "Price is too high for what you get",
        "Game changer!! 🙌", "Not worth the hype", "My dermatologist recommended this",
    ]
    comments = []
    for _ in range(count):
        brand = random.choice(keywords) if keywords else "Brand"
        comments.append({
            "author": f"user_{random.randint(1000, 99999)}",
            "text": random.choice(comment_templates).format(brand=brand),
            "posted_at": datetime.now(timezone.utc).isoformat(),
            "likes": _power_law_int(0, 500),
        })
    return comments


class MockAdapter(DataProviderAdapter):
    """Generates realistic mock social media data for development and testing."""

    def supported_platforms(self) -> list[str]:
        return ["instagram", "tiktok", "reddit"]

    def collect(self, config: dict) -> list[Batch]:
        platforms = config.get("platforms", ["instagram"])
        keywords = config.get("keywords", ["glossier"])
        max_calls = config.get("max_calls", 2)
        time_range = config.get("time_range", {})
        include_comments = config.get("include_comments", True)

        end_date = datetime.now(timezone.utc)
        start_date = end_date - timedelta(days=90)
        if time_range.get("start"):
            start_date = datetime.fromisoformat(time_range["start"]).replace(tzinfo=timezone.utc)
        if time_range.get("end"):
            end_date = datetime.fromisoformat(time_range["end"]).replace(tzinfo=timezone.utc)

        all_batches: list[Batch] = []
        posts_per_batch = 10

        for platform in platforms:
            if platform not in self.supported_platforms():
                continue

            handles = self._get_handles(platform)
            posts_generated = 0

            for _ in range(max_calls):
                posts = []
                channels = []
                seen_handles: set[str] = set()

                for i in range(posts_per_batch):
                    handle = random.choice(handles)
                    post = self._generate_post(
                        platform, handle, posts_generated + i,
                        keywords, start_date, end_date, include_comments,
                    )
                    posts.append(post)

                    if handle not in seen_handles:
                        seen_handles.add(handle)
                        channels.append(self._generate_channel(platform, handle))

                all_batches.append(Batch(posts=posts, channels=channels))
                posts_generated += len(posts)

                # Minimal simulated delay
                time.sleep(0.05)

        return all_batches

    def fetch_engagements(self, post_urls: list[str]) -> list[dict]:
        results = []
        for url in post_urls:
            # Generate slightly increased engagement (simulating time passing)
            results.append({
                "post_url": url,
                "likes": _power_law_int(5, 100000),
                "shares": _power_law_int(0, 10000),
                "comments_count": _power_law_int(0, 5000),
                "views": _power_law_int(100, 5000000),
                "saves": _power_law_int(0, 20000),
                "comments": _generate_comments(random.randint(0, 5), []),
            })
        return results

    def _get_handles(self, platform: str) -> list[str]:
        return {
            "instagram": _INSTAGRAM_HANDLES,
            "tiktok": _TIKTOK_HANDLES,
            "reddit": _REDDIT_SUBREDDITS,
        }.get(platform, _INSTAGRAM_HANDLES)

    def _generate_post(
        self,
        platform: str,
        handle: str,
        index: int,
        keywords: list[str],
        start_date: datetime,
        end_date: datetime,
        include_comments: bool,
    ) -> Post:
        post_id = _generate_post_id(platform, handle, index)
        content, title = _generate_content(platform, keywords)
        posted_at = _random_date(start_date, end_date)

        post_type = self._random_post_type(platform)
        likes = _power_law_int(1, 50000)
        views = _power_law_int(100, 2000000) if platform in ("tiktok", "instagram") else None
        comments_count = _power_law_int(0, int(likes * 0.3) + 1)

        # Generate media URLs (mock placeholder images)
        media_count = 1 if post_type in ("video", "reel") else random.randint(1, 4)
        if platform == "reddit" and post_type == "text":
            media_count = 0
        media_urls = [
            f"https://picsum.photos/seed/{post_id}_{j}/1080/1080"
            for j in range(media_count)
        ]

        comments = []
        if include_comments and comments_count > 0:
            comments = _generate_comments(min(comments_count, 20), keywords)

        author = handle
        if platform == "reddit":
            author = random.choice(_REDDIT_AUTHORS)

        return Post(
            post_id=post_id,
            platform=platform,
            channel_handle=handle if platform != "reddit" else author,
            channel_id=f"{platform}_{handle}",
            title=title,
            content=content,
            post_url=f"https://{platform}.com/p/{post_id}",
            posted_at=posted_at,
            post_type=post_type,
            parent_post_id=None,
            media_urls=media_urls,
            media_refs=[],
            likes=likes,
            shares=_power_law_int(0, int(likes * 0.2) + 1),
            comments_count=comments_count,
            views=views,
            saves=_power_law_int(0, int(likes * 0.5) + 1) if platform != "reddit" else None,
            comments=comments,
            platform_metadata={
                "platform": platform,
                "author": author,
                "subreddit": handle if platform == "reddit" else None,
            },
        )

    def _generate_channel(self, platform: str, handle: str) -> Channel:
        subscribers = _power_law_int(1000, 5000000)
        return Channel(
            channel_id=f"{platform}_{handle}",
            platform=platform,
            channel_handle=handle,
            subscribers=subscribers,
            total_posts=random.randint(50, 5000),
            channel_url=f"https://{platform}.com/{handle}",
            description=f"Official {handle} account on {platform}",
            created_date=datetime.now(timezone.utc) - timedelta(days=random.randint(365, 2000)),
            channel_metadata={"verified": random.random() > 0.7},
        )

    def _random_post_type(self, platform: str) -> str:
        types = {
            "instagram": ["image", "image", "image", "reel", "reel", "carousel", "video"],
            "tiktok": ["video"],
            "reddit": ["text", "text", "image", "link"],
        }
        return random.choice(types.get(platform, ["image"]))
