# HikerAPI cost: app showed $0.0168, provider dashboard $0.14

**Area:** workers / config (cost metering for the HikerAPI provider)

## Symptom
Three "scrape" usage events for one agent summed to $0.0168 while the HikerAPI
dashboard showed ~$0.14 spent.

## Root causes (two stacked bugs)
1. **Double + wrong-unit logging.** The HikerAPI adapter logs its own
   authoritative cost event (`units=requests`, per-request billing), but the
   pipeline runner's generic scrape-cost block
   (`workers/pipeline/runner.py`, after `track_posts_collected`) ALSO emitted a
   `provider_call` event per batch with `units=posts` priced at the per-request
   rate. For the 38e37f18 run: 1 legit event (7 requests = $0.0042) + 2 bogus
   posts-priced events (3 + 18 posts = $0.0126).
2. **Wrong rate.** Seed rate was $0.0006/request — that's HikerAPI's
   ENTERPRISE floor (pricing is tiered by prepaid balance, $0.02 testing tier
   → $0.0006 at 1M+ requests). Our account measures $0.02/request:
   `GET /sys/balance` → `{requests: 54, amount: 1.16}` → 1.16/54 ≈ $0.0215.

## Fix
- `workers/pipeline/runner.py`: added `hikerapi` to the skip set (`apify`,
  `mock`, `unknown`) in the rate-table scrape-cost block — self-logging
  providers must not get a second per-post event.
- `config/cost_rates.py`: hikerapi seed rate `0.0006` → `0.02` (measured),
  comments document the tier mechanics and how to re-derive
  (balance ÷ requests from `/sys/balance`). Admin can lower it in the Finance
  rates matrix once a top-up unlocks a cheaper tier.

## Tests
`api/tests/test_cost_rates.py::test_hikerapi_*` (rate values, admin override).

## Note
`scripts/probe_hiker_balance.py` prints the account's live balance/remaining
requests. The undocumented `GET /sys/balance` endpoint is free and returns
`{requests, rate, currency, amount}` where `requests` = remaining requests at
the current tier. Not yet committed (branch `dev`).
