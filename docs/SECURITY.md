# Security (architecture)

Operator policy and headers: root **SECURITY.md**.

This pass:

- REST remains Bearer-only (`security.js` + `auth()`).
- CORS allow-list (not `origin: true`).
- Rate limits on `/api`, login, register, OTP.
- `f360_data.json`, `.env`, `node_modules`, backend sources (`server.js`, `*-server.js`, `config/`, `modules/`, `lib/`) are not statically downloadable.
- Passwords: scrypt. No PAN/raw bank numbers (pay-server rejects them).
- Errors: no stacks in JSON (`lib/errors.js`).
- SAST: `npm run test:sast`.

Report vulnerabilities privately; do not file exploit PoCs in-tree.
