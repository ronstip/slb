# api — iOS Safari won't play `<video>` served from /media

## Symptom
On a shared Brief (e.g. https://scolto.com/shared/wc26brands), the HTML widget
"It reads more than words … caught three ways" shows its **video** tile blank on
iPhone/iPad. Works on desktop web (Chrome/Firefox/desktop Safari).

## Repro
1. Open the share on iOS Safari.
2. The Text and Image tiles render; the Video tile (`<video src=.../…_0.mp4>`) is black/empty.

The widget markup is fine — it already has `autoplay muted loop playsinline preload="metadata"`.

## Root cause
Two defects in `GET /media/{path}` ([api/routers/media.py](../../api/routers/media.py)),
both of which iOS Safari is strict about and desktop browsers are lenient about:

1. **Wrong Content-Type.** The handler returned `blob.content_type`, and the GCS
   objects (mp4s mirrored from platform CDNs) are stored as
   `application/octet-stream`. iOS picks the `<video>` decoder from the MIME
   type; desktop sniffs the bytes.
2. **No Range support.** The handler advertised `Accept-Ranges: bytes` but
   ignored the `Range` request header, always streaming the full body with
   `200`. iOS treats a `200` answer to a Range request as "server has no range
   support" and refuses to play the clip.

Verified against prod:
```
curl -H 'Range: bytes=0-99' -D - -o /dev/null \
  https://sl-api-wyvdzmcjva-uc.a.run.app/media/.../2065151178376405034_0.mp4
# HTTP 200 (should be 206) ; content-type: application/octet-stream (should be video/mp4)
```

## Fix
`serve_media` now:
- Derives Content-Type from the file extension via `MEDIA_EXTENSIONS`
  (`.mp4 → video/mp4`), falling back to the blob type then octet-stream.
- Parses the `Range` header and returns `206 Partial Content` with a
  `Content-Range` header and only the requested bytes (`bytes=N-`, `bytes=-N`,
  and `bytes=a-b` forms), `416` for unsatisfiable ranges, and a full `200`
  otherwise. Streams the window via `blob.open("rb")` + `seek`.

## Regression test
[api/tests/test_serve_media.py](../../api/tests/test_serve_media.py) — MIME
derivation, `206` partial, open-ended range, `416` unsatisfiable, and the
`Accept-Ranges` advertisement.

## Status
Fixed on branch `dev` (not yet committed/deployed). The live share stays broken
on iOS until this ships to `main` (deploy.yml redeploys `sl-api` on push to main).
No frontend/widget change needed.
