"use strict";

/**
 * In-app notification center. Complements Web Push (push.js) — does not replace it.
 * Types: friend, family, message, payment, security, system.
 */

function ensure(DB) {
  DB.notifications = Array.isArray(DB.notifications) ? DB.notifications : [];
}

function createNotification(DB, saveData, rec) {
  ensure(DB);
  if (!rec || !rec.recipientId) return null;
  const row = {
    id: rec.id || ("nt_" + Math.random().toString(36).slice(2, 10)),
    recipientId: rec.recipientId,
    type: String(rec.type || "system").slice(0, 32),
    actorId: rec.actorId || null,
    entityType: rec.entityType || null,
    entityId: rec.entityId || null,
    title: String(rec.title || "").slice(0, 120),
    body: String(rec.body || "").slice(0, 240),
    url: String(rec.url || "/").slice(0, 200),
    readAt: null,
    createdAt: rec.createdAt || Date.now()
  };
  DB.notifications.unshift(row);
  if (DB.notifications.length > 4000) DB.notifications = DB.notifications.slice(0, 3500);
  if (typeof saveData === "function") saveData();
  return row;
}

function serialize(n) {
  return {
    id: n.id,
    type: n.type,
    actorId: n.actorId,
    entityType: n.entityType,
    entityId: n.entityId,
    title: n.title,
    body: n.body,
    url: n.url,
    readAt: n.readAt || null,
    createdAt: n.createdAt
  };
}

function attach(ctx) {
  const { app, DB, saveData, auth, makeId, now, sendToUser } = ctx;
  ensure(DB);

  app.get("/api/notifications", auth, (req, res) => {
    ensure(DB);
    const filter = String(req.query.filter || "all").toLowerCase();
    const limit = Math.min(80, Math.max(8, Number(req.query.limit || 40)));
    let list = DB.notifications.filter((n) => n.recipientId === req.userId);
    if (filter === "unread") list = list.filter((n) => !n.readAt);
    else if (filter !== "all") list = list.filter((n) => n.type === filter);
    const unread = DB.notifications.filter((n) => n.recipientId === req.userId && !n.readAt).length;
    res.json({
      ok: true,
      unread,
      notifications: list.slice(0, limit).map(serialize)
    });
  });

  app.get("/api/notifications/summary", auth, (req, res) => {
    ensure(DB);
    const mine = DB.notifications.filter((n) => n.recipientId === req.userId && !n.readAt);
    const by = { friend: 0, family: 0, message: 0, payment: 0, security: 0, system: 0 };
    mine.forEach((n) => { if (by[n.type] != null) by[n.type] += 1; });
    res.json({ ok: true, unread: mine.length, by });
  });

  app.post("/api/notifications/:id/read", auth, (req, res) => {
    ensure(DB);
    const n = DB.notifications.find((x) => x.id === req.params.id && x.recipientId === req.userId);
    if (!n) return res.status(404).json({ error: "not found" });
    if (!n.readAt) n.readAt = now();
    saveData();
    res.json({ ok: true });
  });

  app.post("/api/notifications/read-all", auth, (req, res) => {
    ensure(DB);
    const ts = now();
    let n = 0;
    DB.notifications.forEach((row) => {
      if (row.recipientId === req.userId && !row.readAt) {
        row.readAt = ts;
        n += 1;
      }
    });
    saveData();
    res.json({ ok: true, read: n });
  });

  function notify(userId, payload) {
    const row = createNotification(DB, saveData, Object.assign({ id: makeId("nt"), recipientId: userId }, payload || {}));
    if (row && typeof sendToUser === "function") {
      sendToUser(userId, { type: "notification", notification: serialize(row) });
    }
    return row;
  }

  return { notify, createNotification };
}

module.exports = { attach, createNotification, ensure };
