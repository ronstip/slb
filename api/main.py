import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

# Load .env into os.environ so google-genai SDK can find credentials
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

# Initialise Sentry as early as possible so even startup failures are captured.
# No-op unless SENTRY_DSN is set (local dev stays silent).
from api.observability.sentry import init_sentry

init_sentry("api")

# Initialize Firebase Admin SDK (must happen before auth imports use it)
from api.auth.dependencies import enforce_access
from api.auth.firebase_init import init_firebase

init_firebase()

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import ORJSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from api.errors import unhandled_exception_handler
from api.middleware.request_id import RequestIDMiddleware
from api.rate_limiting import limiter
from api.routers import admin as admin_router
from api.routers import agents as agents_router
from api.routers import watches as watches_router
from api.routers import watch_render as watch_render_router
from api.routers import artifact_shares as artifact_shares_router
from api.routers import artifacts as artifacts_router
from api.routers import auth as auth_router
from api.routers import billing as billing_router
from api.routers import channels as channels_router
from api.routers import briefing as briefing_router
from api.routers import briefing_shares as briefing_shares_router
from api.routers import chat as chat_router
from api.routers import collections as collections_router
from api.routers import dashboard as dashboard_router
from api.routers import dashboard_layouts as dashboard_layouts_router
from api.routers import dashboard_shares as dashboard_shares_router
from api.routers import explorer_layouts as explorer_layouts_router
from api.routers import feed as feed_router
from api.routers import feed_links as feed_links_router
from api.routers import health as health_router
from api.routers import internal as internal_router
from api.routers import media as media_router
from api.routers import orgs as orgs_router
from api.routers import posts as posts_router
from api.routers import sessions as sessions_router
from api.routers import settings as settings_router
from api.routers import share_html as share_html_router
from api.routers import topics as topics_router
from api.routers import waitlist as waitlist_router
from api.routers import whatsapp as whatsapp_router
from api.services.startup_tasks import cleanup_stuck_collections
from config.settings import get_settings

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app_: FastAPI):
    settings = get_settings()

    # Fail-closed startup gates - prod refuses to boot if the signup gate is
    # set to "allowlist" but `ALLOWED_EMAILS` is empty (would otherwise let
    # every Google account in silently), or if `SUPER_ADMIN_EMAILS` is empty
    # (admin endpoints would have nobody to authorise). Dev mode is exempt
    # so local backends don't require these to be populated.
    if not settings.is_dev:
        if settings.signup_gate == "allowlist" and not settings.allowed_emails.strip():
            raise RuntimeError(
                "SIGNUP_GATE=allowlist but ALLOWED_EMAILS is empty - refusing to start"
            )
        if not settings.super_admin_emails.strip():
            raise RuntimeError(
                "SUPER_ADMIN_EMAILS is empty in production - refusing to start"
            )

    async def _bg_cleanup() -> None:
        try:
            await asyncio.to_thread(cleanup_stuck_collections)
        except Exception:
            logger.exception("Startup cleanup of stuck collections failed (non-fatal)")

    # Run cleanup off the lifespan critical path so uvicorn --reload restarts
    # can start serving requests immediately. The sweep does Firestore + BrightData
    # I/O and used to block startup for tens of seconds on every reload.
    asyncio.create_task(_bg_cleanup())

    if settings.is_dev and settings.enable_dev_scheduler:
        from api.scheduler import OngoingScheduler
        scheduler = OngoingScheduler()
        scheduler.start()
    yield


# orjson encodes JSON several× faster than the stdlib encoder used by the
# default JSONResponse - a meaningful win on the large dashboard/share payloads
# and every other JSON route. Routes that return a Response directly (SSE,
# explicit ORJSONResponse) are unaffected.
app = FastAPI(
    title="Scolto",
    version="0.1.0",
    lifespan=lifespan,
    default_response_class=ORJSONResponse,
)

# Rate limiting
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

