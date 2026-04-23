import logging
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

# Load .env into os.environ so google-genai SDK can find credentials
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

# Initialize Firebase Admin SDK (must happen before auth imports use it)
from api.auth.firebase_init import init_firebase

init_firebase()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from api.rate_limiting import limiter
from api.routers import admin as admin_router
from api.routers import agents as agents_router
from api.routers import artifacts as artifacts_router
from api.routers import auth as auth_router
from api.routers import billing as billing_router
from api.routers import briefing as briefing_router
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
from api.routers import sessions as sessions_router
from api.routers import settings as settings_router
from api.routers import topics as topics_router
from api.services.startup_tasks import cleanup_stuck_collections
from config.settings import get_settings

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app_: FastAPI):
    settings = get_settings()
    try:
        cleanup_stuck_collections()
    except Exception:
        # Non-fatal: startup must proceed even if cleanup fails. Stuck
        # collections remain in a transient state until the next boot.
        logger.exception("Startup cleanup of stuck collections failed (non-fatal)")
    if settings.is_dev:
        from api.scheduler import OngoingScheduler
        scheduler = OngoingScheduler()
        scheduler.start()
    yield


app = FastAPI(title="Veille", version="0.1.0", lifespan=lifespan)

# Rate limiting
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

# Include routers
app.include_router(settings_router.router)
app.include_router(billing_router.router)
app.include_router(sessions_router.router)
app.include_router(admin_router.router)
app.include_router(dashboard_router.router)
app.include_router(dashboard_shares_router.router)
app.include_router(dashboard_layouts_router.router)
app.include_router(explorer_layouts_router.router)
app.include_router(artifacts_router.router)
app.include_router(topics_router.router)
app.include_router(briefing_router.router)
app.include_router(feed_links_router.router)
app.include_router(auth_router.router)
app.include_router(orgs_router.router)
app.include_router(media_router.router)
app.include_router(health_router.router)
app.include_router(collections_router.router)
app.include_router(feed_router.router)
app.include_router(agents_router.router)
app.include_router(chat_router.router)
app.include_router(internal_router.router)

# CORS middleware — permissive in dev, configurable via CORS_ORIGINS env var in prod
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
