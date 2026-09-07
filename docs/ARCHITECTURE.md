# GPS FAMILIA — architecture (v2.16.0)

This is a **modular monolith**: one Node process, one JSON data file, one browser app.
Modules are already split by domain (`*-server.js`). `server.js` is the composition root.
The browser UI remains `app.js` + `ui-*.js` (ESM). **Do not rewrite those files** unless you are fixing a bug in that domain.

## Runtime

```
Browser (index.html + app.js + ui-*.js + sw.js)
        HTTPS / WSS
Node (server.js)
  ├── config/                 env + VERSION
  ├── lib/                    log, gzip, errors
  ├── security.js             headers, CORS, rate limits
  ├── modules/families        invite tokens (extracted)
  ├── community-server.js     feed, people hub, family admin
  ├── social-server.js        friends, block, report, relationship
  ├── notify-server.js        in-app notification center
  ├── qr-server.js            personal / payment / app QR (confirm required)
  ├── modules/social/graph.js relationship state machine
  ├── rooms-server.js         hobby rooms
  ├── market-server.js        marketplace
  ├── pay-server.js           wallet / Stripe-or-demo / Plaid-or-demo
  ├── calls-server.js         WebRTC signaling + ICE
  ├── push.js                 Web Push
  └── f360_data.json          single persistence file
```

## Request path

```
HTTP
  → security headers + CORS + requestId logger + gzip + JSON
  → rate limit
  → path denylist (secrets, backend sources)
  → route (auth middleware when required)
  → domain attach() handler
  → DB in memory + saveData()
  → JSON { ok, ... } or { error }
```

Realtime: `GET /ws?token=SESSION` (query token is **WebSocket-only**; REST is Bearer).

## How to add a feature

1. New API: `feature-server.js` with `attach({ app, DB, auth, ... })`.
2. `require` + `attach` from `server.js` (one block).
3. Optional public facade: `modules/<domain>/index.js`.
4. UI: `ui-feature.js` imported from `app.js` or opened from a panel.
5. Tests: `tests/suites/NN-feature.js` registered in `tests/run-all.js`.
6. Bump `config/index.js` `VERSION` and `sw.js` cache if the shell changed.

## API versioning

Public routes stay under `/api/...` (no `/api/v1` prefix). Existing clients and the PWA
depend on these paths. A future `/api/v2` can sit beside them; do not rename in place.

## What we will not do

- Split into microservices.
- Rewrite `app.js` / `rooms-server.js` / the inbox into a new framework.
- Introduce a SQL database without a migration plan (current store is `f360_data.json`).
