# Pre-flight cost estimator ignored the admin scraper-rate matrix

## Symptom

Editing a scraper rate in Admin → Finance → "Rates & profit margin" (the
per-(provider, platform) "Scrapers / crawlers" matrix) changed **live billing**
(`cost_meter`) but NOT the **pre-flight estimate** the credit gate uses. So
raising e.g. BrightData's rate made real runs cost more while the gate kept
quoting the old, cheaper estimate → a run could be admitted that the wallet
can't actually cover. Margin and the Apify wildcard already flowed through; the
per-platform cells and BrightData/X_api rates did not.

## Root cause

The matrix is persisted to Firestore key `scraper_rates_per_platform` and read
only via `cost_rates.get_scraper_rate()`. The estimator
([cost_estimate.py](../../api/services/cost_estimate.py)
`_provider_per_post_usd`) instead read the **legacy** path
`get_active_rates()["brightdata"]["*"]["per_record_usd"]` (and the x_api/vetric
equivalents), which only reflects the separate `rate_overrides` key. The Finance
editor no longer even renders those legacy single-rate inputs, so the matrix was
the *only* way to edit those rates — and the estimator was blind to it.

## Fix

- `_provider_per_post_usd(provider, platform=None)` now consults
  `get_scraper_rate(provider, platform, "posts")` FIRST (the same source
  `compute_cost_micros` uses), falling back to the legacy COST_RATES entry only
  when no matrix cell is set. Estimate and actual billing now move in lockstep.
- `estimate_run_cost_micros` gained `provider_platform_pairs` so per-platform
  cells are consulted with their platform. `estimate_request_micros`
  ([collection_service.py](../../api/services/collection_service.py)) builds the
  (provider, platform) pairs from `request.platforms` + `vendor_config`
  (per-platform override else vendor default).

## Regression tests

- `api/tests/test_cost_estimate.py::test_estimate_uses_scraper_matrix_override`
  (matrix override flows into the estimate)
- `…::test_estimate_matrix_override_is_per_platform` (per-platform cell consulted
  with its platform)
- Autouse fixture now pins `get_scraper_rate → None` so the existing exact-value
  assertions stay on the legacy seed path.

## Fix commit

Branch `dev` (uncommitted at time of writing). Update with SHA on commit.