# Compress large JSON responses. The dashboard/share payload is ~8MB of post
# JSON sent uncompressed; gzip cuts that several-fold over the wire. minimum_size
# skips tiny responses where compression overhead isn't worth it. compresslevel=6
# (not Starlette's default 9) ~matches level 9's ratio on JSON at ~40% less CPU -
# level 9 of an 11.5MB payload is ~366ms of blocking gzip per uncached hit. The
# dashboard endpoints additionally cache the compressed bytes (dashboard_response).
app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=6)

# Global safety net for unhandled exceptions - keep AFTER more specific
# handlers (e.g. RateLimitExceeded). FastAPI runs `HTTPException` through
# its own built-in handler, so router-level raises with shaped detail
# bodies are unaffected.
app.add_exception_handler(Exception, unhandled_exception_handler)

# Request-ID middleware - must run before handlers so request_id is bound for
# the entire request lifecycle (cost telemetry, logs, downstream propagation).
app.add_middleware(RequestIDMiddleware)

# §E defense-in-depth: gate private data routers server-side so a blocked /
# expired-trial account can't fetch data via direct API calls (the UI also
# gates them). NOT applied to: public/shared (token) routers, /me (auth) - must
# work for blocked users to render the pending page, billing, admin (super-admin
# gated), media (proxies images for public shared dashboards), health, chat
# (already gated by require_active), and the public waitlist. No-op unless
# signup_gate=="entitlements"; anonymous + super admins always pass.
_gated = [Depends(enforce_access)]

# Include routers
app.include_router(settings_router.router)
app.include_router(channels_router.router, dependencies=_gated)
app.include_router(billing_router.router)
app.include_router(sessions_router.router, dependencies=_gated)
app.include_router(admin_router.router)
app.include_router(dashboard_router.router, dependencies=_gated)
app.include_router(dashboard_shares_router.router)
app.include_router(dashboard_layouts_router.router, dependencies=_gated)
app.include_router(explorer_layouts_router.router, dependencies=_gated)
app.include_router(artifacts_router.router, dependencies=_gated)
app.include_router(artifact_shares_router.router)
app.include_router(topics_router.router, dependencies=_gated)
app.include_router(briefing_router.router, dependencies=_gated)
app.include_router(briefing_shares_router.router)
app.include_router(feed_links_router.router)
app.include_router(auth_router.router)
app.include_router(orgs_router.router)
app.include_router(media_router.router)
# Ungated: the headless watch-widget renderer authenticates with a scoped render
# token, not a Firebase session (see api/routers/watch_render.py).
app.include_router(watch_render_router.router)
app.include_router(health_router.router)
app.include_router(collections_router.router, dependencies=_gated)
app.include_router(feed_router.router, dependencies=_gated)
app.include_router(agents_router.router, dependencies=_gated)
app.include_router(watches_router.router, dependencies=_gated)
app.include_router(posts_router.router, dependencies=_gated)
app.include_router(chat_router.router)
app.include_router(internal_router.router)
app.include_router(waitlist_router.router)
# WhatsApp webhook — no auth (Meta-signed via X-Hub-Signature-256, like billing).
app.include_router(whatsapp_router.router)
# Mounted last because its routes (`/shared/{token}`, `/shared/briefing/{token}`,
# `/shared/artifact/{token}`, `/og-image/{type}/{token}.png`) are hit via
# Firebase Hosting rewrite to serve crawler-friendly HTML; ordering doesn't
# matter functionally but it documents the integration boundary.
app.include_router(share_html_router.router)

# CORS middleware - permissive in dev, configurable via CORS_ORIGINS env var in prod
_settings = get_settings()
if _settings.is_dev:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    logger.info("CORS: allow_origins=['*'] (dev mode)")
else:
    _cors_origins = [o.strip() for o in _settings.cors_origins.split(",") if o.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    logger.info("CORS origins: %s", _cors_origins)
