"use strict";

/**
 * Friends, blocks, reports, and DM/contact policy.
 * Personal details never leave publicUser / this module as hashes or full cards.
 */

const graph = require("./modules/social/graph");
const { createNotification } = require("./notify-server");

const REPORT_REASONS = [
  "spam", "harassment", "impersonation", "scam", "inappropriate",
  "underage", "stalking", "fake_listing", "other"
];

function ensure(DB) {
  DB.friends = Array.isArray(DB.friends) ? DB.friends : [];
  DB.blocks = Array.isArray(DB.blocks) ? DB.blocks : [];
  DB.reports = Array.isArray(DB.reports) ? DB.reports : [];
}

function blockedBetween(DB, a, b) {
  if (!a || !b || a === b) return false;
  return (DB.blocks || []).some((x) =>
    (x.blockerId === a && x.blockedId === b) || (x.blockerId === b && x.blockedId === a)
  );
}

function iBlocked(DB, me, them) {
  return (DB.blocks || []).some((x) => x.blockerId === me && x.blockedId === them);
}

function friendship(DB, a, b) {
  return (DB.friends || []).find((x) =>
    x && ((x.from === a && x.to === b) || (x.from === b && x.to === a))
  ) || null;
}

function areFriends(DB, a, b) {
  const f = friendship(DB, a, b);
  return !!(f && f.status === "accepted");
}

function canDm(DB, from, to, helpers) {
  if (!from || !to) return { ok: false, error: "user required" };
  if (from === to) return { ok: false, error: "cannot message yourself" };
  if (blockedBetween(DB, from, to)) return { ok: false, error: "you cannot message this person" };
  const getUser = helpers.getUser;
  const sharesFamily = helpers.sharesFamily;
  const userPrefs = helpers.userPrefs;
  const target = getUser(to);
  if (!target) return { ok: false, error: "user not found" };
  const prefs = userPrefs(target);
  const family = sharesFamily(from, to);
  const friends = areFriends(DB, from, to);
  const who = String(prefs.allowMessagesFrom || "anyone");
  if (who === "nobody") return { ok: false, error: "this person is not accepting messages" };
  if (who === "family" && !family) return { ok: false, error: "this person only accepts family messages" };
  if (who === "friends" && !family && !friends) {
    return { ok: false, error: "this person only accepts messages from friends and family" };
  }
  return { ok: true, family, friends };
}

function serializeFriend(row, me, getUser, publicUser) {
  const otherId = row.from === me ? row.to : row.from;
  const u = getUser(otherId);
  return {
    id: row.id,
    otherId,
    from: row.from,
    to: row.to,
    status: row.status,
    incoming: row.to === me && row.status === "pending",
    outgoing: row.from === me && row.status === "pending",
    createdAt: row.createdAt,
    user: u ? publicUser(u, me, { forSearch: true }) : { id: otherId, name: "User" }
  };
}

