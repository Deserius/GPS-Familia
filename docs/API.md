# API map (actual routes)

Auth: `Authorization: Bearer <sessionToken>` unless noted. Errors: `{ "error": "<code or phrase>" }` plus `X-Request-Id`.
Success bodies typically include `ok: true`. **Do not rename these paths.**

OpenAPI sketch: `openapi.yaml` (not a complete generated spec).

## System

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/health` | no | version, uptime, rssMb |
| GET | `/api/ready` | no | readiness |
| GET | `/api/diag` | no | demo/`DEBUG_API=1` only; counts, no secrets |
| GET | `/api/config` | no | public flags, vapidPublic, ice, no demoPassword |
| GET | `/api/i18n` | no | `?lang=en\|es` |

## Auth / account

| Method | Path | Auth |
|---|---|---|
| POST | `/api/register` | no |
| POST | `/api/login` | no |
| POST | `/api/logout` | yes |
| POST | `/api/send-otp` | no (rate limited) |
| POST | `/api/verify-otp` | no |
| POST | `/api/auth/google` | no |
| POST | `/api/setup/google` | optional |
| GET/PUT | `/api/me` | yes |
| POST | `/api/me/password` | yes |
| DELETE | `/api/me` | yes |
| GET | `/api/avatars` | no |
| POST | `/api/me/profile` | yes |
| GET | `/api/demo/accounts` | no (demo) |
| POST | `/api/demo/login` | no (demo) |

## Families, location, search

| Method | Path | Auth |
|---|---|---|
| GET | `/api/search` | yes |
| GET | `/api/sync` | yes |
| POST | `/api/location` | yes |
| GET | `/api/locations` | yes |
| GET | `/api/users/:id` | yes |
| GET | `/api/users/:id/relationship` | yes |
| GET | `/api/users/:id/history` | yes (family + privilege) |
| DELETE | `/api/me/history` | yes |
| GET/POST | `/api/families` | yes |
| POST | `/api/families/join` | yes (invite token) |
| POST | `/api/families/:id/join` | yes |
| POST | `/api/families/:id/leave` | yes |
| POST | `/api/families/:id/invite` | yes |
| GET/POST | `/api/invite/preview` | yes |
| GET | `/invite/:token` | no | 302 → `/?invite=` |
| GET | `/api/families/:id/briefing` | yes |
| GET/PATCH | `/api/families/:id` admin/roles | yes |

## Messaging

| Method | Path | Auth |
|---|---|---|
| GET | `/api/inbox` | yes |
| GET | `/api/messages` | yes `?with=` / `?family=` / `?room=` |
| POST | `/api/messages` | yes |
| POST | `/api/messages/read` | yes |
| DELETE | `/api/messages/:id` | yes |
| POST | `/api/sos` | yes |

## Community / rooms / social / market / pay / calls / push

See attach modules. Prefixes: `/api/feed`, `/api/posts`, `/api/people`, `/api/rooms`, `/api/friends`, `/api/blocks`, `/api/reports`, `/api/market`, `/api/pay`, `/api/calls`, `/api/matrix/whoami`, `/api/push`, `/api/notifications`, `/api/qr`, `/api/message-requests`.

QR: `POST /api/qr/generate`, `POST /api/qr/resolve`, `GET /qr/:token` (302 → `/?qr=`). Scanning never auto-friends or auto-joins.

## WebSocket

`GET /ws?token=<sessionToken>` — location, typing, `type:"call"` signaling. Not REST.
