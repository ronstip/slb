from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    gcp_project_id: str
    gcp_region: str = "us-central1"
    gemini_location: str = "global"
    bq_dataset: str = "social_listening"
    gcs_media_bucket: str = ""
    gcs_exports_bucket: str = ""
    gcs_presentations_bucket: str = ""
    cloud_tasks_queue: str = "worker-queue"
    cloud_tasks_service_account: str = ""  # SA email for OIDC auth on Cloud Tasks → Cloud Run
    gemini_model: str = "gemini-3-flash-preview"
    meta_agent_model: str = "gemini-3-flash-preview"
    research_model: str = "gemini-3-flash-preview"  # kept for potential future worker
    enrichment_model: str = "gemini-3.1-flash-lite-preview"
    embedding_model: str = "text-embedding-005"

    # Enrichment worker config
    enrichment_concurrency: int = 50
    enrichment_search: bool = True
    enrichment_temperature: float = 1
    enrichment_max_output_tokens: int = 4096
    enrichment_media_resolution: str = "medium"  # low, medium, high
    enrichment_thinking_level: str = "low"  # minimal, low, medium, high (empty = disabled)

    # Meta-agent thinking
    agent_thinking_level: str = "medium"  # minimal, low, medium, high (empty = disabled)
    enrichment_max_media_per_post: int = 3
    enrichment_video_start_offset: str = "0s"
    enrichment_video_end_offset: str = "40s"
    enrichment_video_fps: float = 0.5
    enrichment_batch_workers: int = 4
    enrichment_global_concurrency: int = 50  # Max concurrent Gemini calls across all batches
    enrichment_video_rate_limit: int = 25  # Max video enrichment calls per minute (process-wide)
    enrichment_general_rate_limit: int = 600  # Max total enrichment calls per minute (process-wide) - requires matching Gemini quota in GCP
    # Retry budget is deliberately tight - the old defaults (base=60s, retries=5)
    # with exponential backoff let a single 429-prone post hold a worker slot
    # for up to 15 minutes (60+120+240+480+...), gridlocking the enrichment
    # pool when several posts hit 429 in one batch. With base=10s / retries=3
    # the worst case is ~40s (10+20+40).
    enrichment_max_retries: int = 3
    enrichment_retry_base_delay: float = 10.0
    # Hard ceiling on cumulative retry sleep per post - if we'd sleep past this,
    # give up and mark the post as failed. Stops pathological batches where
    # every post sits in backoff instead of draining.
    enrichment_retry_max_total_sec: float = 60.0
    # Wall-clock ceiling for a single post across all retries, including HTTP
    # time, retry sleeps, and blocking in the rate-limiter acquires. Acts as
    # the ThreadPoolExecutor per-future timeout so a single hung Gemini call
    # can't stall the whole batch. Must be smaller than
    # ``pipeline_stall_threshold_minutes`` (in seconds) so the per-post
    # timeout fires before the stale-pipeline watchdog recovers a "slow but
    # not stuck" run.
    enrichment_per_post_timeout_sec: float = 480.0

    # Streaming enrichment - the consumer flushes pending Gemini results into
    # BigQuery via MERGE either when `flush_size` accumulates or `flush_interval_sec`
    # elapses. Smaller flush_size = smoother `posts_enriched` counter advancement
    # at the cost of more BQ MERGEs.
    enrichment_bq_flush_size: int = 25
    enrichment_bq_flush_interval_sec: float = 3.0

    # Pipeline liveness - a dedicated thread inside the runner touches
    # `collection_status.updated_at` every N seconds, independent of the main
    # loop, so the stale-pipeline watchdog can detect a wedged loop quickly
    # without waiting for the next progress log.
    pipeline_heartbeat_seconds: float = 60.0
    # Watchdog: a running pipeline whose `updated_at` is older than this is
    # considered stale and recovered. Must be comfortably larger than the
    # heartbeat cadence to absorb transient Firestore latency.
    pipeline_stall_threshold_minutes: int = 10

    # Max concurrent CDN/GCS downloads per collection (owned by PipelineRunner).
    # Decouples media I/O from the step orchestration pool so a slow download
    # batch can't starve enrich/embed progress.
    media_download_concurrency: int = 16

    # Pipeline embedding step (BQ AI.GENERATE_EMBEDDING - paid per row).
    # Disabled by default because the current default topic algorithm
    # (llm_taxonomy_v2) does not use embeddings. When False, action_embed
    # short-circuits as a no-op pass-through (ENRICHED → DONE) so the state
    # machine still drains, but no BQ embedding cost is incurred.
    # Re-enable via env var PIPELINE_EMBED_STEP_ENABLED=true if you switch an
    # agent back to brothers_v1 (which relies on embeddings).
    pipeline_embed_step_enabled: bool = False
    # Fan adapters (BrightData, Vetric, ...) across threads during crawl.
    # Off by default - flip after verifying per-adapter snapshot accounting in
    # a canary agent. Only affects multi-provider collections.
    parallel_adapters: bool = False

    # Clustering (brothers algorithm) thresholds
    clustering_brothers_threshold: float = 0.17
    clustering_max_intra_group_mean: float = 0.20
    clustering_max_distance_ungrouped: float = 0.21

    # LLM-taxonomy topic algorithm (alternative to brothers_v1 - no embeddings).
    # Toggle via topics_algorithm; per-agent override lives in the agent doc's
    # `topics_config.algorithm_version` field.
    #
    # Membership in v2 is LLM-claimed: pass 1 asks the model which sample posts
    # inspired each candidate. Pass 2 unions those across merged candidates.
    # No rule-based assignment over the full corpus.
    topics_algorithm: str = "llm_taxonomy_v2"  # "brothers_v1" | "llm_taxonomy_v2"
    topics_window_days: int = 7
    topics_sample_size: int = 1000
    topics_sample_per_signature: int = 3
    topics_sample_channel_cap: int = 3
    topics_sample_time_buckets: int = 4
    # Pass-1 sweet spot: 100 posts/batch, concurrency 10, minimal thinking.
    # End-to-end on a 1.2k-post pool runs ~90s wallclock at ~$0.13.
    topics_batch_size: int = 100
    topics_taxonomy_concurrency: int = 10
    topics_pass1_thinking_level: str = "minimal"  # minimal | low | medium | high
    topics_pass2_thinking_level: str = "low"
    topics_pass3_thinking_level: str = "low"
    topics_min_match_score: int = 2  # kept on AssignmentRule for audit/search only
    topics_broad_size_warn_ratio: float = 0.05  # log warn when mean topic size > X% of corpus
    # Pass-3 post-hoc filter: per-topic LLM membership check that strips posts
    # whose primary subject doesn't match the beat. Removes ~30% of members
    # (the residual stance-mismatch / actor-overlap-only noise that pass-1's
    # VERIFY-ASSIGNMENT step doesn't fully catch). Costs one extra LLM call per
    # final topic (~50 calls on a typical run, comparable to pass-1 batch count).
    topics_pass3_filter_enabled: bool = True
    topics_pass3_min_members_after: int = 1  # drop topic if fewer kept members

    vetric_api_key_twitter: str = ""
    vetric_api_key_instagram: str = ""
    vetric_api_key_tiktok: str = ""
    vetric_api_key_reddit: str = ""
    vetric_api_key_youtube: str = ""

    # X (Twitter) API v2 - official vendor; default for the `twitter` platform
    x_api_bearer_token: str = ""
    x_api_max_results: int = 500  # 10..500 per /tweets/search/all page
    x_api_min_request_interval_sec: float = 1.0  # client-side throttle (PAYG-friendly)
    x_api_sort_order: str = "relevancy"  # "relevancy" | "recency"; per-collection override via config["sort_order"]
    x_api_default_max_calls: int = 2  # pagination depth fallback when n_posts/max_posts_per_keyword unset
    x_api_end_time_lag_hours: float = 0.0  # offset end_time back from now; X's 10s floor is enforced inside the adapter
    # Promote each quoted/replied tweet hydrated in `includes.tweets` to its own Post
    # in the same batch (Option B). The parent post gets an enrichment_dependency
    # pointer so PR #2's pipeline gate can wait for the dep's media before enriching.
    # When False, only the defensive `platform_metadata.referenced_post` snapshot is
    # populated; no extra Posts are emitted.
    x_api_unpack_referenced_posts: bool = False
    # Comment fetching: cap pages of /search/all conversation_id results.
    # Each page returns up to 100 replies (PAYG cap for /search/all without
    # context_annotations). Default 1 = up to 100 comments per fetch.
    x_api_max_comment_pages: int = 1

    # Bright Data
    brightdata_api_token: str = ""
    brightdata_poll_max_wait_sec: int = 1800
    brightdata_poll_initial_interval_sec: float = 1.5
    brightdata_max_snapshots_per_collection: int = 20
    brightdata_max_snapshots_per_task: int = 50

    # Apify - pay-per-result actor platform; primary vendor for Instagram, Facebook, TikTok
    apify_api_token: str = ""
    apify_actor_instagram: str = "apidojo/instagram-hashtag-scraper"
    # Direct-fetch (post URL) actor - apidojo/instagram-hashtag-scraper only
    # accepts hashtag URLs, so the post-by-URL flow needs a different actor
    # that handles directUrls. Defaults to apify/instagram-scraper (parser
    # already registered in apify_parsers.py).
    apify_actor_instagram_post: str = "apify/instagram-scraper"
    apify_actor_facebook: str = "scrapeforge/facebook-search-posts"
    # Channel/page actor - the keyword actor (scrapeforge/facebook-search-posts)
    # takes a `query` string and can't collect a specific page's feed, so channel
    # mode uses apify/facebook-posts-scraper with startUrls (page URLs) +
    # onlyPostsNewerThan. Parser registered in apify_parsers.py. Mirrors the IG
    # split (apify_actor_instagram vs apify_actor_instagram_post).
    apify_actor_facebook_page: str = "apify/facebook-posts-scraper"
    # Group actor - the page actor (apify/facebook-posts-scraper) only scrapes
    # pages/profiles and returns NO-DATA for group feeds, so group URLs
    # (facebook.com/groups/...) route to apify/facebook-groups-scraper instead.
    # Same startUrls/resultsLimit/onlyPostsNewerThan input shape; auto-detected
    # by URL in _collect_facebook_channels. Parser registered in apify_parsers.py.
    apify_actor_facebook_group: str = "apify/facebook-groups-scraper"
    apify_actor_tiktok: str = "apidojo/tiktok-scraper-api"
    apify_run_timeout_sec: int = 1500
    apify_max_runs_per_collection: int = 30
    apify_max_parallel_runs: int = 10
    apify_memory_mbytes: int = 2048  # STARTER plan cap is 32 GB; max_parallel * memory must stay <= cap
    apify_account_memory_cap_mbytes: int = 32768
    apify_build: str = ""  # optional build tag for stability
    apify_proxy_group: str = "RESIDENTIAL"  # RESIDENTIAL | DATACENTER
    # Instagram comments - dedicated actor (separate from the post-collection actor)
    apify_actor_instagram_comments: str = "apify/instagram-comment-scraper"
    apify_instagram_comments_max: int = 100  # per-post fetch cap (cost guard)
    # TikTok comments - dedicated actor (separate from the post-collection actor)
    apify_actor_tiktok_comments: str = "clockworks/tiktok-comments-scraper"
    apify_tiktok_comments_max: int = 100  # per-post fetch cap (cost guard)
    # YouTube comments - dedicated actor (YT posts collect via Vetric/BrightData;
    # comments path is Apify-only). Input shape: startUrls=[{url}], maxComments.
    apify_actor_youtube_comments: str = "streamers/youtube-comments-scraper"
    apify_youtube_comments_max: int = 100  # per-post fetch cap (cost guard)
    # Facebook comments - dedicated actor (FB posts collect via the page/group
    # actors; comments path is Apify-only). Input shape: startUrls=[{url}], resultsLimit.
    apify_actor_facebook_comments: str = "apify/facebook-comments-scraper"
    apify_facebook_comments_max: int = 100  # per-post fetch cap (cost guard)

    # HikerAPI - Instagram private-API provider; reaches the logged-in
    # `fbsearch_reels_v2` keyword->reels SERP (viral content) that Apify can't.
    # Keyword-collection only; channel + URL-based ops stay on Apify. Flat
    # $0.0006/request (priced in config/cost_rates.py, not here, mirroring Apify).
    hikerapi_api_key: str = ""
    # Anti-runaway BACKSTOP on reels-SERP pages per keyword (1 request each,
    # $0.0006/request) - NOT the normal stop. Pagination is request-driven: it
    # stops when the requested post count is reached, the SERP runs dry, or it
    # saturates (pages stop adding new posts). The effective ceiling scales with
    # the requested count (~cap/3 + 5), so this value only acts as a floor for
    # untargeted collects + a guard against a pathological infinite-paging API.
    hikerapi_max_pages_per_keyword: int = 15

    # Per-platform default vendor selection. Empty string falls through to
    # `vendor_config.default` then to the first-supporting adapter.
    # NOTE: these env defaults are now a low-priority SEED fallback - the
    # admin-editable Firestore routing config (`app_config/routing`, see
    # config/collection_routing.py) supersedes them at runtime so the provider
    # can be switched without a redeploy. Read in `keyword_provider_for`.
    default_vendor_instagram: str = ""
    default_vendor_facebook: str = ""
    default_vendor_tiktok: str = "apify"

    environment: str = "development"

    # Signup gate mode (controls who can sign in once a Firebase token is verified):
    #   "open"         - no gate beyond Firebase auth itself (dev default).
    #   "allowlist"    - only emails in `allowed_emails` may sign in.
    #                    `lifespan()` hard-fails at startup in production if
    #                    this mode is set with an empty `allowed_emails`.
    #   "entitlements" - placeholder for §E per-user Firestore tiers.
    #
    # Designed so flipping from "allowlist" → "entitlements" later is an env
    # change, not a code change.
    signup_gate: str = "open"

    # §E credit/cost enforcement (require_active + require_credit_for_run).
    # Decoupled from `signup_gate` so we can bill regular users for usage
    # without flipping the signup/access rollout. ON by default; super admins
    # and `free`-tier users always bypass. Set to false to disable cost gating
    # (e.g. local dev that shouldn't block on balance).
    enforce_credits: bool = True

    enable_search_grounding: bool = True
    agent_engine_id: str = ""  # Vertex AI Agent Engine ID for Memory Bank (prod only)
    google_genai_use_vertexai: bool = True

    # P2 server-side dashboard aggregation (public shares). ON by default: the
    # share endpoint computes each eligible widget server-side and, when the whole
    # layout is covered, drops the raw posts array (payload becomes KB/widget,
    # post-count-independent). A per-request `?agg=client`/`?agg=off` still forces
    # the legacy full-posts path for debugging; this flag is the global kill
    # switch. Any widget the engine can't reproduce keeps client-side aggregation,
    # so turning this on is safe for every dashboard.
    dashboard_server_agg: bool = True

    # Shared L2 for the dashboard response-bytes cache (GCS-backed). The
    # in-process bytes cache is per-instance, so a fresh Cloud Run instance
    # (burst / cold start / post-deploy) starts empty and pays the full
    # BigQuery cold miss. The L2 lets any instance serve a body another instance
    # already built (~100ms GCS read vs ~14s rebuild). Best-effort: a GCS error
    # silently degrades to L1-only. Kill switch in case GCS misbehaves.
    dashboard_cache_l2: bool = True

    # Dev-only kill switch for the OngoingScheduler daemon. In development the
    # scheduler auto-dispatches due recurring agents (and runs stale-pipeline
    # recovery), which fires real collection pipelines without user action.
    # Off by default so a local backend stays quiet unless explicitly opted in.
    enable_dev_scheduler: bool = False

    frontend_url: str = "http://localhost:5174"

    # CORS - comma-separated allowed origins
    cors_origins: str = "http://localhost:5174,http://localhost:5173,http://localhost:3000"

    # Worker service URL for Cloud Tasks dispatch (set in prod, e.g. https://sl-worker-xxx.run.app)
    worker_service_url: str = ""

    # API service URL for Cloud Tasks that need to hit the api (e.g. agent continuation)
    api_service_url: str = ""

    # Comma-separated allowlist of emails. Empty = anyone can sign in.
    allowed_emails: str = ""

    # Lemon Squeezy billing (optional - billing features disabled if not set)
    lemonsqueezy_api_key: str = ""
    lemonsqueezy_store_id: str = ""
    lemonsqueezy_webhook_secret: str = ""

    # Super admin - comma-separated emails with platform-wide admin access
    super_admin_emails: str = ""

    # Email notifications (SendGrid)
    sendgrid_api_key: str = ""
    sendgrid_from_email: str = "alerts@scolto.com"
    sendgrid_from_name: str = "Scolto"

    # Visual alert rendering — headless PNG snapshots of dashboard widgets for
    # alert emails (and, later, Slack/Teams/WhatsApp). All three empty → alerts
    # silently fall back to the text/post-list email body, so this is safe to
    # leave unset in dev.
    #   render_service_url   – Node+Playwright render service (POST /render)
    #   render_service_token – shared bearer the worker sends / the service checks
    #   alert_render_secret  – HMAC key for the short-lived embed token that lets
    #                          the headless browser fetch ONE widget's data with
    #                          no user login
    render_service_url: str = ""
    render_service_token: str = ""
    alert_render_secret: str = ""

    # WhatsApp channel (spec docs/whatsapp-channel-impl-spec.md §5).
    # api service needs app_secret + verify_token (webhook); worker service
    # needs access_token + phone_number_id + business_account_id (outbound).
    # All five empty = channel disabled. ⚠️ When wiring deploy, add these to
    # BOTH deploy.yml AND deploy_prod.sh env blocks (env-truncation gotcha).
    whatsapp_app_id: str = ""  # Meta App ID (reference; not used at runtime)
    whatsapp_phone_number_id: str = ""
    whatsapp_business_account_id: str = ""
    whatsapp_access_token: str = ""
    whatsapp_app_secret: str = ""
    whatsapp_verify_token: str = ""
    whatsapp_pin: str = ""  # two-step verify PIN (number registration only)
    # Dialable business number (E.164 digits, no '+') — the `wa.me/<number>`
    # target for user-initiated deep-link linking (§11). Distinct from
    # whatsapp_phone_number_id (Meta's opaque id, not dialable).
    whatsapp_business_number: str = ""
    # SUPERSEDED (§11.6): AUTHENTICATION template for the retired OTP link path.
    # Empty + no access_token ⇒ verify-start degrades to a dev stub (logs the code).
    whatsapp_otp_template: str = "wa_link_code"

    # Sentry error tracking (§C.1). Empty DSN = disabled (local dev default).
    # Sample rates default to 0.0 = errors-only, which keeps the Sentry free
    # plan from ever billing; raise them to experiment with tracing/profiling.
    sentry_dsn: str = ""
    sentry_environment: str = ""  # falls back to `environment` when empty
    sentry_release: str = ""  # git SHA, set at deploy; ties events to a release
    sentry_traces_sample_rate: float = 0.0
    sentry_profiles_sample_rate: float = 0.0

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    def model_post_init(self, __context) -> None:
        if not self.gcs_media_bucket:
            self.gcs_media_bucket = f"{self.gcp_project_id}-media"
        if not self.gcs_exports_bucket:
            self.gcs_exports_bucket = f"{self.gcp_project_id}-exports"
        if not self.gcs_presentations_bucket:
            self.gcs_presentations_bucket = f"{self.gcp_project_id}-exports"

    @property
    def is_dev(self) -> bool:
        return self.environment == "development"

    @property
    def bq_full_dataset(self) -> str:
        return f"{self.gcp_project_id}.{self.bq_dataset}"


@lru_cache
def get_settings() -> Settings:
    return Settings()
