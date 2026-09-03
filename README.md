# GPS-FAMILIA

Family location sharing and **encrypted** messaging. Other users’ locations are **never** shown unless they belong to one of your families. You can join as many families as you want.

## Run locally (one command)

**Windows:** double-click `Start.bat`  
**macOS / Linux:** `python3 start.py`

That script installs Node dependencies, writes a default `.env`, starts the server, and opens your browser to `http://127.0.0.1:3000/`.

Tap **?** in the app for the illustrated help center.

## Deploy, Android APK, iOS

Open **DEPLOY.txt** — full checklists:

- Easiest free host (Render.com)
- Google Sign-In (free Cloud client ID)
- PWABuilder APK
- iPhone Add to Home Screen
- Production hardening

## Manual

```bash
npm install
cp .env.example .env
node server.js
```

## Configuration

Edit `.env` (see `.env.example`):

| Variable | Purpose |
|---|---|
| `PORT` | HTTP port (default `3000`) |
| `OTP_ECHO` | Return OTP in the API for local/dev (set `false` in production) |
| `GOOGLE_CLIENT_ID` | Google Sign-In Web Client ID |
| `SMTP_*` / `FROM_EMAIL` | Email OTPs and welcome mail |
| `TWILIO_*` | SMS OTPs |

Realtime location and chat go over WebSocket at `/ws`. The app is a PWA (`manifest.json` + `sw.js`).
