from abc import ABC, abstractmethod
from collections.abc import Iterator

from workers.collection.models import Batch


class DataProviderAdapter(ABC):
    @abstractmethod
    def collect(self, config: dict) -> Iterator[Batch]:
        """Yield batches of posts + channel metadata from the platform."""

    @abstractmethod
    def fetch_engagements(self, post_urls: list[str]) -> list[dict]:
        """Re-fetch current engagement metrics + comments for given posts."""

    @abstractmethod
    def supported_platforms(self) -> list[str]:
        pass
