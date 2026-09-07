# Architecture audit (baseline → v2.15.0)

## Existing architecture

GPS FAMILIA is a family location + encrypted chat + calling PWA. The Node server
(`server.js`) serves static files, REST, and a WebSocket at `/ws`. Persistence is a
single JSON file. Domain code was already extracted into `*-server.js` attach modules.
The browser is one large `app.js` (map, auth, inbox, help) plus focused `ui-*.js` panels.

## Directory structure (important)

| Path | Role |
|---|---|
| `server.js` | Composition root: auth, GPS, families, inbox, WS |
| `config/` | Env load + VERSION + rate limits |
| `lib/` | Structured log, gzip, errors |
| `modules/` | Public facades + extracted invite helpers |
| `community-server.js` | Feed, people hub, family admin |
| `social-server.js` | Friends / block / report |
| `rooms-server.js` | Hobby rooms |
| `market-server.js` | Marketplace |
| `pay-server.js` | Payments (Stripe/Plaid or PCI-safe demo) |
| `calls-server.js` | Calls + ICE + LiveKit JWT |
| `push.js` | Web Push |
| `security.js` | Helmet-equivalent headers, CORS, rate limit |
| `app.js` | Browser composition root (do not truncate) |
| `ui-*.js` | Feed, market, call, community panels |
| `tests/` | HTTP + WS suites |
| `docs/` | Operator + architecture docs |
| `f360_data.json` | Data (gitignored) |
| `uploads/` | User media only |

## Technical debt (accepted vs addressed)

| Item | Status |
|---|---|
| `app.js` ~240 KB UI god file | **Accepted** — strangler via `ui-*.js`; rewriting breaks the product |
| `server.js` still owns inbox/GPS/auth routes | **Accepted** — thin attach() already used for other domains; inbox not rebuilt |
| JSON file DB | **Accepted** — no SQL migration in this pass |
| No `/api/v1` prefix | **Accepted** — backward compatible; documented |
| Duplicate source copies in `uploads/` | **Removed** |
| Invite token matching inlined in `server.js` | **Extracted** to `modules/families/invites.js` |
| Env vars scattered | **Centralized** in `config/` |
| Backend JS served by `express.static` | **Blocked** |
| Missing `/api/ready` | **Added** |
| No circular-require check | **Added** `npm run arch` |

## Dependencies

Runtime: `express`, `ws`, `cors`, `web-push`, `nodemailer`. No unused duplicates.
Leaflet, qrcode, livekit-client load from CDN / esm.sh in the browser only.
Do not add a second HTTP or WebSocket library.

## Known oversized files

- `app.js` — UI composition root (help, map, inbox glue).
- `server.js` — HTTP/WS composition root.
- `community-server.js` — feed + people + family admin (one product area).
