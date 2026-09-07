# Changelog

## 2.15.1 — 2026-09-07

Runtime optimizations on the 2.15 modular monolith (no `/api` path changes, no UI rewrite).

- Isolated providers: `lib/notify.js` (SMTP/Twilio), `lib/google.js`, `lib/crypto.js`, `lib/validate.js`
- Cache locale JSON and avatar catalog in memory
- Cache-Control: avatars/images immutable 1 day; HTML/JS/CSS/SW `no-cache`
- Gzip JSON only on `/api` (level 3)
- Persist compact JSON in production; prune expired sessions/OTPs at most once a minute (writes still immediate)
- Static denylist: `package.json`, `tests/`, `docs/`, Docker/CI files

## 2.15.0 — 2026-09-07

Architectural modernization **without** breaking `/api` paths or rewriting the UI.

- Central `config/` (VERSION, env, rates)
- `modules/families/invites.js` public invite helpers
- `modules/*/index.js` facades for attach modules
- `lib/errors.js` + unhandled error middleware
- `/api/ready`
- Backend sources no longer served as static files
- `npm run arch` / `npm run lint`
- Removed accidental copies under `uploads/`
- Docs under `docs/`

## 2.14.0

Url-safe family invites (QR / paste / `/invite/TOKEN`), lock-screen push TTL + call ring, People directory, feed comments.

## 2.13.0

Named hobby rooms, marketplace visibility, extra STUN, delete-for-me, dropdown contrast.
