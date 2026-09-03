#!/usr/bin/env python3
"""GPS-FAMILIA launcher — install deps, start the server, open the browser."""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import time
import webbrowser
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent
os.chdir(ROOT)


def which(cmd: str):
    found = shutil.which(cmd)
    if found:
        return found
    if os.name == "nt":
        return shutil.which(cmd + ".cmd") or shutil.which(cmd + ".exe")
    return None


def run(cmd, **kw):
    printable = cmd if isinstance(cmd, str) else " ".join(cmd)
    print(">", printable, flush=True)
    return subprocess.run(cmd, **kw)


def read_port() -> str:
    port = os.environ.get("PORT", "3000")
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip()
            if line.startswith("PORT=") and not line.startswith("#"):
                port = line.split("=", 1)[1].strip().strip('"').strip("'") or port
    return port


def main() -> int:
    print("=" * 56)
    print("  GPS-FAMILIA  —  setup, configure, launch")
    print("=" * 56)

    node = which("node")
    if not node:
        print("\nERROR: Node.js 18+ is required.")
        print("Install it from https://nodejs.org and run this again.")
        return 1

    ver = subprocess.check_output([node, "-v"], text=True).strip()
    print(f"Node {ver}")

    npm = which("npm")
    if not npm:
        print("ERROR: npm was not found next to Node.js.")
        return 1

    env_ex = ROOT / ".env.example"
    env = ROOT / ".env"
    if env_ex.exists() and not env.exists():
        shutil.copy(env_ex, env)
        print("Created .env from .env.example (edit it to add SMTP/Twilio).")

    data = ROOT / "f360_data.json"
    if not data.exists():
        data.write_text(
            '{\n  "users": [],\n  "families": [],\n  "messages": [],\n  "places": [],\n  "joinRequests": [],\n  "otps": {},\n  "sessions": {}\n}\n',
            encoding="utf-8",
        )
        print("Initialized f360_data.json")

    express = ROOT / "node_modules" / "express"
    ws = ROOT / "node_modules" / "ws"
    if not express.exists() or not ws.exists():
        print("Installing npm dependencies…")
        r = run([npm, "install"], cwd=str(ROOT))
        if r.returncode != 0:
            print("npm install failed.")
            return r.returncode
    else:
        print("Dependencies already installed.")

    port = read_port()
    url = f"http://127.0.0.1:{port}/"
    health = f"http://127.0.0.1:{port}/api/health"
    env_vars = os.environ.copy()
    env_vars.setdefault("HOST", "0.0.0.0")
    env_vars.setdefault("PORT", port)

    print(f"Starting server on {url}")
    proc = subprocess.Popen([node, "server.js"], cwd=str(ROOT), env=env_vars)

    ok = False
    for _ in range(60):
        if proc.poll() is not None:
            print("Server process exited before it became ready.")
            return proc.returncode or 1
        try:
            with urlopen(health, timeout=1) as resp:
                if resp.status == 200:
                    ok = True
                    break
        except (URLError, TimeoutError, OSError):
            time.sleep(0.25)

    if not ok:
        print("Server did not become ready in time. Check the log above.")
        proc.terminate()
        return 1

    print(f"Ready. Opening {url}")
    try:
        webbrowser.open(url)
    except Exception as e:
        print("Could not open a browser automatically:", e)
        print("Open this URL yourself:", url)

    print("Press Ctrl+C to stop the server.")
    try:
        return proc.wait()
    except KeyboardInterrupt:
        print("\nShutting down…")
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()
        return 0


if __name__ == "__main__":
    sys.exit(main())
