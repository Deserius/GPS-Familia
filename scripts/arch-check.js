#!/usr/bin/env node
"use strict";

/**
 * Architectural checks for the modular monolith.
 * No extra packages. Walks project .js files, maps require(), reports cycles
 * and forbidden deep imports into module internals by sibling domains.
 */

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
    else if (e.isFile() && e.name.endsWith(".js")) files.push(p);
  }
}
walk(ROOT);

function rel(p) { return path.relative(ROOT, p).replace(/\\/g, "/"); }

const graph = new Map();
const reqRe = /require\s*\(\s*["'](\.[^"']+)["']\s*\)/g;

files.forEach((file) => {
  const src = fs.readFileSync(file, "utf8");
  const from = rel(file);
  const deps = [];
  let m;
  reqRe.lastIndex = 0;
  while ((m = reqRe.exec(src))) {
    let target = path.normalize(path.join(path.dirname(file), m[1]));
    if (!target.endsWith(".js")) {
      if (fs.existsSync(target + ".js")) target += ".js";
      else if (fs.existsSync(path.join(target, "index.js"))) target = path.join(target, "index.js");
    }
    if (fs.existsSync(target)) deps.push(rel(target));
  }
  graph.set(from, deps);
});

const findings = [];

function cycles() {
  const visiting = new Set();
  const seen = new Set();
  function dfs(node, stack) {
    if (visiting.has(node)) {
      const i = stack.indexOf(node);
      findings.push("cycle: " + stack.slice(i).concat(node).join(" → "));
      return;
    }
    if (seen.has(node)) return;
    visiting.add(node);
    stack.push(node);
    (graph.get(node) || []).forEach((d) => dfs(d, stack));
    stack.pop();
    visiting.delete(node);
    seen.add(node);
  }
  graph.forEach((_, k) => dfs(k, []));
}
cycles();

graph.forEach((deps, from) => {
  if (!from.startsWith("modules/")) return;
  const domain = from.split("/")[1];
  deps.forEach((d) => {
    if (!d.startsWith("modules/")) return;
    const other = d.split("/")[1];
    if (other !== domain && /\/(?!index\.js$).+/.test(d.replace(/^modules\/[^/]+\//, "")) && !d.endsWith("/index.js")) {
      findings.push("deep import across domains: " + from + " → " + d);
    }
  });
});

if (!fs.existsSync(path.join(ROOT, "modules/families/invites.js"))) {
  findings.push("modules/families/invites.js missing");
}
if (!fs.existsSync(path.join(ROOT, "config/index.js"))) {
  findings.push("config/index.js missing");
}

if (findings.length) {
  console.error("ARCH FAIL (" + findings.length + ")");
  findings.forEach((f) => console.error("  - " + f));
  process.exit(1);
}
console.log("ARCH PASS — " + files.length + " js files, no require() cycles, module facades present");
process.exit(0);
