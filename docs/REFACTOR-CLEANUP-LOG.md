# Cleanup log (v2.15.1)

## Removed (verified unused copies, not user media)

- `uploads/app.js`
- `uploads/server.js`
- `uploads/package.json`
- `uploads/package-lock.json`
- `uploads/index.html`
- `uploads/styles.css`
- `uploads/splash_godfather.png`
- `uploads/f360_data.json` (must not live under the public uploads dir)

Searched repo: these were accidental snapshots, not referenced by routes or docs.

## Extracted (callers migrated, originals deleted from server.js)

- Invite token encode/decode/match → `modules/families/invites.js`
- `.env` loader + PORT/HOST/DEMO/rates → `config/index.js`
- Password hashing → `lib/crypto.js`
- Email/password/coord checks + masking → `lib/validate.js`
- SMTP/Twilio → `lib/notify.js`
- Google ID-token verify → `lib/google.js`

## Not deleted

- `app.js`, `server.js`, `rooms-server.js` — composition roots / working domains.
- `brand-godfather.png` / splash assets — still used or reserved; do not delete without UI proof.

## Duplicate implementations

No `*New.js` / `*Legacy.js` pairs existed. Payment demo vs Stripe is a provider branch inside `pay-server.js`, not a duplicate file.
