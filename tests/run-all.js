#!/usr/bin/env node
"use strict";

/**
 * GPS-FAMILIA full-stack test runner
 *
 *   npm test
 *   node tests/run-all.js
 *   node tests/run-all.js --base http://127.0.0.1:3000
 *   node tests/run-all.js --only security,realtime
 *
 * Writes tests/reports/latest.md and tests/reports/latest.json
 * Exit 0 if no FAIL rows (WARN is allowed).
 */

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { Harness, waitForHealth } = require("./lib/harness");

const ROOT = path.join(__dirname, "..");
const REPORTS = path.join(__dirname, "reports");

const SUITES = [
  require("./suites/01-health-pwa"),
  require("./suites/02-auth-account"),
  require("./suites/03-security"),
  require("./suites/04-families-location"),
  require("./suites/05-realtime-messaging"),
  require("./suites/06-feed-rooms-people"),
  require("./suites/07-calls"),
  require("./suites/08-saas-ops"),
  require("./suites/09-social"),
  require("./suites/10-market-pay"),
  require("./suites/11-architecture"),
  require("./suites/12-social-graph")
];

function parseArgs(argv) {
  const out = { base: process.env.BASE_URL || "http://127.0.0.1:3000", only: null, start: true };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--base" && argv[i + 1]) out.base = argv[++i];
    else if (a.startsWith("--base=")) out.base = a.slice(7);
    else if (a === "--only" && argv[i + 1]) out.only = argv[++i];
    else if (a.startsWith("--only=")) out.only = a.slice(7);
    else if (a === "--no-start") out.start = false;
  }
  return out;
}

async function ensureServer(base, start) {
  try {
    const j = await waitForHealth(base, 1500);
    console.log("Server already up: v" + j.version + " at " + base);
    return null;
  } catch (e) {
    if (!start) throw e;
  }
  console.log("Starting node server.js …");
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env
  });
  child.stdout.on("data", (d) => process.stdout.write("[server] " + d));
  child.stderr.on("data", (d) => process.stderr.write("[server] " + d));
  await waitForHealth(base, 20000);
  return child;
}

async function main() {
  const args = parseArgs(process.argv);
  const want = args.only
    ? args.only.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
    : null;
  const suites = SUITES.filter((s) => !want || want.includes(s.id) || want.includes(s.name.toLowerCase()));
  if (!suites.length) {
    console.error("No suites matched --only " + args.only);
    process.exit(2);
  }

  let child = null;
  try {
    child = await ensureServer(args.base, args.start);
  } catch (e) {
    console.error("Cannot reach " + args.base + ": " + e.message);
    process.exit(2);
  }

  const t = new Harness({ base: args.base });
  console.log("\nGPS FAMILIA tests → " + args.base);
  console.log("Suites: " + suites.map((s) => s.id).join(", ") + "\n");

  for (const s of suites) {
    console.log("▸ " + s.name);
    try {
      await s.run(t);
    } catch (e) {
      t.fail(s.id + " crashed", e && e.stack ? e.stack.split("\n").slice(0, 4).join(" | ") : String(e));
    }
  }

  const { mdPath, jsonPath, counts } = t.writeReports(REPORTS);
  console.log("\n── summary ─────────────────────────────");
  console.log("  pass " + counts.pass + "  fail " + counts.fail + "  warn " + counts.warn + "  skip " + counts.skip + "  (" + counts.ms + " ms)");
  console.log("  report  " + mdPath);
  console.log("  json    " + jsonPath);

  if (child) {
    child.kill("SIGTERM");
  }
  process.exit(counts.fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
