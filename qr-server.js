"use strict";

/**
 * Opaque QR tokens. Payloads never include email/phone/passwords.
 * Scanning never auto-executes — resolve returns a confirmation card.
 */

const invites = require("./modules/families/invites");
const graph = require("./modules/social/graph");

const TYPES = ["profile", "friend", "family", "payment", "app"];
const TTL = {
  profile: 90 * 24 * 60 * 60 * 1000,
  friend: 14 * 24 * 60 * 60 * 1000,
  family: 14 * 24 * 60 * 60 * 1000,
  payment: 2 * 24 * 60 * 60 * 1000,
  app: 30 * 24 * 60 * 60 * 1000
};

function ensure(DB) {
  DB.qrTokens = Array.isArray(DB.qrTokens) ? DB.qrTokens : [];
}

function publicToken(row, origin) {
  return {
    id: row.id,
    type: row.type,
    url: origin + "/qr/" + row.id,
    qrUrl: origin + "/qr/" + row.id,
    expiresAt: row.expiresAt,
    maxUses: row.maxUses || 0
  };
}

function attach(ctx) {
  const {
    app, DB, saveData, auth, optionalAuth, makeId, now, getUser, publicUser,
    sharesFamily, userPrefs, findInviteFamily, invitePreviewPayload
  } = ctx;
  ensure(DB);

  function originOf(req) {
    return req.protocol + "://" + req.get("host");
  }

  function lookup(raw) {
    ensure(DB);
    const s = String(raw || "").trim();
    if (!s) return null;
    let id = s;
    try {
      if (/^https?:\/\//i.test(s) || /\/qr\//.test(s)) {
        const u = /^https?:\/\//i.test(s) ? new URL(s) : new URL(s, "http://local.invalid");
        const q = u.searchParams.get("qr") || u.searchParams.get("token");
        if (q) id = q;
        else {
          const m = String(u.pathname || "").match(/\/qr\/([^/?#]+)/);
          if (m) id = decodeURIComponent(m[1]);
        }
      }
    } catch (e) {}
    return DB.qrTokens.find((x) => x.id === id) || null;
  }

  app.post("/api/qr/generate", auth, (req, res) => {
    ensure(DB);
    const b = req.body || {};
    let type = String(b.type || "profile").toLowerCase();
    if (!TYPES.includes(type)) return res.status(400).json({ error: "unknown QR type" });
    const ttl = TTL[type] || TTL.profile;
    const row = {
      id: makeId("qr"),
      type,
      creatorId: req.userId,
      targetUserId: req.userId,
      familyId: null,
      amount: null,
      inviteToken: null,
      createdAt: now(),
      expiresAt: now() + ttl,
      uses: 0,
      maxUses: Number(b.maxUses || 0) || 0,
      revokedAt: null
    };
    if (type === "family") {
      const fid = String(b.familyId || "");
      const f = (DB.families || []).find((x) => x.id === fid);
      if (!f || !(f.members || []).includes(req.userId)) {
        return res.status(403).json({ error: "not a member of that family" });
      }
      row.familyId = f.id;
      row.inviteToken = b.inviteToken ? String(b.inviteToken) : (f.invites && f.invites[0]) || "";
    }
    if (type === "payment") {
      const amt = Number(b.amount);
      if (Number.isFinite(amt) && amt > 0) row.amount = Math.round(amt * 100) / 100;
      if (b.toUserId) {
        if (!getUser(b.toUserId)) return res.status(404).json({ error: "user not found" });
        row.targetUserId = String(b.toUserId);
      }
    }
    if (type === "friend" && b.toUserId) {
      row.targetUserId = String(b.toUserId);
    }
    DB.qrTokens.push(row);
    if (DB.qrTokens.length > 8000) DB.qrTokens = DB.qrTokens.slice(-6000);
    saveData();
    res.json({ ok: true, qr: publicToken(row, originOf(req)), token: row.id });
  });

  function resolveBody(raw, viewerId) {
    const fam = typeof findInviteFamily === "function" ? findInviteFamily(raw) : null;
    if (fam && fam.f) {
      const preview = typeof invitePreviewPayload === "function"
        ? invitePreviewPayload(fam.f, viewerId, fam.stored, fam.decoded)
        : { family: { id: fam.f.id, name: fam.f.name } };
      return {
        ok: true,
        kind: "FAMILY_INVITE",
        confirmRequired: true,
        title: "Family invitation",
        subtitle: (preview.family && preview.family.name) || fam.f.name,
        family: preview.family,
        briefing: preview.briefing,
        token: fam.stored,
        alreadyMember: preview.alreadyMember
      };
    }
    const row = lookup(raw);
    if (!row) return { error: "This QR code is not recognized.", kind: "UNKNOWN" };
    if (row.revokedAt) return { error: "This QR code is no longer valid.", kind: "REVOKED" };
    if (row.expiresAt && row.expiresAt < now()) return { error: "This QR code has expired.", kind: "EXPIRED" };
    if (row.maxUses && row.uses >= row.maxUses) return { error: "This QR code has already been used.", kind: "REVOKED" };
    const target = getUser(row.targetUserId || row.creatorId);
    const rel = viewerId && target
      ? graph.relationshipOf(DB, viewerId, target.id, { sharesFamily })
      : null;
    const userCard = target ? publicUser(target, viewerId, { forSearch: true }) : null;
    if (userCard && rel) userCard.relationship = rel;
    row.uses = (row.uses || 0) + 1;
    saveData();
    if (row.type === "payment") {
      return {
        ok: true,
        kind: "PAYMENT_REQUEST",
        confirmRequired: true,
        title: "Send money?",
        subtitle: userCard ? userCard.name : "Member",
        amount: row.amount || null,
        user: userCard,
        relationship: rel,
        toUserId: row.targetUserId
      };
    }
    if (row.type === "family") {
      return {
        ok: true,
        kind: "FAMILY_INVITE",
        confirmRequired: true,
        title: "Family invitation",
        familyId: row.familyId,
        token: row.inviteToken,
        user: userCard
      };
    }
    if (row.type === "app") {
      return {
        ok: true,
        kind: "APP_INVITE",
        confirmRequired: true,
        title: "Join GPS FAMILIA",
        user: userCard,
        relationship: rel
      };
    }
    return {
      ok: true,
      kind: row.type === "friend" ? "FRIEND_INVITE" : "USER_PROFILE",
      confirmRequired: true,
      title: userCard ? ("Connect with " + userCard.name + "?") : "User profile",
      user: userCard,
      relationship: rel
    };
  }

  function handleResolve(req, res) {
    const raw = String((req.body && (req.body.token || req.body.raw)) || req.query.token || "").trim();
    if (!raw) return res.status(400).json({ error: "token required" });
    const out = resolveBody(raw, req.userId || null);
    if (out.error) return res.status(400).json({ error: out.error, kind: out.kind || "INVALID" });
    res.json(out);
  }

  app.post("/api/qr/resolve", auth, handleResolve);
  app.get("/api/qr/resolve", auth, handleResolve);

  app.post("/api/qr/:id/revoke", auth, (req, res) => {
    ensure(DB);
    const row = DB.qrTokens.find((x) => x.id === req.params.id);
    if (!row) return res.status(404).json({ error: "not found" });
    if (row.creatorId !== req.userId) return res.status(403).json({ error: "forbidden" });
    row.revokedAt = now();
    saveData();
    res.json({ ok: true });
  });

  app.get("/qr/:token", (req, res) => {
    const token = String(req.params.token || "").trim();
    if (!token) return res.redirect(302, "/");
    res.redirect(302, "/?qr=" + encodeURIComponent(token));
  });

  return { lookup, resolveBody };
}

module.exports = { attach, TYPES };
