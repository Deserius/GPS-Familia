#!/usr/bin/env node
"use strict";
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const SKIP = new Set(["node_modules", ".git", "uploads", "avatars", "tests", ".cache", ".arena", ".npm"]);
const files = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name) || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.isFile() && e.name.endsWith(".js") && !e.name.startsWith("ui-") && e.name !== "app.js" && e.name !== "i18n.js" && e.name !== "sw.js") {
      files.push(p);
    }
  }
}
walk(ROOT);
let fail = 0;
files.forEach((f) => {
  const r = spawnSync(process.execPath, ["--check", f], { encoding: "utf8" });
  if (r.status !== 0) {
    fail += 1;
    console.error(path.relative(ROOT, f), r.stderr || r.stdout);
  }
});
if (fail) {
  console.error("SYNTAX FAIL", fail);
  process.exit(1);
}
console.log("SYNTAX PASS — " + files.length + " CommonJS files");
