from abc import ABC, abstractmethod
from collections.abc import Iterable

from workers.collection.models import Batch, CommentBatch


class DataProviderAdapter(ABC):
    @abstractmethod
    def collect(self, config: dict) -> Iterable[Batch]:
        """Return batches of posts + channel metadata from the platform."""

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
