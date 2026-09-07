# Dependency map

Direction is **composition root → domain modules → lib**. Domain modules must not
`require("./server")`.

```
server.js
  ├── config/
  ├── lib/log.js
  ├── lib/gzip.js
  ├── lib/errors.js
  ├── security.js
  ├── modules/families/invites.js
  ├── community-server.js
  ├── social-server.js
  ├── rooms-server.js
  ├── market-server.js
  ├── pay-server.js
  ├── calls-server.js
  └── push.js

app.js (browser ESM)
  ├── ui-community.js → ui-feed.js
  ├── ui-call.js
  ├── ui-market.js
  └── i18n.js
```

## Rules

- **Direct:** `server.js` attaches each `*-server.js` with an explicit ctx object.
- **Indirect:** community uses `publicUser` / `sharesFamily` passed in ctx, not by importing server.
- **Circular:** none among CommonJS `require()` (enforced by `npm run arch`).
- **High-risk coupling:** in-memory `DB` object shared by reference. That is intentional for a single-process JSON store. Do not mutate `DB` from a worker process.
- **Shared global state:** `DB`, `socketsByUser`, VAPID keys on `DB.settings`.
- **Cross-module DB:** every attach function receives `DB` + `saveData`.
- **Frontend:** `fetch` is wrapped by `api()` / `apiCatch()` in `app.js`. Do not scatter a second client.

## Adding a payment provider

Change `pay-server.js` provider functions + `.env` + tests. Do not touch inbox or GPS routes.
