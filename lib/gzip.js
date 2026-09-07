"use strict";

const zlib = require("zlib");

/** Gzip JSON API bodies over 800 bytes. Skip static routes. Level 3 is faster than 6 for small JSON. */
function gzipJson(req, res, next) {
  const p = req.path || req.url || "";
  if (!String(p).startsWith("/api")) return next();
  const ae = String(req.headers["accept-encoding"] || "");
  if (!ae.includes("gzip")) return next();
  const orig = res.json.bind(res);
  res.json = (obj) => {
    try {
      const raw = Buffer.from(JSON.stringify(obj));
      if (raw.length < 800) return orig(obj);
      const gz = zlib.gzipSync(raw, { level: 3 });
      if (gz.length >= raw.length) return orig(obj);
      res.setHeader("Content-Encoding", "gzip");
      res.setHeader("Vary", "Accept-Encoding");
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Length", String(gz.length));
      return res.end(gz);
    } catch (e) {
      return orig(obj);
    }
  };
  next();
}

module.exports = { gzipJson };
