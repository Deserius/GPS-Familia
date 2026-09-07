# GPS FAMILIA — full-stack SaaS test plan (v2.8.0)

This is the production checklist the automated suite (`npm test`) implements. Use it for release sign-off and for anyone extending the app.

Target: running server (`http://127.0.0.1:3000` locally, or `BASE_URL` / `--base` in CI).
Auth model: `Authorization: Bearer <sessionToken>`. Realtime: `ws://host/ws?token=…`.

Legend: **A** = automated in `tests/suites`, **M** = manual (browser / device).

---

## 1. Platform & PWA

| ID | Check | A/M | Suite |
|---|---|---|---|
| P1 | `GET /api/health` → `{ok, version: "2.8.0", realtime: true}` | A | health |
| P2 | `GET /api/config` exposes google/demo/push/calls/ice, never private keys | A | health |
| P3 | `index.html`, `styles.css`, `app.js`, `ui-*.js`, `sw.js` served | A | health |
| P4 | `manifest.json` + icons 192/512 | A | health |
| P5 | Service worker cache string `gps-familia-v*` | A | health |
| P6 | Avatar catalog 65 + first file 200 | A | health |
| P7 | Splash → Terms checkbox → I Agree (no blocking overlay) | M | — |
| P8 | Compact login + Create/Join family (30px fields, no form scroll) | M | — |
| P9 | Add to Home Screen / PWA install prompt | M | — |

## 2. Identity & session

| ID | Check | A/M | Suite |
|---|---|---|---|
| A1 | Register requires name, valid email, password ≥ 6 | A | auth |
| A2 | Duplicate email → 409 | A | auth |
| A3 | Login by email / demo seed | A | auth |
| A4 | Bad password / unknown user → 401 | A | auth |
| A5 | `/api/me` 401 without or with junk token | A | auth |
| A6 | Change password invalidates old credential | A | auth |
| A7 | Logout kills that session | A | auth |
| A8 | OTP send + verify (demo `000000`) | A | auth |
| A9 | Demo tap-login | A | auth |
| A10 | Google without credential → 400; fake JWT rejected | A | auth |
| A11 | Real Google OAuth (configured `GOOGLE_CLIENT_ID`) | M | — |
| A12 | Profile icon from catalog; `../` avatarId rejected | A | auth |
| A13 | Delete account (password, demo blocked) | A | saas |

## 3. Security (defensive)

| ID | Check | A/M | Suite |
|---|---|---|---|
| S1 | `X-Content-Type-Options: nosniff`, Referrer-Policy, no `X-Powered-By` | A | security |
| S2 | `/.env`, `f360_data.json`, `/node_modules` → 404, no secret body | A | security |
| S3 | Protected routes 401 when logged out | A | security |
| S4 | Login / me / sync JSON contain **no** `scrypt$` password hashes | A | security |
| S5 | Directory search never returns `lastLocation`; non-family contact masked | A | security |
| S6 | Location pins only for shared-family members with `viewLocation` | A | security |
| S7 | Guest (Kay) pin hidden from Head | A | security |
| S8 | History 403 for non-family | A | security |
| S9 | Family chat 403 for non-member | A | security |
| S10 | Outsider cannot admin / kick / transfer another family | A | security |
| S11 | Member cannot rename family (Head/Admin only) | A | security |
| S12 | Media rejects non photo/video MIME | A | security |
| S13 | HTTPS in production (GPS, mic, Google, Push) | M | deploy |
| S14 | Reverse proxy forwards WebSocket Upgrade | M | deploy |

## 4. Families, GPS, roles

| ID | Check | A/M | Suite |
|---|---|---|---|
| F1 | Create private family + hashed password | A | families |
| F2 | Wrong family password → 401; correct joins | A | families |
| F3 | Invite token join | A | families |
| F4 | Public family join without password | A | families |
| F5 | POST location + GET family pins | A | families |
| F6 | History recorded when `record: true` | A | families |
| F7 | `appearOnMap: false` hides pin | A | families |
| F8 | `preciseLocation: false` returns `approx: true` | A | families |
| F9 | Head admin + appoint Admin + custom role | A | families |
| F10 | Leave family stops pin visibility | A | families |
| F11 | Clear own history | A | families |
| F12 | Map +/−, refresh pins, tap name zooms (UI) | M | — |
| F13 | Track On continues after tab hide (SW ping) | M | — |

## 5. Messaging & realtime

| ID | Check | A/M | Suite |
|---|---|---|---|
| R1 | WS without/junk token closes `4401` | A | realtime |
| R2 | WS `hello` + `ping`/`pong` | A | realtime |
| R3 | Encrypted DM (`enc`) stored without plaintext | A | realtime |
| R4 | WS fans DM to the other device | A | realtime |
| R5 | Stranger cannot read that DM thread | A | realtime |
| R6 | Family encrypted message; outsider 403 | A | realtime |
| R7 | Typing indicator over WS | A | realtime |
| R8 | Live location over WS to family only | A | realtime |
| R9 | Inbox threads | A | realtime |
| R10 | SOS requires a family; WS `sos` event | A | realtime |
| R11 | Stranger cannot delete; sender can | A | realtime |
| R12 | Right-click / long-press delete in UI | M | — |
| R13 | Lock-screen Web Push after Allow | M | — |

## 6. Community, rooms, people

| ID | Check | A/M | Suite |
|---|---|---|---|
| C1 | Room topics + demo rooms | A | community |
| C2 | Private room invite-only; public join | A | community |
| C3 | Room messages 403 for non-members | A | community |
| C4 | Public vs family feed audience | A | community |
| C5 | Like, comment, share, author delete | A | community |
| C6 | People hub + invite accept; outsider cannot steal invite | A | community |
| C7 | Search rooms/posts | A | community |
| C8 | Feed right-side panel + chips (UI) | M | — |

## 7. Calling

| ID | Check | A/M | Suite |
|---|---|---|---|
| V1 | Matrix `whoami` mxid | A | calls |
| V2 | ICE STUN list | A | calls |
| V3 | Cannot call self | A | calls |
| V4 | Create video call → `ringing` | A | calls |
| V5 | WS `m.call.invite` to callee | A | calls |
| V6 | Non-participant GET call → 404 | A | calls |
| V7 | Accept → `active`; signal candidates; hangup | A | calls |
| V8 | Family call; outsider 403 | A | calls |
| V9 | LiveKit token or honest P2P 400 | A | calls |
| V10 | Two browsers: Vito 📞 Sonny with mic/cam | M | — |

## 8. SaaS operations

| ID | Check | A/M | Suite |
|---|---|---|---|
| O1 | Places CRUD + owner isolation | A | saas |
| O2 | JPEG upload → `/uploads/…` served | A | saas |
| O3 | Push subscribe validation + store | A | saas |
| O4 | 20× concurrent health | A | saas |
| O5 | Parallel demo logins | A | saas |
| O6 | Persist `f360_data.json` + `uploads/` on host | M | deploy |
| O7 | SMTP/Twilio real OTP when configured | M | deploy |
| O8 | Render/Fly/PWABuilder APK per `DEPLOY.txt` | M | deploy |

---

## Release gate

Ship only if `npm test` is **GREEN** (0 FAIL). WARNs are allowed in demo; before a public URL:

1. `DEMO_MODE=false` and `OTP_ECHO=false`
2. Set `GOOGLE_CLIENT_ID` if you want Google
3. Copy VAPID keys into `.env`
4. HTTPS + WebSocket upgrade on the proxy
5. Re-run `npm test` against that URL: `node tests/run-all.js --base https://your.host --no-start`
