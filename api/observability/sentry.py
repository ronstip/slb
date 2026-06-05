"""Sentry initialisation for the API and worker services (PRODUCTION_PLAN.md §C.1).

Shared by both Cloud Run services - call ``init_sentry("api")`` from
``api/main.py`` and ``init_sentry("worker")`` from ``workers/server.py``. The
``service`` tag lets us split the two in the Sentry UI even though they report
to the same Python project.

Design:
- **No-op without a DSN.** Local dev leaves ``SENTRY_DSN`` unset, so nothing is
  sent and the SDK stays dormant.
- **Errors-only by default.** ``traces``/``profiles`` sample rates default to
  ``0.0`` (see config/settings.py); bump the ``SENTRY_*_SAMPLE_RATE`` env vars to
  experiment with tracing/profiling without a code change. At ``0`` no spans are
  sent, so the Sentry free plan never bills.
- ``send_default_pii=False`` keeps emails / auth headers / request bodies out of
  Sentry (aligns with PRODUCTION_PLAN.md §B.7 "PII out of logs").
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

_initialised = False


def init_sentry(service: str) -> None:
    """Initialise Sentry for the given service (``"api"`` or ``"worker"``).

    Safe to call more than once (idempotent) and safe to call without a DSN.
    """
    global _initialised
    if _initialised:
        return

    from config.settings import get_settings

    settings = get_settings()
    if not settings.sentry_dsn:
        return

    import sentry_sdk

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.sentry_environment or settings.environment,
        traces_sample_rate=settings.sentry_traces_sample_rate,
        profiles_sample_rate=settings.sentry_profiles_sample_rate,
        send_default_pii=False,
    )
    sentry_sdk.set_tag("service", service)
    _initialised = True
    logger.info("Sentry initialised (service=%s, env=%s)", service, settings.sentry_environment or settings.environment)
