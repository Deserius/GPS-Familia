"use strict";

let webpush = null;
try {
  webpush = require("web-push");
} catch (e) {
  console.warn("web-push not installed — phone notifications disabled until `npm install`");
}

function attachPush(ctx) {
  const { app, DB, saveData, auth } = ctx;

  function ensureVapid() {
    if (!webpush) return "";
    if (process.env.VAPID_PUBLIC && process.env.VAPID_PRIVATE) {
      DB.settings.vapidPublic = process.env.VAPID_PUBLIC;
      DB.settings.vapidPrivate = process.env.VAPID_PRIVATE;
    }
    if (!DB.settings.vapidPublic || !DB.settings.vapidPrivate) {
      const keys = webpush.generateVAPIDKeys();
      DB.settings.vapidPublic = keys.publicKey;
      DB.settings.vapidPrivate = keys.privateKey;
      saveData();
      console.log("Web Push keys created and saved. Phone alerts are on.");
    }
    const subject = process.env.VAPID_MAILTO || "mailto:familia@localhost";
    try {
      webpush.setVapidDetails(subject, DB.settings.vapidPublic, DB.settings.vapidPrivate);
    } catch (e) {
      console.warn("Web Push setup failed:", e && e.message);
      return "";
    }
    return DB.settings.vapidPublic;
  }

  const vapidPublic = ensureVapid();

  app.post("/api/push/subscribe", auth, (req, res) => {
    const sub = (req.body || {}).subscription;
    if (!sub || !sub.endpoint) return res.status(400).json({ error: "subscription required" });
    const u = req.user;
    u.pushSubs = Array.isArray(u.pushSubs) ? u.pushSubs : [];
    u.pushSubs = u.pushSubs.filter((s) => s.endpoint !== sub.endpoint);
    u.pushSubs.push({
      endpoint: sub.endpoint,
      keys: sub.keys || {},
      expirationTime: sub.expirationTime || null
    });
    if (u.pushSubs.length > 8) u.pushSubs = u.pushSubs.slice(-8);
    saveData();
    res.json({ ok: true });
  });

  app.post("/api/push/unsubscribe", auth, (req, res) => {
    const endpoint = (req.body || {}).endpoint;
    if (req.user.pushSubs && endpoint) {
      req.user.pushSubs = req.user.pushSubs.filter((s) => s.endpoint !== endpoint);
      saveData();
    }
    res.json({ ok: true });
  });

  async function notifyUser(userId, payload) {
    if (!webpush || !DB.settings.vapidPublic) return;
    const u = DB.users.find((x) => x.id === userId);
    if (!u || !Array.isArray(u.pushSubs) || !u.pushSubs.length) return;
    const body = JSON.stringify(payload);
    const kind = payload.kind || "chat";
    const urgency = (kind === "sos" || kind === "call") ? "high" : "normal";
    const ttl = kind === "sos" ? 600 : kind === "call" ? 300 : 86400;
    const keep = [];
    for (const sub of u.pushSubs) {
      try {
        await webpush.sendNotification(sub, body, { TTL: ttl, urgency });
        keep.push(sub);
      } catch (e) {
        const code = e.statusCode || e.status;
        if (code !== 404 && code !== 410) {
          keep.push(sub);
          console.warn("push fail", code, e && e.message);
        }
      }
    }
    if (keep.length !== u.pushSubs.length) {
      u.pushSubs = keep;
      saveData();
    }
  }

  async function notifyUsers(ids, payload, exceptId) {
    const seen = new Set();
    for (const id of ids || []) {
      if (!id || id === exceptId || seen.has(id)) continue;
      seen.add(id);
      await notifyUser(id, payload);
    }
  }

  return { vapidPublic, notifyUser, notifyUsers };
}

module.exports = { attachPush };
