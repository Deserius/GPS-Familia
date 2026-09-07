"use strict";

/**
 * Family invite tokens — public surface of the families module.
 * Tokens are base64url JSON { fid, ts, from }. Matching is tolerant of
 * query `+`→space, URI encoding, and pasted https://host/invite/TOKEN URLs.
 */

function extractInviteRaw(raw) {
  let s = String(raw || "").trim().replace(/^["']|["']$/g, "");
  if (!s) return "";
  try {
    if (/^https?:\/\//i.test(s) || /(?:^|[/?#])invite=/.test(s) || /\/(?:invite|join)\//.test(s)) {
      const u = /^https?:\/\//i.test(s) ? new URL(s) : new URL(s, "http://local.invalid");
      const q = u.searchParams.get("invite") || u.searchParams.get("token");
      if (q) s = q;
      else {
        const m = String(u.pathname || "").match(/\/(?:invite|join)\/([^/?#]+)/);
        if (m) s = decodeURIComponent(m[1]);
        else return "";
      }
    }
  } catch (e) {}
  if (/%[0-9A-Fa-f]{2}/.test(s)) {
    try { s = decodeURIComponent(s); } catch (e) {}
  }
  return s.replace(/\s+/g, "+").trim();
}

function inviteBuffer(raw) {
  let s = extractInviteRaw(raw);
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4;
  if (pad) s += "=".repeat(4 - pad);
  return s;
}

function decodeInviteToken(raw) {
  try {
    const decoded = JSON.parse(Buffer.from(inviteBuffer(raw), "base64").toString("utf8"));
    if (!decoded || !decoded.fid) return null;
    return decoded;
  } catch (e) {
    return null;
  }
}

function mintInviteToken(fid, fromId, ts) {
  const json = JSON.stringify({ fid, ts: ts || Date.now(), from: fromId || null });
  return Buffer.from(json).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function invitePayloadKey(decoded) {
  if (!decoded) return "";
  return String(decoded.fid) + "|" + String(decoded.ts || "") + "|" + String(decoded.from || "");
}

function findInviteFamily(raw, families) {
  const decoded = decodeInviteToken(raw);
  if (!decoded) return null;
  const f = (families || []).find((x) => x.id === decoded.fid);
  if (!f || !Array.isArray(f.invites) || !f.invites.length) return null;
  const incoming = inviteBuffer(raw);
  const want = invitePayloadKey(decoded);
  for (const stored of f.invites) {
    if (!stored) continue;
    if (stored === raw || stored === extractInviteRaw(raw) || inviteBuffer(stored) === incoming) {
      return { f, stored, decoded };
    }
    const d2 = decodeInviteToken(stored);
    if (d2 && invitePayloadKey(d2) === want) return { f, stored, decoded };
  }
  return null;
}

module.exports = {
  extractInviteRaw,
  inviteBuffer,
  decodeInviteToken,
  mintInviteToken,
  invitePayloadKey,
  findInviteFamily
};
