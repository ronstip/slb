"""Statistical Signature service — re-exports from workers.shared.statistical_signature.

All logic now lives in workers/shared/ so both the API and worker can use it.
"""

from workers.shared.statistical_signature import (  # noqa: F401
    compute_statistical_signature,
    refresh_statistical_signature,
)
