# v2.15.0 architectural modernization — report

## 1. Executive summary

GPS FAMILIA was already a modular monolith (`*-server.js` attach modules, `ui-*.js` panels).
This pass **did not rewrite working product code**. It established explicit config, module
facades, invite-token extraction, static denylist, readiness, architecture tests, and docs.
All previous `/api` routes and the PWA UI remain.

## 2. Before

- Env and VERSION copied at the top of `server.js`
- Invite matching lived only inside `server.js`
- `express.static` could serve `server.js` / `*-server.js`
- Accidental source snapshots in `uploads/`
- Architecture notes split across root `.txt` files; README still said 2.11.0

## 3. After

- `config/` is the single VERSION + env reader
- `modules/families` owns invite tokens
- `modules/<domain>/index.js` re-exports attach modules (public door)
- `lib/errors.js` standardizes unexpected failures
- `docs/` describes the **actual** tree

## 4. Directory tree (important)

```
config/index.js
lib/{log,gzip,errors}.js
modules/{families,community,social,market,pay,rooms,calls,push}/index.js
modules/families/invites.js
scripts/{arch-check,syntax-check}.js
docs/*.md
server.js                 composition root
*-server.js / push.js     domain attach
app.js + ui-*.js          browser
tests/suites/11-architecture.js
```

## 5. Modules

See `docs/ARCHITECTURE.md`. Each attach module owns its HTTP routes.

## 6. API refactor

**No path changes.** Added `GET /api/ready`. Backend JS returns 404.

## 7. Database

Unchanged JSON file store. Documented in `docs/DATABASE.md`.

## 8. Duplicate code removed

Invite encode/decode no longer duplicated as a second client-side mint (that was 2.14).
This pass extracted the server implementation to a module.

## 9. Dead code removed

`uploads/` source copies listed in `REFACTOR-CLEANUP-LOG.md`.

## 10. Security

- Static denylist for composition-root and module sources
- Unhandled errors do not leak stacks
- Existing Helmet-equivalent headers, CORS allow-list, Bearer-only REST unchanged

## 11. Performance

Not claimed. Suite still ~3s. No bundler added.

## 12. Testing

New suite `architecture`. Full `npm test` + `npm run arch` + `npm run lint` required before ship.

## 13–15. Files

Created: `config/`, `lib/errors.js`, `modules/**`, `scripts/**`, `docs/**`, `tests/suites/11-architecture.js`.
Moved: invite helpers out of `server.js`.
Deleted: junk under `uploads/` (not user photos).

## 16. API routes

See `docs/API.md`.

## 17. Dependencies

No new runtime npm packages.

## 18. Known issues

- `app.js` remains a large UI composition root (by design).
- `server.js` still hosts inbox/GPS/auth (inbox not rebuilt).
- JSON file is not SQL; no distributed tracing.
- Preview iframes: `X-Frame-Options: DENY` is required by security tests (PWA is same-origin).

## 19. Extension points

New provider: implement inside the owning `*-server.js` (pay, push, calls).
New HTTP resource: `attach()` module + test.
New UI panel: `ui-*.js`.

## 20. Startup

Windows: `Start.bat`  
Linux/macOS: `python3 start.py` or `npm install && npm run dev`  
Docker: `docker compose up --build`  
Production: `NODE_ENV=production HOST=0.0.0.0 node server.js`
