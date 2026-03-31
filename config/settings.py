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
    cloud_tasks_service_account: str = ""  # SA email for OIDC auth on Cloud Tasks → Cloud Run
    gemini_model: str = "gemini-3-flash-preview"
    meta_agent_model: str = "gemini-3-flash-preview"
    research_model: str = "gemini-3-flash-preview"  # kept for potential future worker
    enrichment_model: str = "gemini-3-flash-preview"
    embedding_model: str = "text-embedding-005"

    # Enrichment worker config
    enrichment_concurrency: int = 10
    enrichment_search: bool = True
    enrichment_temperature: float = 1
    enrichment_max_output_tokens: int = 4096
    enrichment_media_resolution: str = "medium"  # low, medium, high
    enrichment_thinking_level: str = "medium"  # minimal, low, medium, high (empty = disabled)

    # Meta-agent thinking
    agent_thinking_level: str = "medium"  # minimal, low, medium, high (empty = disabled)
    enrichment_max_media_per_post: int = 5
    enrichment_video_start_offset: str = "0s"
    enrichment_video_end_offset: str = "180s"
    enrichment_video_fps: float = 0.5
    enrichment_batch_workers: int = 4
    enrichment_global_concurrency: int = 10  # Max concurrent Gemini calls across all batches
    enrichment_video_rate_limit: int = 25  # Max video enrichment calls per minute (process-wide)
    enrichment_general_rate_limit: int = 60  # Max total enrichment calls per minute (process-wide)
    enrichment_max_retries: int = 5  # Max retry attempts for 429 errors
    enrichment_retry_base_delay: float = 60.0  # Base delay in seconds for retry backoff

    # Pipeline v2 (post-level DAG)
    use_pipeline_v2: bool = True

    # Clustering (brothers algorithm) thresholds
    clustering_brothers_threshold: float = 0.25
    clustering_max_intra_group_mean: float = 0.26
    clustering_max_distance_ungrouped: float = 0.29

    vetric_api_key_twitter: str = ""
    vetric_api_key_instagram: str = ""
    vetric_api_key_tiktok: str = ""
    vetric_api_key_reddit: str = ""
    vetric_api_key_youtube: str = ""

    # Bright Data
    brightdata_api_token: str = ""
    brightdata_poll_max_wait_sec: int = 1800
    brightdata_poll_initial_interval_sec: float = 1.5
    brightdata_max_snapshots_per_collection: int = 20
    brightdata_max_snapshots_per_task: int = 50

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

    # Email notifications (SendGrid)
    sendgrid_api_key: str = ""
    sendgrid_from_email: str = "ronnstip@gmail.com"
    sendgrid_from_name: str = "SLB"

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
