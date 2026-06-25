# build — `channels/` package missing from API & worker Docker images

## Symptom
Prod deploy of `sl-api` failed (CI run 28173538816, 2026-06-25):

```
ERROR: (gcloud.run.deploy) Container failed to become healthy.
Startup probes timed out after 4m
```

Cloud Run startup log showed the real cause — an import crash at boot:

```
File "/app/api/main.py", line 62, in <module>
    from api.routers import whatsapp as whatsapp_router
File "/app/api/routers/whatsapp.py", line 17, in <module>
    from channels.whatsapp.client import verify_signature
ModuleNotFoundError: No module named 'channels'
```

## Root cause
The WhatsApp channel introduced a new **top-level package** `channels/`. Both
`api/Dockerfile` and `workers/Dockerfile` copy the app code with an explicit
allow-list of dirs (`config/ api/ workers/ bigquery/`) and never picked up
`channels/`.

- **API** imports `channels.*` at module load (`api/main.py` includes the
  whatsapp router) → container never binds the port → startup probe times out →
  deploy fails.
- **Worker** imports `channels.*` only **lazily** (inside the `/whatsapp/inbound`
  route handler), so the container started fine and the deploy "succeeded" — but
  it carried the same latent bug and would have `ModuleNotFoundError`'d at
  runtime on the first inbound WhatsApp message.

`.dockerignore` was not the culprit (only `*.md`/`*.pyc`); the dirs are an
explicit COPY allow-list, so any new top-level package must be added by hand.

## Fix
Add `COPY channels/ channels/` to both Dockerfiles (alongside `api/`):
- `api/Dockerfile`
- `workers/Dockerfile`

## Regression guard
No unit test covers Docker build contents. Guard heuristic for future top-level
packages: when adding a new importable top-level dir, grep both Dockerfiles for a
matching `COPY` line. Consider switching the COPY allow-list to a single
`COPY . .` (with a tighter `.dockerignore`) so new packages are included by
default — deferred to avoid bloating the image in this hotfix.

## Commit
Fix on branch `whatsapp_channel` → main (follow-up to PR #57).
