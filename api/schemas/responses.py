from pydantic import BaseModel


class CollectionStatusResponse(BaseModel):
    collection_id: str
    status: str
    posts_collected: int = 0
    posts_enriched: int = 0
    posts_embedded: int = 0
    error_message: str | None = None
    config: dict | None = None
