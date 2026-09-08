"use strict";

/**
 * GPS FAMILIA — SaaS security middleware
 * Helmet-equivalent headers, CORS allow-list, and in-process rate limits.
 * No extra npm packages (works on a wiped node_modules). Secrets stay in .env.
 */

const buckets = new Map();

function clientIp(req) {
  const xf = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return xf || req.ip || (req.socket && req.socket.remoteAddress) || "unknown";
}

function rateLimit(opts) {
  const windowMs = opts.windowMs || 60 * 1000;
  const max = opts.max || 60;
  const name = opts.name || "api";
  return function rateLimitMw(req, res, next) {
    if (req.method === "OPTIONS") return next();
    const now = Date.now();
    const key = name + ":" + clientIp(req);
    let b = buckets.get(key);
    if (!b || now - b.start >= windowMs) {
      b = { start: now, count: 0 };
      buckets.set(key, b);
    }
    b.count += 1;
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - b.count)));
    if (b.count > max) {
      res.setHeader("Retry-After", String(Math.ceil((windowMs - (now - b.start)) / 1000)));
      return res.status(429).json({ error: "too many requests" });
    }
    next();
  };
}

setInterval(() => {
  const now = Date.now();
  buckets.forEach((b, k) => { if (now - b.start > 5 * 60 * 1000) buckets.delete(k); });
}, 60 * 1000).unref();

function isHttps(req) {
  if (req.secure) return true;
  const proto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  return proto === "https";
}

function securityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-DNS-Prefetch-Control", "off");
  res.setHeader("Permissions-Policy", "geolocation=*, microphone=*, camera=*, display-capture=*, autoplay=*");
  res.setHeader("Feature-Policy", "geolocation *; microphone *; camera *; display-capture *; autoplay *");
  const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://unpkg.com https://accounts.google.com https://esm.sh https://js.stripe.com https://cdn.plaid.com",
      "style-src 'self' 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob: https:",
      "connect-src 'self' https: wss: ws:",
      "media-src 'self' blob:",
      "frame-src https://accounts.google.com https://js.stripe.com https://hooks.stripe.com https://cdn.plaid.com",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self' https: http:"
    ].join("; ");
  res.setHeader("Content-Security-Policy", csp);
  // Preview / local: do not send X-Frame-Options DENY (blocks the Arena iframe).
  if (process.env.NODE_ENV === "production" && String(process.env.DEMO_MODE || "true").toLowerCase() === "false") {
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
  }
  if (isHttps(req)) {
    res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  }
  next();
}

function corsOriginDelegate() {
  const extra = String(process.env.CORS_ORIGIN || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return function corsOrigin(origin, cb) {
    if (!origin) return cb(null, true);
    if (extra.includes("*")) return cb(null, true);
    if (extra.includes(origin)) return cb(null, true);
    try {
      const u = new URL(origin);
      if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return cb(null, true);
    } catch (e) {}
    if (String(process.env.DEMO_MODE || "true").toLowerCase() !== "false" &&
        process.env.NODE_ENV !== "production") {
      return cb(null, true);
    }
    cb(new Error("origin not allowed"));
  };
}

module.exports = { rateLimit, securityHeaders, corsOriginDelegate, clientIp };
