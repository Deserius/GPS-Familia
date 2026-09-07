"use strict";

/**
 * Safe JSON error responses. Never attach stack traces or secrets.
 * Routes may still call res.status(n).json({ error }) — this helper
 * adds requestId when the logger middleware ran.
 */

function fail(res, status, error, extra) {
  const body = Object.assign({ error: String(error || "request failed") }, extra && typeof extra === "object" ? extra : {});
  if (res.req && res.req.id) body.requestId = res.req.id;
  return res.status(status).json(body);
}

function unauthorized(res, msg) { return fail(res, 401, msg || "unauthorized"); }
function forbidden(res, msg) { return fail(res, 403, msg || "forbidden"); }
function notFound(res, msg) { return fail(res, 404, msg || "not found"); }
function badRequest(res, msg) { return fail(res, 400, msg || "bad request"); }

function unhandled(err, req, res, next) {
  const { error: logError } = require("./log");
  logError("unhandled", { id: req && req.id, error: String(err && err.message || err) });
  if (res.headersSent) return next(err);
  return fail(res, 500, "internal error");
}

module.exports = { fail, unauthorized, forbidden, notFound, badRequest, unhandled };
