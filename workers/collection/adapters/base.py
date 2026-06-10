from abc import ABC, abstractmethod
from collections.abc import Iterable

from workers.collection.models import Batch, CommentBatch


class DataProviderAdapter(ABC):
    @abstractmethod
    def collect(self, config: dict) -> Iterable[Batch]:
        """Return batches of posts + channel metadata from the platform.

        Config keys (mode-dependent):
          platforms: list[str]            required
          # --- keyword/channel mode ---
          keywords, channel_urls, time_range, max_posts_per_keyword
          # --- direct-fetch mode ---
          post_urls: list[str]            when non-empty, the adapter fetches
                                          exactly the listed posts and ignores
                                          keywords/channel_urls/time_range.
        """

    @abstractmethod
    def fetch_engagements(self, post_urls: list[str]) -> list[dict]:
        """Re-fetch current engagement metrics + comments for given posts."""

    @abstractmethod
    def fetch_comments(self, post: dict) -> CommentBatch:
        """Fetch the full reply tree for one post.

        `post` carries the keys the adapter needs to locate the post on the
        platform: at minimum `post_id`, `platform`, `post_url`. Returns a
        CommentBatch with normalized comment rows + the channel rows for
        each unique comment author observed.
        """

    @abstractmethod
    def supported_platforms(self) -> list[str]:
        pass

    def supported_comment_platforms(self) -> list[str]:
        """Subset of supported_platforms for which fetch_comments is implemented.

        Default: empty (adapter raises NotImplementedError from fetch_comments).
        Override per-adapter to whitelist specific platforms. The wrapper uses
        this to route a fetch_comments call to the *first* adapter that
        explicitly supports comments for the given platform - independent of
        the post-collection routing precedence.
        """
        return []

    def supported_url_platforms(self) -> list[str]:
        """Subset of supported_platforms for which the adapter can serve
        URL-based operations: direct post-by-URL fetch (`collect` with
        `post_urls`) and engagement refresh (`fetch_engagements`).

        Default: every supported platform (most adapters look posts up by URL
        natively). Override to `[]` (or a subset) for keyword-only providers
        whose surface can't resolve a specific post URL - e.g. HikerAPI's reels
        SERP. The wrapper uses this to keep URL-based work off keyword-only
        adapters and route it to a URL-capable provider instead.
        """
        return self.supported_platforms()
