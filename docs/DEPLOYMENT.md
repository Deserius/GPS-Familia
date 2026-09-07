# Deployment

The operator checklist is **DEPLOY.txt** (copy-paste, including Render as the easiest free host,
PWABuilder APK, iPhone Home Screen, LiveKit/TURN).

Short path:

```bash
docker compose up --build
# or: node server.js with HOST=0.0.0.0 PORT=$PORT
```

Health: `GET /api/health` and `GET /api/ready`. Dockerfile already HEALTHCHECKs `/api/health`.

Production: `NODE_ENV=production`, `DEMO_MODE=false`, `OTP_ECHO=false`, persist `DATA_FILE` and `uploads/`.
Copy VAPID keys into `.env` so existing phone subscriptions keep working.
