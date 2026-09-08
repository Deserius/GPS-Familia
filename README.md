# GPS-FAMILIA

Family location sharing, **encrypted** messaging, and voice/video calling.
Other users’ locations are **never** shown unless they belong to one of your families.

**Version 2.17.0** — live tracking pins, reliable family create, child accounts, Deserius Arte copyright. Built on people discovery, relationship state, message requests, in-app notifications, personal/payment QR (validate then confirm — never auto-friend or auto-join). Built on the 2.15 modular monolith.

## Run locally (one command)

**Windows:** double-click `Start.bat`  
**macOS / Linux:** `python3 start.py`

Or:

```bash
npm install
cp .env.example .env
npm run dev
```

Demo login: `vito@familia.test` / `demo123`. OTP: `000000`.

In-app **?** is for family users. Hosting/APK/server internals: `DEPLOY.txt`, `DEVELOPER.txt`, and `docs/`.

## Architecture

This is a **modular monolith**, not microservices. Start at `docs/ARCHITECTURE.md`.

| Doc | Contents |
|---|---|
| `docs/ARCHITECTURE.md` | Layers, how to add a feature |
| `docs/API.md` | Route map (paths unchanged) |
| `docs/DEVELOPMENT.md` | Commands |
| `docs/TROUBLESHOOTING.md` | Failures |
| `DEPLOY.txt` | Hosting / APK / iOS checklists |

## Tests

```bash
npm test
npm run arch
npm run lint
npm run test:sast
```

Reports: `tests/reports/latest.md`.

Health: `GET /api/health` and `GET /api/ready` → `version: "2.17.0"`.
