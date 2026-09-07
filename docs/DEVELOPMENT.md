# Development

## Start

```bash
npm install
cp .env.example .env     # Windows: copy .env.example .env
npm run dev              # or: node server.js
```

Windows: `Start.bat`. macOS/Linux: `python3 start.py`.

Open `http://127.0.0.1:3000/`. Demo: `vito@familia.test` / `demo123`. OTP `000000` when `OTP_ECHO=true`.

## Commands

| Script | Purpose |
|---|---|
| `npm start` / `npm run dev` | Run the server |
| `npm test` | Full-stack suites |
| `npm run lint` | Syntax check CommonJS |
| `npm run arch` | Module boundary / cycle check |
| `npm run test:sast` | Secret / CORS / Bearer scan |

## Layout rule

New backend feature = new `attach()` module, one require in `server.js`, tests, Help tab if user-facing.
Do not grow `utils.js`. Domain code stays in its module.
