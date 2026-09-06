# Security policy — GPS FAMILIA

## Secrets

Never commit `.env` or `f360_data.json`. Those files hold session tokens, scrypt password hashes, and VAPID private keys.

| Secret | Where it lives | Rotate |
|---|---|---|
| Session tokens | `f360_data.json` → `sessions` | Sign everyone out (delete sessions) |
| User / family passwords | scrypt hashes in `f360_data.json` | Users change passwords in-app |
| VAPID private key | `.env` `VAPID_PRIVATE` or auto-saved settings | Generate new keys; existing phone subscriptions must re-subscribe |
| Google OAuth | `.env` `GOOGLE_CLIENT_ID` | Google Cloud Console |
| LiveKit / TURN / Twilio / SMTP | `.env` only | Provider dashboards |

Demo password is **not** returned by `/api/config`. Local demo login is `DEMO_PASSWORD` (default `demo123` only when `DEMO_MODE=true`). Set `DEMO_MODE=false` and `OTP_ECHO=false` on any public host.

## HTTP auth

Protected APIs accept **only**:

- `Authorization: Bearer <sessionToken>`
- `X-Session-Token` (native wrappers)

Tokens in query strings are **rejected** on REST (they leak in logs and Referer). WebSocket still uses `?token=` because browsers cannot set WS headers; use `wss://` in production.

## Headers & abuse controls

`security.js` sets CSP, `X-Frame-Options: DENY`, nosniff, Referrer-Policy, Permissions-Policy, and HSTS on HTTPS. Login / register / OTP are rate-limited per IP. CORS is an allow-list (`CORS_ORIGIN`).

## Reporting

Email the operator who hosts this copy, or open an in-app Help → Terms contact. Do not attach exploit payloads.

## Payments

`STRIPE_SECRET_KEY` and `PLAID_SECRET` stay in `.env`. `/api/config` and `/api/pay/wallet` never return them. The API rejects bodies that include a full card number, CVC, or bank account/routing number. Stored methods are last4 + brand + expiry (or a Stripe/Plaid token id).
