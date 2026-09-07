"use strict";

/**
 * GPS-FAMILIA test harness
 * Shared HTTP + WebSocket client, assertions, and result logging.
 * Suites must not attempt exploits — they only verify defensive behavior
 * (401/403/404, secret stripping, family isolation).
 */

const fs = require("fs");
const path = require("path");
const { WebSocket } = require("ws");

function nowIso() {
  return new Date().toISOString();
}

function uid(prefix) {
  return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

class Harness {
  constructor(opts) {
    this.base = String(opts.base || "http://127.0.0.1:3000").replace(/\/$/, "");
    this.wsBase = this.base.replace(/^http/, "ws");
    this.results = [];
    this.suite = "boot";
    this.startedAt = Date.now();
    this.meta = { base: this.base, startedAt: nowIso() };
  }

  section(name) {
    this.suite = name;
  }

  record(status, name, detail) {
    const row = {
      suite: this.suite,
      status, // pass | fail | warn | skip
      name,
      detail: detail == null ? "" : String(detail),
      ts: nowIso()
    };
    this.results.push(row);
    const mark = status === "pass" ? "PASS" : status === "fail" ? "FAIL" : status === "warn" ? "WARN" : "SKIP";
    const line = `  [${mark}] ${name}${row.detail ? " — " + row.detail : ""}`;
    if (status === "fail") console.error(line);
    else console.log(line);
    return status === "pass";
  }

  pass(name, detail) { return this.record("pass", name, detail); }
  fail(name, detail) { return this.record("fail", name, detail); }
  warn(name, detail) { return this.record("warn", name, detail); }
  skip(name, detail) { return this.record("skip", name, detail); }

  check(name, cond, detail) {
    if (cond) return this.pass(name, detail);
    return this.fail(name, detail || "assertion failed");
  }

  async http(method, p, opts) {
    opts = opts || {};
    const headers = Object.assign({}, opts.headers || {});
    if (opts.token) headers.authorization = "Bearer " + opts.token;
    let body = opts.body;
    if (body != null && !Buffer.isBuffer(body) && typeof body !== "string") {
      if (!headers["content-type"]) headers["content-type"] = "application/json";
      body = JSON.stringify(body);
    }
    const url = p.startsWith("http") ? p : this.base + p;
    const t0 = Date.now();
    let res, text;
    try {
      res = await fetch(url, { method, headers, body, redirect: opts.redirect || "manual" });
      text = await res.text();
    } catch (e) {
      return {
        ok: false, status: 0, headers: {}, json: null, text: String(e && e.message),
        ms: Date.now() - t0, error: e
      };
    }
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
    const hdrs = {};
    res.headers.forEach((v, k) => { hdrs[k.toLowerCase()] = v; });
    return {
      ok: res.ok,
      status: res.status,
      headers: hdrs,
      json,
      text,
      ms: Date.now() - t0
    };
  }

  get(p, opts) { return this.http("GET", p, opts); }
  post(p, body, opts) { return this.http("POST", p, Object.assign({}, opts, { body })); }
  put(p, body, opts) { return this.http("PUT", p, Object.assign({}, opts, { body })); }
  patch(p, body, opts) { return this.http("PATCH", p, Object.assign({}, opts, { body })); }
  del(p, body, opts) { return this.http("DELETE", p, Object.assign({}, opts, { body })); }

  async expectStatus(res, codes, name) {
    const want = Array.isArray(codes) ? codes : [codes];
    const ok = want.includes(res.status);
    this.check(name, ok, `status ${res.status} (want ${want.join("|")})${res.json && res.json.error ? " · " + res.json.error : ""}`);
    return ok;
  }

  hasNoSecret(obj, name) {
    const blob = JSON.stringify(obj || {});
    const hits = [];
    if (/"password"\s*:\s*"scrypt\$/i.test(blob)) hits.push("scrypt hash");
    if (/"password"\s*:\s*"[^"]{6,}"/.test(blob) && /scrypt\$/.test(blob)) hits.push("password field");
    if (/\bvapidPrivate\b/.test(blob)) hits.push("vapidPrivate");
    if (/\bLIVEKIT_API_SECRET\b/.test(blob)) hits.push("LIVEKIT_API_SECRET");
    if (hits.length) {
      this.fail(name, "leaked: " + hits.join(", "));
      return false;
    }
    this.pass(name, "no password hashes / private keys in JSON");
    return true;
  }

  async login(identifier, password) {
    const r = await this.post("/api/login", { identifier, password: password || "demo123" });
    if (!r.json || !r.json.sessionToken) {
      this.fail("login " + identifier, r.status + " " + ((r.json && r.json.error) || r.text.slice(0, 80)));
      return null;
    }
    return { token: r.json.sessionToken, user: r.json.user, raw: r };
  }

  async register(overrides) {
    const stamp = uid("qa");
    const body = Object.assign({
      name: "QA " + stamp.slice(-8),
      email: stamp + "@familia.test",
      phone: "555" + String(Math.floor(1000000 + Math.random() * 8999999)),
      password: "QaPass9!"
    }, overrides || {});
    const r = await this.post("/api/register", body);
    if (!r.json || !r.json.sessionToken) {
      this.fail("register", r.status + " " + ((r.json && r.json.error) || r.text.slice(0, 120)));
      return null;
    }
    return { token: r.json.sessionToken, user: r.json.user, creds: body, raw: r };
  }

  openWs(token, opts) {
    opts = opts || {};
    const url = this.wsBase + "/ws" + (token ? ("?token=" + encodeURIComponent(token)) : "");
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const bag = {
        ws,
        msgs: [],
        waiters: [],
        closeCode: null,
        closeReason: "",
        opened: false,
        send(obj) {
          ws.send(JSON.stringify(obj));
        },
        close() {
          try { ws.close(); } catch (e) {}
        },
        wait(pred, ms) {
          const hit = bag.msgs.find(pred);
          if (hit) return Promise.resolve(hit);
          return new Promise((res, rej) => {
            const t = setTimeout(() => rej(new Error("timeout waiting for websocket event")), ms || 4000);
            bag.waiters.push({
              match: pred,
              resolve(j) { clearTimeout(t); res(j); }
            });
          });
        },
        waitClose(ms) {
          if (bag.closeCode != null) return Promise.resolve(bag.closeCode);
          return new Promise((res, rej) => {
            const t = setTimeout(() => rej(new Error("websocket did not close")), ms || 2500);
            ws.once("close", (code) => { clearTimeout(t); res(code); });
          });
        }
      };
      const timer = setTimeout(() => {
        if (!bag.opened && bag.closeCode == null) {
          try { ws.terminate(); } catch (e) {}
          reject(new Error("websocket connect timeout"));
        }
      }, opts.connectTimeout || 4000);
      ws.on("open", () => {
        bag.opened = true;
        clearTimeout(timer);
        resolve(bag);
      });
      ws.on("message", (d) => {
        let j;
        try { j = JSON.parse(String(d)); } catch (e) { return; }
        bag.msgs.push(j);
        bag.waiters = bag.waiters.filter((w) => {
          try {
            if (w.match(j)) { w.resolve(j); return false; }
          } catch (e) {}
          return true;
        });
      });
      ws.on("close", (code, reason) => {
        bag.closeCode = code;
        bag.closeReason = String(reason || "");
        clearTimeout(timer);
        if (!bag.opened) resolve(bag);
      });
      ws.on("error", () => {});
    });
  }

  summary() {
    const counts = { pass: 0, fail: 0, warn: 0, skip: 0 };
    this.results.forEach((r) => { counts[r.status] = (counts[r.status] || 0) + 1; });
    counts.total = this.results.length;
    counts.ms = Date.now() - this.startedAt;
    return counts;
  }

  writeReports(dir) {
    fs.mkdirSync(dir, { recursive: true });
    const counts = this.summary();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const payload = {
      generatedAt: nowIso(),
      base: this.base,
      counts,
      results: this.results
    };
    const jsonPath = path.join(dir, "latest.json");
    const mdPath = path.join(dir, "latest.md");
    const histJson = path.join(dir, "run-" + stamp + ".json");
    const histMd = path.join(dir, "run-" + stamp + ".md");
    fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2));
    fs.writeFileSync(histJson, JSON.stringify(payload, null, 2));
    const md = this.toMarkdown(payload);
    fs.writeFileSync(mdPath, md);
    fs.writeFileSync(histMd, md);
    return { jsonPath, mdPath, counts };
  }

  toMarkdown(payload) {
    const c = payload.counts;
    const lines = [];
    lines.push("# GPS FAMILIA — test report");
    lines.push("");
    lines.push("Generated: **" + payload.generatedAt + "**");
    lines.push("Target: `" + payload.base + "`");
    lines.push("");
    lines.push("| Pass | Fail | Warn | Skip | Total | Duration |");
    lines.push("| ---: | ---: | ---: | ---: | ---: | ---: |");
    lines.push(`| ${c.pass} | ${c.fail} | ${c.warn} | ${c.skip} | ${c.total} | ${c.ms} ms |`);
    lines.push("");
    if (c.fail === 0) lines.push("**Result: GREEN** — no failing assertions.");
    else lines.push("**Result: RED** — " + c.fail + " failing assertion(s). See FAIL rows below.");
    lines.push("");
    let suite = "";
    payload.results.forEach((r) => {
      if (r.suite !== suite) {
        suite = r.suite;
        lines.push("");
        lines.push("## " + suite);
        lines.push("");
        lines.push("| Status | Check | Detail |");
        lines.push("| --- | --- | --- |");
      }
      const det = String(r.detail || "").replace(/\|/g, "\\|").replace(/\n/g, " ");
      lines.push(`| ${r.status.toUpperCase()} | ${r.name.replace(/\|/g, "\\|")} | ${det} |`);
    });
    lines.push("");
    lines.push("_These tests verify operability and defensive security (authn/authz, secret hygiene, family isolation, realtime). They do not include exploit payloads._");
    lines.push("");
    return lines.join("\n");
  }
}

async function waitForHealth(base, ms) {
  const deadline = Date.now() + (ms || 15000);
  let last = "";
  while (Date.now() < deadline) {
    try {
      const r = await fetch(base.replace(/\/$/, "") + "/api/health");
      const j = await r.json();
      if (r.ok && j && j.ok) return j;
      last = JSON.stringify(j);
    } catch (e) {
      last = e.message;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("server not healthy at " + base + " (" + last + ")");
}

module.exports = { Harness, waitForHealth, uid, nowIso };
