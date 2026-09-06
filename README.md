# GPS-FAMILIA

Family location sharing, **encrypted** messaging, and voice/video calling.
Other users’ locations are **never** shown unless they belong to one of your families. You can join as many families as you want.

**Version 2.11.0** — phone bottom dock, faster boot, gzip API, request logs, `/api/diag`. Calling, friends, marketplace P2P (6.9% buyer fee).

## Run locally (one command)

**Windows:** double-click `Start.bat`  
**macOS / Linux:** `python3 start.py`

That script installs Node dependencies, writes a default `.env`, starts the server, and opens your browser to `http://127.0.0.1:3000/`.

Demo login: `vito@familia.test` / `demo123` (or tap a sample family member). OTP: `000000`.

Tap **?** in the app for the illustrated help center (user-facing). Hosting, APK, and server internals live in the root text files — not in Help.

## Deploy, Android APK, iOS

- **DEPLOY.txt** — copy-paste checklists: Render (easiest free host), Google Sign-In, PWABuilder APK, iPhone Add to Home Screen, LiveKit/TURN, production hardening.
- **DEVELOPER.txt** — architecture, APIs, WebSocket events, calling, avatars, data files, how to extend.

## Tests (security + operability)

```bash
npm test
```

Talks to the live server over HTTP and WebSocket (auth, family isolation, encrypted messaging, calls, feed, rooms). Writes `tests/reports/latest.md`. Full matrix: `tests/TEST-PLAN.md`. How to run subsets: `tests/README.md`.

```bash
npm run test:security
npm run test:realtime
node tests/run-all.js --base http://127.0.0.1:3000 --only auth,families
npm run test:sast
```

Docker: `docker compose up --build` (see DEPLOY.txt section Z). English/Español via ☰ → Language.


## Manual

```bash
npm install
cp .env.example .env
node server.js
```

Health: `http://127.0.0.1:3000/api/health` → `{"ok":true,"version":"2.11.0",...}`

## Configuration

Edit `.env` (see `.env.example`):

| Variable | Purpose |
|---|---|
| `PORT` | HTTP port (default `3000`) |
| `OTP_ECHO` | Return OTP in the API for local/dev (set `false` in production) |
| `DEMO_MODE` | Sample family members + OTP `000000` (set `false` in production) |
| `GOOGLE_CLIENT_ID` | Google Sign-In Web Client ID |
| `SMTP_*` / `FROM_EMAIL` | Email OTPs and welcome mail |
| `TWILIO_*` | SMS OTPs |
| `VAPID_*` | Web Push keys (auto-created on first boot if blank) |
| `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | Optional SFU for calls; blank = P2P + STUN |
| `TURN_*` | Optional TURN for strict NATs |
| `MATRIX_HOMESERVER` | Optional external Matrix; not required |

Realtime location, chat, and call signaling go over WebSocket at `/ws`. The app is a PWA (`manifest.json` + `sw.js`).
