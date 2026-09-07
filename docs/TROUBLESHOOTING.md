# Troubleshooting

### Application won't start
- `node -v` must be 18+.
- `npm install` (sandbox/CI often wipe `node_modules`).
- Port 3000 busy: set `PORT`.
- Logs: JSON lines from `lib/log.js` (`msg":"listen"`).

### API returns 401
- REST needs `Authorization: Bearer`, not `?token=` (WS is the exception).
- Session expired (30 days) or logged out.

### API returns 500
- Check `X-Request-Id` and the matching JSON log line.
- Unhandled errors go through `lib/errors.js` `unhandled` (no stack in the body).

### Invalid invite / bad token
- Use a **fresh** QR from Invite / QR after v2.14 (url-safe tokens).
- Phone camera, in-app Scan QR, and paste all go through `/api/invite/preview`.

### No lock-screen alerts
- Allow notifications. iPhone: Add to Home Screen. VAPID keys must be stable across deploys.

### WebSocket offline
- Preview/proxy must allow `wss:`. Token on `/ws?token=`.

### Frontend can't reach API
- Same origin. CORS: localhost always; production uses `CORS_ORIGIN`.
- Do not call `127.0.0.1` from browser code in the hosted preview.

### Database
- Missing `f360_data.json` → empty DB then seed if `DEMO_MODE`.
- Permission to write `DATA_FILE`.

### External providers
- Stripe/Plaid/LiveKit/Twilio unset → demo/P2P/OTP_ECHO paths. Failures are logged; they must not crash HTTP.

### Build / TypeScript
- There is no compile step or TypeScript. `npm run lint` is `node --check`.
