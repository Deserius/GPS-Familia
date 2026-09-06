#!/usr/bin/env node
"use strict";

/**
 * Static secret & pattern scan. No exploit payloads.
 * Fail if REST still accepts query tokens, CORS is origin:true,
 * or demo passwords leak from /api/config.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SKIP_DIR = new Set([
  "node_modules", ".git", "tests", "uploads", "avatars", ".cache", ".arena"
]);
const SKIP_FILE = new Set(["f360_data.json", "f360_data.json.tmp"]);

const findings = [];

function walk(dir) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const e of ents) {
    if (e.name.startsWith(".") && e.name !== ".env.example" && e.name !== ".github") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIR.has(e.name)) continue;
      walk(p);
    } else if (e.isFile()) {
      if (SKIP_FILE.has(e.name)) continue;
      if (!/\.(js|json|yml|yaml|html|md|txt|env\.example)$/i.test(e.name) && e.name !== ".env.example") continue;
      scanFile(p);
    }
  }
}

function rel(p) { return path.relative(ROOT, p).replace(/\\/g, "/"); }

function scanFile(file) {
  let src;
  try { src = fs.readFileSync(file, "utf8"); } catch (e) { return; }
  const r = rel(file);
  if (/BEGIN (RSA |OPENSSH )?PRIVATE KEY/.test(src)) findings.push(r + ": private key material");
  if (/\bAKIA[0-9A-Z]{16}\b/.test(src)) findings.push(r + ": AWS access key id");
  if (/vapidPrivate\s*[:=]\s*["'][^"']{20,}/.test(src)) findings.push(r + ": vapidPrivate literal");
  if (r === "server.js") {
    if (/demoPassword/.test(src)) findings.push("server.js: demoPassword must not be served");
    if (/cors\(\s*\{\s*origin\s*:\s*true/.test(src)) findings.push("server.js: CORS origin:true");
    if (/req\.query\s*&&\s*req\.query\.token/.test(src)) findings.push("server.js: REST still accepts ?token=");
  }
}

walk(ROOT);

if (!fs.existsSync(path.join(ROOT, "LICENSE"))) findings.push("LICENSE missing");
if (!fs.existsSync(path.join(ROOT, "security.js"))) findings.push("security.js missing");
if (!fs.existsSync(path.join(ROOT, "Dockerfile"))) findings.push("Dockerfile missing");

const idx = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
if (!/class="skip-link"/.test(idx)) findings.push("index.html: skip-link missing");
if (!/lang="en"/.test(idx)) findings.push("index.html: html lang missing");

if (findings.length) {
  console.error("SAST FAIL (" + findings.length + ")");
  findings.forEach((f) => console.error("  - " + f));
  process.exit(1);
}
console.log("SAST PASS — no leaked secrets, CORS allow-list, Bearer-only REST, LICENSE + skip-link present");
process.exit(0);
