# GPS FAMILIA — test suite

Production-oriented **operability** and **defensive security** tests for the full stack (HTTP + WebSocket). They talk to a running server the same way the PWA does.

These scripts **do not** include exploit payloads. They only check that the app refuses bad input, hides secrets, and keeps location/chat inside the right families.

## Run

From the project root, with Node 18+:

```bash
npm install
npm start          # in another terminal, or skip if already up
npm test
```

Useful variants:

```bash
node tests/run-all.js
node tests/run-all.js --base http://127.0.0.1:3000
node tests/run-all.js --only security
node tests/run-all.js --only realtime,calls
node tests/run-all.js --no-start          # fail if the server is down
```

`npm test` starts `server.js` automatically if `/api/health` is not up.

Demo seed must be on (`DEMO_MODE=true`, the default) so Vito/Sonny/Tessio isolation cases run.

## What each script covers

| Suite | File | SaaS area |
|---|---|---|
| `health` | `suites/01-health-pwa.js` | Health, `/api/config`, PWA shell, 65 avatars |
| `auth` | `suites/02-auth-account.js` | Register, login, OTP, demo, password, logout, Google rejection |
| `security` | `suites/03-security.js` | Headers, blocked secrets, 401s, location/chat isolation, roles |
| `families` | `suites/04-families-location.js` | Create/join/invite, GPS, history, privacy prefs, custom roles |
| `realtime` | `suites/05-realtime-messaging.js` | WS auth, ping, encrypted DMs, typing, live location, SOS |
| `community` | `suites/06-feed-rooms-people.js` | Feed audience, rooms, like/comment/share, people invites |
| `calls` | `suites/07-calls.js` | Matrix whoami, ICE, ring/accept/hangup, `m.call.invite` |
| `saas` | `suites/08-saas-ops.js` | Places, media upload, Web Push subscribe, load, account delete |

Plan / coverage matrix: `TEST-PLAN.md`.

## Reports

Every run writes:

- `tests/reports/latest.md` — human table (open this)
- `tests/reports/latest.json` — machine-readable
- `tests/reports/run-<timestamp>.md` / `.json` — history

Statuses:

- **PASS** — assertion held
- **FAIL** — production defect or regression (runner exits `1`)
- **WARN** — acceptable in demo, tighten before a public host
- `/api/config` must **not** include `demoPassword` (SAST + health suite enforce this)
- **SKIP** — optional dependency missing

## Interpreting WARNs before go-live

Set in `.env` then re-run `npm test`:

```
DEMO_MODE=false
OTP_ECHO=false
```

Expected: demo login/OTP shortcuts stop working (those cases will fail — that is the point). Health, auth, isolation, realtime, and calls should still pass with freshly registered users.

## Adding a check

1. Open the matching file under `tests/suites/`.
2. Use `t.check(name, cond, detail)`, `t.expectStatus(res, 401, "…")`, `t.hasNoSecret(json, "…")`.
3. Do **not** add exploit PoCs, fuzz bombs, or payloads meant to crash the host.
4. Re-run `npm test` and commit `tests/reports/latest.md` if you want a snapshot in git.
