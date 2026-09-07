# Data store

There is **no SQL database**. `f360_data.json` (or `DATA_FILE`) is the source of truth.

## Collections

`users`, `families`, `messages`, `places`, `joinRequests`, `otps`, `sessions`, `settings`,
`posts`, `rooms`, `friends`, `blocks`, `reports`, `listings`, `offers`, `wallets`, `calls`.

Passwords are `scrypt$salt$hash`. Family passwords hashed the same way. Sessions are
random 24-byte hex tokens with `exp`. VAPID keys live on `settings` after first boot.

## Access pattern

```
route → service in server.js or *-server.js → DB.<collection> → saveData()
```

`saveData()` writes a temp file then renames. All attach modules receive `DB` + `saveData`.
Do not add raw filesystem writes for business records.

## Safety

- Never delete `f360_data.json` in production without a backup.
- Docker: persist `/data/f360_data.json` and `/app/uploads`.
- Indexes: N/A (in-process arrays). Cap messages (~15k–20k) and location history (2000).

## Future SQL

If you migrate, keep the same REST shapes. Put repositories under `modules/<domain>/infrastructure/`.
