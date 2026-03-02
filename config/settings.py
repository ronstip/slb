from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    gcp_project_id: str
    gcp_region: str = "us-central1"
    gemini_location: str = "global"
    bq_dataset: str = "social_listening"
    gcs_media_bucket: str = ""
    gcs_exports_bucket: str = ""
    cloud_tasks_queue: str = "worker-queue"
    gemini_model: str = "gemini-3-flash-preview"
    meta_agent_model: str = "gemini-3-flash-preview"
    research_model: str = "gemini-3-flash-preview"  # kept for potential future worker
    enrichment_model: str = "gemini-3-flash-preview"
    embedding_model: str = "text-embedding-005"

    # Enrichment worker config
    enrichment_concurrency: int = 30
    enrichment_search: bool = False
    enrichment_temperature: float = 0.2
    enrichment_max_output_tokens: int = 2048
    enrichment_media_resolution: str = "medium"  # low, medium, high
    enrichment_thinking_level: str = "low"  # minimal, low, medium, high
    enrichment_max_media_per_post: int = 5
    enrichment_video_start_offset: str = "0s"
    enrichment_video_end_offset: str = "120s"
    enrichment_video_fps: int = 1
    vetric_api_key_twitter: str = ""
    vetric_api_key_instagram: str = ""
    vetric_api_key_tiktok: str = ""
    vetric_api_key_reddit: str = ""
    vetric_api_key_youtube: str = ""
    environment: str = "development"
    enable_search_grounding: bool = True
    agent_engine_id: str = ""  # Vertex AI Agent Engine ID for Memory Bank (prod only)
    google_genai_use_vertexai: bool = True

    frontend_url: str = "http://localhost:5173"

    # CORS — comma-separated allowed origins
    cors_origins: str = "http://localhost:5173,http://localhost:3000"

    # Worker service URL for Cloud Tasks dispatch (set in prod, e.g. https://sl-worker-xxx.run.app)
    worker_service_url: str = ""

    # Comma-separated allowlist of emails. Empty = anyone can sign in.
    allowed_emails: str = ""

    # Lemon Squeezy billing (optional — billing features disabled if not set)
    lemonsqueezy_api_key: str = ""
    lemonsqueezy_store_id: str = ""
    lemonsqueezy_webhook_secret: str = ""

    # Super admin — comma-separated emails with platform-wide admin access
    super_admin_emails: str = ""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    def model_post_init(self, __context) -> None:
        if not self.gcs_media_bucket:
            self.gcs_media_bucket = f"{self.gcp_project_id}-media"
        if not self.gcs_exports_bucket:
            self.gcs_exports_bucket = f"{self.gcp_project_id}-exports"

    @property
    def is_dev(self) -> bool:
        return self.environment == "development"

    @property
    def bq_full_dataset(self) -> str:
        return f"{self.gcp_project_id}.{self.bq_dataset}"


@lru_cache
def get_settings() -> Settings:
    return Settings()
