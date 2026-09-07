"use strict";

/** Structured JSON logs for operators. Never print secrets. */
function log(level, msg, extra) {
  const row = { ts: new Date().toISOString(), level, msg };
  if (extra && typeof extra === "object") {
    Object.keys(extra).forEach((k) => {
      const v = extra[k];
      if (v == null) return;
      if (/pass|secret|token|authorization|cookie/i.test(k)) return;
      row[k] = v;
    });
  }
  const line = JSON.stringify(row);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

function requestLogger(req, res, next) {
  const t0 = Date.now();
  const id = (req.headers["x-request-id"] || "").toString().slice(0, 32) || Math.random().toString(36).slice(2, 10);
  req.id = id;
  try { res.setHeader("X-Request-Id", id); } catch (e) {}
  res.on("finish", () => {
    const p = req.path || req.url || "";
    if (!String(p).startsWith("/api")) return;
    log("info", "http", {
      id,
      method: req.method,
      path: String(p).slice(0, 120),
      status: res.statusCode,
      ms: Date.now() - t0
    });
  });
  next();
}

module.exports = { log, requestLogger, info: (m, e) => log("info", m, e), warn: (m, e) => log("warn", m, e), error: (m, e) => log("error", m, e) };
