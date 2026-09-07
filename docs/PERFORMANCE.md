# Performance

## Baseline (this repo, Node 20, local)

| Metric | Observed |
|---|---|
| Full test suite | ~3.0–3.5 s wall, 372+ assertions |
| `GET /api/health` burst of 20 | all 200 (see saas suite) |
| Process | single Node, in-memory DB |

No CDN/bundle pipeline — the browser loads `app.js` as ESM plus `ui-*.js`.

## Rules already in force

- Gzip JSON over 800 bytes on `/api` only (`lib/gzip.js`, level 3).
- Locale catalogs and avatar catalog cached in process memory.
- Lazy Google / LiveKit / QR until needed.
- Message list capped; location history capped.
- Marketplace filters run on the server.
- Static HTML/app.js/sw.js `no-cache`; avatars/images `max-age=86400, immutable`.
- Production persist is compact JSON; expired sessions/OTPs pruned at most once per minute. `saveData()` is still synchronous and immediate.

## Do not

- Debounce `saveData()` without tests — suites expect immediate persist.
- Add a bundler unless you measure first-load on phones.
