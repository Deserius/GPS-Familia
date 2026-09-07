# Testing

```bash
npm test                 # HTTP + WebSocket suites (starts server unless --no-start)
npm run test:security
npm run test:sast
npm run arch             # require() cycles + module facades
npm run lint             # node --check on CommonJS
npm run test:ci          # all of the above
```

Suites live in `tests/suites/` and talk to a live server (no exploit payloads).
Reports: `tests/reports/latest.md`. Plan: `tests/TEST-PLAN.md`.

Tests must stay isolated: each suite registers or logs in as needed. Demo users
(`vito@familia.test` / `demo123`) are seeded when `DEMO_MODE` is on.

Browser `app.js` is ESM — `node --check app.js` is not used (strip imports in ad-hoc checks).