function attach(ctx) {
  const {
    app, DB, saveData, auth, makeId, now, getUser, publicUser,
    sharesFamily, sendToUser, userPrefs, DEMO
  } = ctx;
  ensure(DB);

  function seedDemoSocial() {
    if (DB.settings && DB.settings.demoSocialSeeded) return;
    const ts = now();
    if (!friendship(DB, "u_demo_vito", "u_demo_tom")) {
      DB.friends.push({
        id: "fr_demo_vito_tom", from: "u_demo_vito", to: "u_demo_tom",
        status: "accepted", createdAt: ts - 86400000, resolvedAt: ts - 86000000
      });
    }
    if (!friendship(DB, "u_demo_michael", "u_demo_kay")) {
      DB.friends.push({
        id: "fr_demo_mike_kay", from: "u_demo_michael", to: "u_demo_kay",
        status: "accepted", createdAt: ts - 43200000, resolvedAt: ts - 40000000
      });
    }
    if (!friendship(DB, "u_demo_carlo", "u_demo_connie")) {
      DB.friends.push({
        id: "fr_demo_carlo_connie", from: "u_demo_carlo", to: "u_demo_connie",
        status: "pending", createdAt: ts - 3600000
      });
    }
    DB.settings = DB.settings || {};
    DB.settings.demoSocialSeeded = true;
    saveData();
  }
  if (DEMO) seedDemoSocial();

  function ping(userId, payload) {
    createNotification(DB, saveData, Object.assign({
      id: makeId("nt"),
      recipientId: userId,
      createdAt: now()
    }, payload));
    sendToUser(userId, { type: "notification", action: payload.type });
  }

  app.get("/api/users/:id/relationship", auth, (req, res) => {
    const u = getUser(req.params.id);
    if (!u) return res.status(404).json({ error: "not found" });
    const rel = graph.relationshipOf(DB, req.userId, u.id, { sharesFamily });
    res.json({
      ok: true,
      relationship: rel,
      user: publicUser(u, req.userId, { forSearch: true })
    });
  });

  app.get("/api/friends", auth, (req, res) => {
    ensure(DB);
    const mine = DB.friends.filter((f) => f.from === req.userId || f.to === req.userId);
    const accepted = mine.filter((f) => f.status === "accepted").map((f) => serializeFriend(f, req.userId, getUser, publicUser));
    const incoming = mine.filter((f) => f.status === "pending" && f.to === req.userId).map((f) => serializeFriend(f, req.userId, getUser, publicUser));
    const outgoing = mine.filter((f) => f.status === "pending" && f.from === req.userId).map((f) => serializeFriend(f, req.userId, getUser, publicUser));
    res.json({ ok: true, friends: accepted, incoming, outgoing, count: accepted.length });
  });

  app.post("/api/friends/request", auth, (req, res) => {
    ensure(DB);
    const to = String((req.body || {}).userId || (req.body || {}).to || "");
    if (!to) return res.status(400).json({ error: "userId required" });
    if (to === req.userId) return res.status(400).json({ error: "cannot friend yourself" });
    const target = getUser(to);
    if (!target) return res.status(404).json({ error: "user not found" });
    if (blockedBetween(DB, req.userId, to)) return res.status(403).json({ error: "you cannot friend this person" });
    const prefs = userPrefs(target);
    if (prefs.allowFriendRequests === false) return res.status(403).json({ error: "this person is not accepting friend requests" });
    let row = friendship(DB, req.userId, to);
    if (row && row.status === "accepted") return res.json({ ok: true, already: true, friend: serializeFriend(row, req.userId, getUser, publicUser) });
    if (row && row.status === "pending") {
      if (row.to === req.userId) {
        row.status = "accepted";
        row.resolvedAt = now();
        saveData();
        sendToUser(to, { type: "friend", action: "accepted", from: req.userId });
        sendToUser(req.userId, { type: "friend", action: "accepted", from: to });
        return res.json({ ok: true, accepted: true, friend: serializeFriend(row, req.userId, getUser, publicUser) });
      }
      return res.json({ ok: true, requested: true, friend: serializeFriend(row, req.userId, getUser, publicUser) });
    }
    row = { id: makeId("fr"), from: req.userId, to, status: "pending", createdAt: now() };
    DB.friends.push(row);
    saveData();
    sendToUser(to, { type: "friend", action: "request", from: req.userId, name: req.user.name, id: row.id });
    ping(to, {
      type: "friend",
      actorId: req.userId,
      entityType: "friend_request",
      entityId: row.id,
      title: "Friend request",
      body: (req.user.name || "Someone") + " sent you a friend request.",
      url: "/?people=friends"
    });
    res.json({ ok: true, requested: true, friend: serializeFriend(row, req.userId, getUser, publicUser) });
  });

  app.get("/api/friends/requests", auth, (req, res) => {
    ensure(DB);
    const mine = DB.friends.filter((f) => f.from === req.userId || f.to === req.userId);
    res.json({
      ok: true,
      incoming: mine.filter((f) => f.status === "pending" && f.to === req.userId).map((f) => serializeFriend(f, req.userId, getUser, publicUser)),
      outgoing: mine.filter((f) => f.status === "pending" && f.from === req.userId).map((f) => serializeFriend(f, req.userId, getUser, publicUser))
    });
  });

  app.post("/api/friends/:id/accept", auth, (req, res) => {
    ensure(DB);
    const row = DB.friends.find((x) => x.id === req.params.id);
    if (!row) return res.status(404).json({ error: "request not found" });
    if (row.status === "accepted" && (row.to === req.userId || row.from === req.userId)) {
      return res.json({ ok: true, already: true, friend: serializeFriend(row, req.userId, getUser, publicUser) });
    }
    if (row.status !== "pending") return res.status(404).json({ error: "request not found" });
    if (row.to !== req.userId) return res.status(403).json({ error: "this request is not for you" });
    if (blockedBetween(DB, row.from, row.to)) return res.status(403).json({ error: "blocked" });
    row.status = "accepted";
    row.resolvedAt = now();
    saveData();
    sendToUser(row.from, { type: "friend", action: "accepted", from: req.userId, id: row.id });
    ping(row.from, {
      type: "friend",
      actorId: req.userId,
      entityType: "friend_request",
      entityId: row.id,
      title: "Friend request accepted",
      body: (req.user.name || "Someone") + " accepted your friend request.",
      url: "/?people=friends"
    });
    res.json({ ok: true, friend: serializeFriend(row, req.userId, getUser, publicUser) });
  });

  app.post("/api/friends/:id/cancel", auth, (req, res) => {
    ensure(DB);
    const row = DB.friends.find((x) => x.id === req.params.id);
    if (!row || row.status !== "pending") return res.status(404).json({ error: "request not found" });
    if (row.from !== req.userId) return res.status(403).json({ error: "only the sender can cancel" });
    DB.friends = DB.friends.filter((x) => x.id !== row.id);
    saveData();
    sendToUser(row.to, { type: "friend", action: "cancelled", from: req.userId, id: row.id });
    res.json({ ok: true });
  });

  app.post("/api/friends/:id/decline", auth, (req, res) => {
    ensure(DB);
    const row = DB.friends.find((x) => x.id === req.params.id);
    if (!row || row.status !== "pending") return res.status(404).json({ error: "request not found" });
    if (row.to !== req.userId && row.from !== req.userId) return res.status(403).json({ error: "forbidden" });
    row.status = "declined";
    row.resolvedAt = now();
    saveData();
    const other = row.from === req.userId ? row.to : row.from;
    sendToUser(other, { type: "friend", action: "declined", from: req.userId, id: row.id });
    res.json({ ok: true });
  });

  app.delete("/api/friends/:id", auth, (req, res) => {
    ensure(DB);
    const row = DB.friends.find((x) => x.id === req.params.id || x.from === req.params.id || x.to === req.params.id);
    const hit = DB.friends.find((x) =>
      x.id === req.params.id ||
      ((x.from === req.userId && x.to === req.params.id) || (x.to === req.userId && x.from === req.params.id))
    );
    if (!hit) return res.status(404).json({ error: "not found" });
    if (hit.from !== req.userId && hit.to !== req.userId) return res.status(403).json({ error: "forbidden" });
    const other = hit.from === req.userId ? hit.to : hit.from;
    DB.friends = DB.friends.filter((x) => x.id !== hit.id);
    saveData();
    sendToUser(other, { type: "friend", action: "removed", from: req.userId });
    res.json({ ok: true });
  });

  app.get("/api/blocks", auth, (req, res) => {
    ensure(DB);
    const list = DB.blocks.filter((b) => b.blockerId === req.userId).map((b) => {
      const u = getUser(b.blockedId);
      return {
        id: b.id,
        userId: b.blockedId,
        createdAt: b.createdAt,
        user: u ? publicUser(u, req.userId, { forSearch: true }) : { id: b.blockedId, name: "User" }
      };
    });
    res.json({ ok: true, blocks: list });
  });

  app.post("/api/blocks", auth, (req, res) => {
    ensure(DB);
    const userId = String((req.body || {}).userId || "");
    if (!userId) return res.status(400).json({ error: "userId required" });
    if (userId === req.userId) return res.status(400).json({ error: "cannot block yourself" });
    if (!getUser(userId)) return res.status(404).json({ error: "user not found" });
    if (iBlocked(DB, req.userId, userId)) return res.json({ ok: true, already: true });
    DB.blocks.push({ id: makeId("blk"), blockerId: req.userId, blockedId: userId, createdAt: now() });
    DB.friends = DB.friends.filter((f) =>
      !((f.from === req.userId && f.to === userId) || (f.from === userId && f.to === req.userId))
    );
    saveData();
    sendToUser(userId, { type: "friend", action: "blocked", from: req.userId });
    res.json({ ok: true });
  });

  app.delete("/api/blocks/:userId", auth, (req, res) => {
    ensure(DB);
    const userId = req.params.userId;
    const before = DB.blocks.length;
    DB.blocks = DB.blocks.filter((b) => !(b.blockerId === req.userId && b.blockedId === userId));
    if (DB.blocks.length === before) return res.status(404).json({ error: "not blocked" });
    saveData();
    res.json({ ok: true });
  });

  app.post("/api/reports", auth, (req, res) => {
    ensure(DB);
    const b = req.body || {};
    const targetId = String(b.userId || b.targetId || "");
    const reason = String(b.reason || "other").toLowerCase();
    if (!targetId) return res.status(400).json({ error: "userId required" });
    if (targetId === req.userId) return res.status(400).json({ error: "cannot report yourself" });
    if (!REPORT_REASONS.includes(reason)) return res.status(400).json({ error: "unknown reason" });
    const details = String(b.details || "").slice(0, 2000);
    const listingId = b.listingId ? String(b.listingId).slice(0, 64) : null;
    const rec = {
      id: makeId("rpt"),
      reporterId: req.userId,
      targetId,
      reason,
      details,
      listingId,
      status: "open",
      createdAt: now()
    };
    DB.reports.push(rec);
    if (DB.reports.length > 5000) DB.reports = DB.reports.slice(-4000);
    saveData();
    res.json({ ok: true, id: rec.id, status: "open" });
  });

  app.get("/api/reports/mine", auth, (req, res) => {
    ensure(DB);
    const list = DB.reports.filter((r) => r.reporterId === req.userId).slice(-50).map((r) => ({
      id: r.id, targetId: r.targetId, reason: r.reason, status: r.status, createdAt: r.createdAt, listingId: r.listingId || null
    }));
    res.json({ ok: true, reports: list });
  });

  app.get("/api/safety", auth, (req, res) => {
    ensure(DB);
    const prefs = userPrefs(req.user);
    res.json({
      ok: true,
      prefs,
      reasons: REPORT_REASONS,
      friends: DB.friends.filter((f) => (f.from === req.userId || f.to === req.userId) && f.status === "accepted").length,
      incomingFriends: DB.friends.filter((f) => f.to === req.userId && f.status === "pending").length,
      blocks: DB.blocks.filter((b) => b.blockerId === req.userId).length
    });
  });
}

module.exports = {
  attach, ensure, blockedBetween, iBlocked, areFriends, friendship, canDm, REPORT_REASONS
};
