"use strict";

/**
 * GPS FAMILIA HTTP + WebSocket composition root (v2.17.0)
 * Auth is Bearer-only on REST. Secrets live in .env / f360_data.json (gitignored).
 * Domain logic lives in *-server.js and modules/*. Do not flatten those back in.
 * Demo passwords are never returned by /api/config. See SECURITY.md and docs/.
 */

const express = require("express");
const http = require("http");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const { WebSocketServer } = require("ws");
const { rateLimit, securityHeaders, corsOriginDelegate } = require("./security");
const { requestLogger, info: logInfo, error: logError } = require("./lib/log");
const { gzipJson } = require("./lib/gzip");
const { unhandled } = require("./lib/errors");
const { loadDotEnv, getConfig, VERSION } = require("./config");
const invites = require("./modules/families/invites");
const { makeId, hashPassword, verifyPassword, randomHex } = require("./lib/crypto");
const { isEmail, passwordOk, coords, digits, normalizePhone, maskPhone, maskEmail } = require("./lib/validate");
const graph = require("./modules/social/graph");
const msgReq = require("./modules/messaging/requests");
const { createNotification } = require("./notify-server");
const { sendMail, sendSms } = require("./lib/notify");
const { verifyGoogleIdToken: verifyGoogleToken } = require("./lib/google");

loadDotEnv(path.join(__dirname, ".env"));
const cfg = getConfig();
const PROD = cfg.PROD;
const DATA_FILE = cfg.DATA_FILE;
const PORT = cfg.PORT;
const HOST = cfg.HOST;
const OTP_ECHO = cfg.OTP_ECHO;
const SESSION_MS = cfg.SESSION_MS;
const DEMO = cfg.DEMO;
const DEMO_PASSWORD = cfg.DEMO_PASSWORD;
const { attach: attachCommunity, ensureFamilyRoles, can: familyCan, roleOf, briefing: familyBriefing } = require("./community-server");
const social = require("./social-server");
const { attach: attachMarket } = require("./market-server");
const { attach: attachPay, configSnippet: payConfig } = require("./pay-server");
const { attachRooms } = require("./rooms-server");
const { attachCalls, configSnippet: callsConfig } = require("./calls-server");

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8") || "{}");
  } catch (e) {
    return {};
  }
}

function normalizeDb(d) {
  d.users = Array.isArray(d.users) ? d.users : [];
  d.families = Array.isArray(d.families) ? d.families : [];
  d.messages = Array.isArray(d.messages) ? d.messages : [];
  d.places = Array.isArray(d.places) ? d.places : [];
  d.joinRequests = Array.isArray(d.joinRequests) ? d.joinRequests : [];
  d.otps = d.otps && typeof d.otps === "object" ? d.otps : {};
  d.sessions = d.sessions && typeof d.sessions === "object" ? d.sessions : {};
  d.settings = d.settings && typeof d.settings === "object" ? d.settings : {};
  d.posts = Array.isArray(d.posts) ? d.posts : [];
  d.rooms = Array.isArray(d.rooms) ? d.rooms : [];
  d.friends = Array.isArray(d.friends) ? d.friends : [];
  d.blocks = Array.isArray(d.blocks) ? d.blocks : [];
  d.reports = Array.isArray(d.reports) ? d.reports : [];
  d.listings = Array.isArray(d.listings) ? d.listings : [];
  d.offers = Array.isArray(d.offers) ? d.offers : [];
  d.wallets = d.wallets && typeof d.wallets === "object" ? d.wallets : {};
  d.notifications = Array.isArray(d.notifications) ? d.notifications : [];
  d.qrTokens = Array.isArray(d.qrTokens) ? d.qrTokens : [];
  d.messageRequests = Array.isArray(d.messageRequests) ? d.messageRequests : [];
  return d;
}

function googleClientId() {
  return String(process.env.GOOGLE_CLIENT_ID || (DB.settings && DB.settings.googleClientId) || "").trim();
}

let DB = normalizeDb(loadData());
saveData();

let lastPrune = 0;
function pruneEphemeral() {
  const t = Date.now();
  const sess = DB.sessions || {};
  Object.keys(sess).forEach((k) => {
    if (!sess[k] || sess[k].exp < t) delete sess[k];
  });
  const otps = DB.otps || {};
  Object.keys(otps).forEach((k) => {
    if (!otps[k] || otps[k].exp < t) delete otps[k];
  });
}

function saveData() {
  try {
    const t = Date.now();
    if (t - lastPrune > 60000) {
      pruneEphemeral();
      lastPrune = t;
    }
    const tmp = DATA_FILE + ".tmp";
    const body = JSON.stringify(DB, null, PROD ? 0 : 2);
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, DATA_FILE);
  } catch (e) {
    try { fs.writeFileSync(DATA_FILE, JSON.stringify(DB, null, PROD ? 0 : 2)); } catch (e2) {
      console.error("Failed to persist database", e2 && e2.message);
    }
  }
}

function now() { return Date.now(); }

function createSession(userId) {
  const token = randomHex(24);
  DB.sessions[token] = { userId, createdAt: now(), exp: now() + SESSION_MS };
  saveData();
  return token;
}

function getUser(id) {
  return DB.users.find((u) => u.id === id) || null;
}

function familyIdsFor(userId) {
  return DB.families.filter((f) => Array.isArray(f.members) && f.members.includes(userId)).map((f) => f.id);
}

function sharesFamily(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  return DB.families.some((f) => Array.isArray(f.members) && f.members.includes(a) && f.members.includes(b));
}

function publicFamily(f) {
  if (!f) return f;
  const out = Object.assign({}, f);
  delete out.password;
  return out;
}

function mintInviteToken(fid, fromId) {
  return invites.mintInviteToken(fid, fromId, now());
}
function findInviteFamily(raw) {
  return invites.findInviteFamily(raw, DB.families);
}

function invitePreviewPayload(f, userId, token, decoded) {
  ensureFamilyRoles(f);
  const already = (f.members || []).includes(userId);
  const fromId = (decoded && decoded.from) || f.ownerId;
  const inviter = fromId ? getUser(fromId) : null;
  const defs = f.roleDefs || {};
  const members = (f.members || []).map((id) => {
    const u = getUser(id);
    const r = roleOf(f, id);
    return {
      id,
      name: u ? u.name : "Member",
      role: r,
      roleLabel: (defs[r] && defs[r].label) || r,
      isHead: r === "owner" || id === f.ownerId
    };
  });
  const briefing = familyBriefing(f, userId, already ? {} : { asRole: "member" });
  return {
    ok: true,
    alreadyMember: already,
    family: {
      id: f.id,
      name: f.name,
      privacy: f.privacy,
      memberCount: (f.members || []).length
    },
    invitedBy: inviter ? { id: inviter.id, name: inviter.name } : null,
    members,
    roles: briefing.roles || [],
    briefing,
    token
  };
}

function memberSetFor(userId) {
  const set = new Set([userId]);
  DB.families.forEach((f) => {
    if (Array.isArray(f.members) && f.members.includes(userId)) {
      ensureFamilyRoles(f);
      if (!familyCan(f, userId, "viewLocation")) return;
      f.members.forEach((id) => {
        if (familyCan(f, id, "viewLocation")) set.add(id);
      });
    }
  });
  return set;
}

function defaultPrefs() {
  return {
    appearOnMap: true,
    preciseLocation: true,
    showLastSeen: true,
    shareEmailWithFamily: true,
    sharePhoneWithFamily: true,
    allowHistory: true,
    recordHistory: true,
    shareEmailWithFriends: false,
    sharePhoneWithFriends: false,
    shareLocationWithFriends: false,
    allowFriendRequests: true,
    appearInSearch: true,
    showOnlineStatus: true,
    allowMarketplaceContact: true,
    readReceipts: true,
    typingIndicators: true,
    hideBlockedInSearch: true,
    allowMessagesFrom: "anyone",
    allowCallsFrom: "anyone",
    showProfileTo: "everyone",
    findByName: "everyone",
    findByEmail: "everyone",
    findByPhone: "everyone"
  };
}

const PREF_BOOLS = [
  "appearOnMap", "preciseLocation", "showLastSeen", "shareEmailWithFamily", "sharePhoneWithFamily",
  "allowHistory", "recordHistory", "shareEmailWithFriends", "sharePhoneWithFriends", "shareLocationWithFriends",
  "allowFriendRequests", "appearInSearch", "showOnlineStatus", "allowMarketplaceContact",
  "readReceipts", "typingIndicators", "hideBlockedInSearch"
];
const PREF_ENUMS = {
  allowMessagesFrom: ["anyone", "friends", "family", "nobody"],
  allowCallsFrom: ["anyone", "friends", "family"],
  showProfileTo: ["everyone", "friends", "family"],
  findByName: ["everyone", "friends", "nobody"],
  findByEmail: ["everyone", "nobody"],
  findByPhone: ["everyone", "nobody"]
};
function userPrefs(u) {
  return Object.assign({}, defaultPrefs(), (u && u.prefs && typeof u.prefs === "object") ? u.prefs : {});
}
function isChild(u) {
  return !!(u && (u.accountType === "child" || u.child === true));
}
function fuzzCoord(n) {
  return Math.round(Number(n) * 100) / 100;
}

const HISTORY_CAP = 2000;
const MINUTE_MS = 55 * 1000;

function appendHistory(u, lat, lng, ts, type, force) {
  if (!u) return false;
  if (!u.locationHistory) u.locationHistory = [];
  const last = u.locationHistory[u.locationHistory.length - 1];
  if (last && Math.abs(ts - (last.ts || 0)) < 4000 && Math.abs(last.lat - lat) < 1e-6 && Math.abs(last.lng - lng) < 1e-6) return false;
  if (!force && last && (ts - (last.ts || 0)) < MINUTE_MS) return false;
  u.locationHistory.push({ lat, lng, ts, type: type || "minute" });
  if (u.locationHistory.length > HISTORY_CAP) u.locationHistory = u.locationHistory.slice(-HISTORY_CAP);
  return true;
}

function publicUser(u, viewerId, opts = {}) {
  if (!u) return null;
  const self = viewerId && u.id === viewerId;
  const family = viewerId ? sharesFamily(viewerId, u.id) : false;
  const friends = viewerId ? social.areFriends(DB, viewerId, u.id) : false;
  const blocked = viewerId ? social.blockedBetween(DB, viewerId, u.id) : false;
  const prefs = userPrefs(u);
  let showLoc = !!(self || family || (friends && prefs.shareLocationWithFriends === true));
  if (blocked && !self) showLoc = false;
  if (showLoc && viewerId && viewerId !== u.id && family) {
    const shared = DB.families.filter((f) => (f.members || []).includes(viewerId) && (f.members || []).includes(u.id));
    showLoc = shared.some((f) => {
      ensureFamilyRoles(f);
      return familyCan(f, viewerId, "viewLocation") && familyCan(f, u.id, "viewLocation");
    });
    if (prefs.appearOnMap === false) showLoc = false;
  }
  if (prefs.appearOnMap === false && !self) showLoc = false;
  const out = {
    id: u.id,
    name: u.name || "",
    createdAt: u.createdAt,
    inFamily: !!family,
    friend: !!friends,
    blocked: !!(viewerId && social.iBlocked(DB, viewerId, u.id)),
    online: (prefs.showOnlineStatus !== false || self || family) ? isOnline(u.id) : false,
    hasProfile: !!(u.profileImage),
    appearOnMap: prefs.appearOnMap !== false,
    tracking: !!u.tracking,
    child: isChild(u)
  };
  if (self) {
    out.prefs = prefs;
    out.accountType = isChild(u) ? "child" : (u.accountType || "adult");
  }
  if (self || family || friends || opts.forSearch) {
    const hideContact = opts.forSearch && !self && !family && !friends;
    if (hideContact) {
      out.phone = maskPhone(u.phone);
      out.email = maskEmail(u.email);
    } else {
      const phoneOk = self || (family && prefs.sharePhoneWithFamily) || (friends && prefs.sharePhoneWithFriends);
      const emailOk = self || (family && prefs.shareEmailWithFamily) || (friends && prefs.shareEmailWithFriends);
      out.phone = phoneOk ? (u.phone || "") : maskPhone(u.phone);
      out.email = emailOk ? (u.email || "") : maskEmail(u.email);
    }
  }
  if (showLoc && !opts.forSearch && u.lastLocation && (self || u.tracking)) {
    const loc = u.lastLocation;
    if (prefs.preciseLocation === false && !self) {
      out.lastLocation = {
        lat: fuzzCoord(loc.lat),
        lng: fuzzCoord(loc.lng),
        ts: prefs.showLastSeen === false && !self ? null : loc.ts,
        approx: true,
        live: !!u.tracking
      };
    } else {
      out.lastLocation = {
        lat: loc.lat,
        lng: loc.lng,
        ts: prefs.showLastSeen === false && !self ? null : loc.ts,
        approx: false,
        live: !!u.tracking
      };
    }
    if (opts.includeHistory) {
      const histOk = self || prefs.allowHistory !== false;
      if (histOk) {
        let hist = (u.locationHistory || []).slice(-HISTORY_CAP);
        if (prefs.preciseLocation === false && !self) {
          hist = hist.map((h) => ({ lat: fuzzCoord(h.lat), lng: fuzzCoord(h.lng), ts: h.ts, type: h.type, approx: true }));
        }
        out.locationHistory = hist;
      } else {
        out.locationHistory = [];
      }
    }
  }
  if (u.profileImage && String(u.profileImage).startsWith("/avatars/")) {
    out.profileImage = u.profileImage;
  } else if ((self || family) && u.profileImage && opts.includeProfile) {
    out.profileImage = u.profileImage;
  }
  return out;
}

const socketsByUser = new Map(); // userId -> Set<ws>

function isOnline(userId) {
  const set = socketsByUser.get(userId);
  return !!(set && set.size);
}

function attachSocket(userId, ws) {
  if (!socketsByUser.has(userId)) socketsByUser.set(userId, new Set());
  socketsByUser.get(userId).add(ws);
  ws.userId = userId;
}

function detachSocket(ws) {
  const userId = ws.userId;
  if (!userId) return;
  const set = socketsByUser.get(userId);
  if (set) {
    set.delete(ws);
    if (!set.size) socketsByUser.delete(userId);
  }
}

function sendToUser(userId, payload) {
  const set = socketsByUser.get(userId);
  if (!set) return;
  const raw = JSON.stringify(payload);
  set.forEach((ws) => {
    if (ws.readyState === 1) {
      try { ws.send(raw); } catch (e) {}
    }
  });
}

function broadcastToFamilyOf(userId, payload, exceptId) {
  const members = memberSetFor(userId);
  members.forEach((id) => {
    if (exceptId && id === exceptId) return;
    sendToUser(id, payload);
  });
}

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(cors({ origin: corsOriginDelegate(), credentials: true }));
app.use(securityHeaders);
app.use(requestLogger);
app.use(gzipJson);
app.use(express.json({ limit: "8mb" }));
const RATE_API = cfg.RATE_API;
const RATE_LOGIN = cfg.RATE_LOGIN;
const RATE_REG = cfg.RATE_REG;
const RATE_OTP = cfg.RATE_OTP;
app.use("/api", rateLimit({ name: "api", windowMs: 60 * 1000, max: RATE_API }));
app.use("/api/login", rateLimit({ name: "login", windowMs: 60 * 1000, max: RATE_LOGIN }));
app.use("/api/register", rateLimit({ name: "register", windowMs: 15 * 60 * 1000, max: RATE_REG }));
app.use("/api/send-otp", rateLimit({ name: "otp", windowMs: 15 * 60 * 1000, max: RATE_OTP }));
app.use("/api/auth", rateLimit({ name: "auth", windowMs: 60 * 1000, max: cfg.RATE_AUTH }));

app.use((req, res, next) => {
  const p = (req.path || "").toLowerCase();
  if (
    p.includes("f360_data") ||
    p === "/.env" ||
    p.startsWith("/node_modules") ||
    p.endsWith(".tmp") ||
    p === "/server.js" ||
    p.endsWith("-server.js") ||
    p === "/security.js" ||
    p === "/push.js" ||
    p.startsWith("/config/") ||
    p.startsWith("/modules/") ||
    p.startsWith("/scripts/") ||
    p.startsWith("/lib/") ||
    p.startsWith("/tests/") ||
    p.startsWith("/docs/") ||
    p.startsWith("/.github") ||
    p === "/package.json" ||
    p === "/package-lock.json" ||
    p === "/dockerfile" ||
    p === "/docker-compose.yml" ||
    p === "/procfile" ||
    p === "/render.yaml" ||
    p === "/developer.txt" ||
    p === "/deploy.txt" ||
    p === "/architecture.txt"
  ) {
    return res.status(404).json({ error: "not found" });
  }
  next();
});

const UPLOAD_DIR = path.join(__dirname, "uploads");
try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (e) {}

const MEDIA_EXT = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov"
};

function auth(req, res, next) {
  const h = req.headers.authorization || "";
  let token = "";
  if (h.startsWith("Bearer ")) token = h.slice(7).trim();
  else if (req.headers["x-session-token"]) token = String(req.headers["x-session-token"]);
  if (!token) return res.status(401).json({ error: "unauthorized" });
  const sess = DB.sessions[token];
  if (!sess || sess.exp < now()) return res.status(401).json({ error: "unauthorized" });
  const user = getUser(sess.userId);
  if (!user) return res.status(401).json({ error: "unauthorized" });
  req.user = user;
  req.userId = user.id;
  req.token = token;
  next();
}

function optionalAuth(req, res, next) {
  const h = req.headers.authorization || "";
  let token = "";
  if (h.startsWith("Bearer ")) token = h.slice(7).trim();
  else if (req.headers["x-session-token"]) token = String(req.headers["x-session-token"]);
  if (token && DB.sessions[token] && DB.sessions[token].exp >= now()) {
    const user = getUser(DB.sessions[token].userId);
    if (user) {
      req.user = user;
      req.userId = user.id;
      req.token = token;
    }
  }
  next();
}

app.post("/api/media", auth, express.raw({ type: () => true, limit: "16mb" }), (req, res) => {
  const mime = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  const ext = MEDIA_EXT[mime];
  if (!ext) return res.status(400).json({ error: "Use a photo (jpg, png, webp, gif) or video (mp4, webm, mov)." });
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || buf.length < 12) return res.status(400).json({ error: "empty file" });
  if (buf.length > 16 * 1024 * 1024) return res.status(413).json({ error: "file too large (16 MB max)" });
  const fname = makeId("media") + ext;
  try {
    fs.writeFileSync(path.join(UPLOAD_DIR, fname), buf);
  } catch (e) {
    return res.status(500).json({ error: "could not store file" });
  }
  const kind = mime.startsWith("video/") ? "video" : "image";
  res.json({ ok: true, url: "/uploads/" + fname, mime, kind, size: buf.length });
});

app.get("/api/health", (req, res) => {
  const mem = process.memoryUsage();
  res.json({
    ok: true,
    ts: now(),
    version: VERSION,
    realtime: true,
    uptime: Math.round(process.uptime()),
    rssMb: Math.round(mem.rss / 1048576)
  });
});

app.get(["/api/ready", "/ready"], (req, res) => {
  res.json({ ok: true, ready: true, version: VERSION, uptime: Math.round(process.uptime()) });
});

app.get("/api/diag", (req, res) => {
  if (PROD && String(process.env.DEBUG_API || "") !== "1") {
    return res.status(404).json({ error: "not found" });
  }
  const mem = process.memoryUsage();
  res.json({
    ok: true,
    version: VERSION,
    demo: DEMO,
    uptime: Math.round(process.uptime()),
    rssMb: Math.round(mem.rss / 1048576),
    counts: {
      users: (DB.users || []).length,
      families: (DB.families || []).length,
      listings: (DB.listings || []).length,
      messages: (DB.messages || []).length,
      sockets: socketsByUser.size
    }
  });
});

app.get("/api/config", (req, res) => {
  const gid = googleClientId();
  res.json({
    ok: true,
    version: VERSION,
    otpEcho: OTP_ECHO,
    sms: !!(process.env.TWILIO_SID && process.env.TWILIO_TOKEN && process.env.TWILIO_FROM),
    email: !!process.env.SMTP_USER,
    realtime: true,
    googleClientId: gid || "",
    google: !!gid,
    pwa: true,
    demo: DEMO,
    i18n: ["en", "es"],
    market: true,
    friends: true,
    people: true,
    qr: true,
    notifications: true,
    messageRequests: true,
    ...payConfig(),
    vapidPublic: (DB.settings && DB.settings.vapidPublic) || "",
    push: !!(DB.settings && DB.settings.vapidPublic),
    ...callsConfig()
  });
});

const i18nCache = Object.create(null);
function loadLocale(lang) {
  if (i18nCache[lang]) return i18nCache[lang];
  try {
    i18nCache[lang] = JSON.parse(fs.readFileSync(path.join(__dirname, "locales", lang + ".json"), "utf8"));
  } catch (e) {
    i18nCache[lang] = {};
  }
  return i18nCache[lang];
}
app.get("/api/i18n", (req, res) => {
  const want = String(req.query.lang || "en").toLowerCase().slice(0, 2);
  const lang = want === "es" ? "es" : "en";
  res.json({ ok: true, lang, supported: ["en", "es"], strings: loadLocale(lang) });
});

app.post("/api/setup/google", optionalAuth, (req, res) => {
  if (process.env.GOOGLE_CLIENT_ID) {
    return res.status(403).json({ error: "GOOGLE_CLIENT_ID is locked by server environment" });
  }
  const id = String((req.body || {}).clientId || "").trim();
  if (!id || !id.includes(".apps.googleusercontent.com")) {
    return res.status(400).json({ error: "Paste a Google OAuth Web Client ID (…apps.googleusercontent.com)" });
  }
  if (DB.settings.googleClientId && !req.userId) {
    return res.status(401).json({ error: "sign in to change the Google client id" });
  }
  DB.settings.googleClientId = id;
  saveData();
  res.json({ ok: true, googleClientId: id });
});

async function verifyGoogleIdToken(credential) {
  return verifyGoogleToken(credential, googleClientId());
}

app.post("/api/auth/google", async (req, res) => {
  const { credential } = req.body || {};
  if (!credential) return res.status(400).json({ error: "credential required" });
  let profile;
  try {
    profile = await verifyGoogleIdToken(credential);
  } catch (e) {
    return res.status(401).json({ error: e.message || "google auth failed" });
  }
  const em = String(profile.email).toLowerCase();
  let created = false;
  let u = DB.users.find((x) => x.googleSub === profile.sub || (x.email && x.email.toLowerCase() === em));
  if (!u) {
    created = true;
    let name = String(profile.name || em.split("@")[0] || "Google user").trim();
    if (DB.users.find((x) => x.name && x.name.toLowerCase() === name.toLowerCase())) {
      name = name + " " + String(profile.sub).slice(-4);
    }
    u = {
      id: makeId("u"),
      name,
      email: em,
      phone: "",
      password: "",
      googleSub: profile.sub,
      createdAt: now(),
      locationHistory: []
    };
    if (profile.picture) u.googlePicture = profile.picture;
    DB.users.push(u);
  } else {
    u.googleSub = profile.sub;
    if (!u.email) u.email = em;
  }
  const sessionToken = createSession(u.id);
  saveData();
  res.json({ ok: true, created, sessionToken, user: publicUser(u, u.id, { includeProfile: true, includeHistory: true }) });
});


app.post("/api/send-otp", async (req, res) => {
  const { phone, email } = req.body || {};
  if (!phone) return res.status(400).json({ error: "phone required" });
  const code = DEMO ? "000000" : String(Math.floor(Math.random() * 900000) + 100000);
  const exp = now() + 3 * 60 * 1000;
  const token = randomHex(16);
  DB.otps[phone] = { code, exp, token };
  saveData();
  const text = `Your GPS-FAMILIA code is ${code}. It expires in 3 minutes.`;
  let emailed = false, sms = false;
  if (email) emailed = await sendMail(email, "Your GPS-FAMILIA OTP", text);
  sms = await sendSms(phone, text);
  if (OTP_ECHO) console.log(`[OTP] ${phone} -> ${code}${emailed ? " (email)" : ""}${sms ? " (sms)" : ""}`);
  else console.log(`[OTP] sent to ${maskPhone(phone)}${emailed ? " (email)" : ""}${sms ? " (sms)" : ""}`);
  const out = { ok: true, delivered: { email: emailed, sms } };
  if (OTP_ECHO) out.otp = code;
  res.json(out);
});

app.post("/api/verify-otp", (req, res) => {
  const { phone, code } = req.body || {};
  if (!phone || !code) return res.status(400).json({ error: "phone & code required" });
  const rec = DB.otps[phone];
  if (!rec) return res.status(400).json({ error: "no otp sent" });
  if (rec.exp < now()) return res.status(400).json({ error: "expired" });
  const codeOk = String(rec.code) === String(code).trim() || (DEMO && ["000000", "123456"].includes(String(code).trim()));
  if (!codeOk) return res.status(400).json({ error: "bad code" });
  let created = false;
  let user = DB.users.find((u) => u.phone === phone);
  if (!user) {
    created = true;
    user = {
      id: makeId("u"),
      name: "User " + String(phone).slice(-4),
      email: "",
      phone,
      password: "",
      createdAt: now(),
      locationHistory: []
    };
    DB.users.push(user);
  }
  const sessionToken = createSession(user.id);
  rec.sessionToken = sessionToken;
  saveData();
  res.json({
    ok: true,
    created,
    sessionToken,
    user: publicUser(user, user.id, { includeProfile: true })
  });
});

app.post("/api/register", async (req, res) => {
  const { name, email, phone, password } = req.body || {};
  const nameTxt = String(name || "").trim();
  const em = String(email || "").trim();
  const phoneTxt = String(phone || "").trim();
  if (!nameTxt) return res.status(400).json({ error: "name required" });
  if (!isEmail(em)) return res.status(400).json({ error: "valid email required" });
  if (!passwordOk(password)) return res.status(400).json({ error: "password must be at least 6 characters" });

  if (DB.users.find((u) => u.email && u.email.toLowerCase() === em.toLowerCase())) {
    return res.status(409).json({ error: "email used" });
  }
  if (DB.users.find((u) => u.name && u.name.toLowerCase() === nameTxt.toLowerCase())) {
    return res.status(409).json({ error: "username taken" });
  }
  if (phoneTxt && DB.users.find((u) => u.phone && (u.phone === phoneTxt || digits(u.phone) === digits(phoneTxt)))) {
    return res.status(409).json({ error: "phone used" });
  }

  const accountType = String((req.body || {}).accountType || "adult").toLowerCase() === "child" ? "child" : "adult";
  const u = {
    id: makeId("u"),
    name: nameTxt,
    email: em,
    phone: phoneTxt,
    password: hashPassword(password),
    createdAt: now(),
    locationHistory: [],
    accountType,
    tracking: false
  };
  if (accountType === "child") {
    u.prefs = Object.assign(defaultPrefs(), {
      allowMessagesFrom: "friends",
      allowCallsFrom: "friends",
      allowMarketplaceContact: false,
      showProfileTo: "friends"
    });
  }
  DB.users.push(u);
  const sessionToken = createSession(u.id);
  saveData();
  sendMail(em, "Welcome to GPS-FAMILIA", `Hi ${nameTxt},\n\nWelcome to GPS-FAMILIA. Your account is ready.\n\n- The GPS-FAMILIA Team`);
  res.json({ ok: true, created: true, sessionToken, user: publicUser(u, u.id, { includeProfile: true }) });
});

app.post("/api/login", (req, res) => {
  const { identifier, password } = req.body || {};
  if (!identifier) return res.status(400).json({ error: "identifier required" });
  const idn = String(identifier).trim();
  const idnDigits = digits(idn);
  const u = DB.users.find((x) =>
    (x.email && x.email.toLowerCase() === idn.toLowerCase()) ||
    (x.name && x.name.toLowerCase() === idn.toLowerCase()) ||
    (x.phone && (x.phone === idn || (idnDigits && digits(x.phone) === idnDigits)))
  );
  if (!u) return res.status(401).json({ error: "not found" });
  if (!verifyPassword(password || "", u.password || "")) return res.status(401).json({ error: "bad password" });
  if (u.password && !String(u.password).startsWith("scrypt$") && password) {
    u.password = hashPassword(password);
    saveData();
  }
  const sessionToken = createSession(u.id);
  res.json({ ok: true, sessionToken, user: publicUser(u, u.id, { includeProfile: true, includeHistory: true }) });
});

app.post("/api/logout", auth, (req, res) => {
  delete DB.sessions[req.token];
  saveData();
  res.json({ ok: true });
});

app.get("/api/me", auth, (req, res) => {
  res.json({ ok: true, user: publicUser(req.user, req.userId, { includeProfile: true, includeHistory: true }) });
});

app.put("/api/me", auth, (req, res) => {
  const { name, email, phone, prefs } = req.body || {};
  if (name) {
    const nameTxt = String(name).trim();
    if (!nameTxt) return res.status(400).json({ error: "name required" });
    const clash = DB.users.find((x) => x.id !== req.userId && x.name && x.name.toLowerCase() === nameTxt.toLowerCase());
    if (clash) return res.status(409).json({ error: "username taken" });
    req.user.name = nameTxt;
  }
  if (email) {
    const em = String(email).trim();
    if (!isEmail(em)) return res.status(400).json({ error: "valid email required" });
    const clash = DB.users.find((x) => x.id !== req.userId && x.email && x.email.toLowerCase() === em.toLowerCase());
    if (clash) return res.status(409).json({ error: "email used" });
    req.user.email = em;
  }
  if (phone !== undefined) req.user.phone = String(phone).trim();
  if (prefs && typeof prefs === "object") {
    const cur = userPrefs(req.user);
    const next = Object.assign({}, cur);
    PREF_BOOLS.forEach((k) => {
      if (typeof prefs[k] === "boolean") next[k] = prefs[k];
    });
    Object.keys(PREF_ENUMS).forEach((k) => {
      if (prefs[k] != null && PREF_ENUMS[k].includes(String(prefs[k]))) next[k] = String(prefs[k]);
    });
    req.user.prefs = next;
  }
  saveData();
  broadcastToFamilyOf(req.userId, { type: "profile", userId: req.userId });
  res.json({ ok: true, user: publicUser(req.user, req.userId, { includeProfile: true, includeHistory: true }) });
});

app.post("/api/me/password", auth, (req, res) => {
  const { current, next } = req.body || {};
  const nextPw = String(next || "");
  if (!passwordOk(nextPw)) return res.status(400).json({ error: "password must be at least 6 characters" });
  if (req.user.password) {
    if (!verifyPassword(current || "", req.user.password)) return res.status(401).json({ error: "bad current password" });
  }
  req.user.password = hashPassword(nextPw);
  saveData();
  res.json({ ok: true });
});

app.delete("/api/me", auth, (req, res) => {
  if (req.user.demo) return res.status(403).json({ error: "demo accounts cannot be deleted" });
  const { password } = req.body || {};
  if (req.user.password && !verifyPassword(password || "", req.user.password)) {
    return res.status(401).json({ error: "bad password" });
  }
  const uid = req.userId;
  Object.keys(DB.sessions).forEach((tok) => {
    if (DB.sessions[tok] && DB.sessions[tok].userId === uid) delete DB.sessions[tok];
  });
  DB.families.forEach((f) => {
    f.members = (f.members || []).filter((id) => id !== uid);
    if (f.roles) delete f.roles[uid];
    if (f.ownerId === uid) f.ownerId = (f.members && f.members[0]) || f.ownerId;
  });
  DB.messages = (DB.messages || []).filter((m) => m.from !== uid && m.to !== uid);
  DB.places = (DB.places || []).filter((p) => p.ownerId !== uid);
  DB.posts = (DB.posts || []).filter((p) => p.authorId !== uid);
  (DB.rooms || []).forEach((r) => {
    r.members = (r.members || []).filter((id) => id !== uid);
    if (r.ownerId === uid) r.ownerId = (r.members && r.members[0]) || r.ownerId;
  });
  DB.users = DB.users.filter((u) => u.id !== uid);
  saveData();
  res.json({ ok: true });
});

let avatarCatMemo = null;
function avatarCatalog() {
  if (avatarCatMemo) return avatarCatMemo;
  try {
    avatarCatMemo = JSON.parse(fs.readFileSync(path.join(__dirname, "avatars", "catalog.json"), "utf8"));
  } catch (e) {
    avatarCatMemo = { avatars: [] };
  }
  return avatarCatMemo;
}
function isAllowedAvatarPath(p) {
  return /^\/avatars\/[A-Za-z0-9._-]+\.(png|jpg|jpeg|svg|webp)$/.test(String(p || ""));
}

app.get("/api/avatars", (req, res) => {
  const cat = avatarCatalog();
  const list = (cat.avatars || []).filter((a) => {
    if (!a || !a.file) return false;
    const abs = path.join(__dirname, String(a.file).replace(/^\//, ""));
    try { return fs.existsSync(abs); } catch (e) { return false; }
  });
  res.json({ ok: true, count: list.length, avatars: list });
});

app.post("/api/me/profile", auth, (req, res) => {
  const { image, avatarId } = req.body || {};
  if (avatarId) {
    const id = String(avatarId).replace(/[^a-z0-9_-]/gi, "");
    const cat = avatarCatalog();
    const hit = (cat.avatars || []).find((a) => a.id === id);
    const file = hit && hit.file;
    if (!file || !isAllowedAvatarPath(file)) return res.status(404).json({ error: "avatar not found" });
    const abs = path.join(__dirname, file.replace(/^\//, ""));
    if (!fs.existsSync(abs)) return res.status(404).json({ error: "avatar not found" });
    req.user.profileImage = file;
    req.user.avatarId = id;
  } else if (typeof image === "string" && isAllowedAvatarPath(image)) {
    const abs = path.join(__dirname, image.replace(/^\//, ""));
    if (!fs.existsSync(abs)) return res.status(404).json({ error: "avatar not found" });
    req.user.profileImage = image;
    req.user.avatarId = path.basename(image).replace(/\.[^.]+$/, "");
  } else if (typeof image === "string" && image.startsWith("data:image/")) {
    if (image.length > 7_000_000) return res.status(413).json({ error: "image too large" });
    req.user.profileImage = image;
    delete req.user.avatarId;
  } else {
    return res.status(400).json({ error: "image or avatarId required" });
  }
  saveData();
  broadcastToFamilyOf(req.userId, { type: "profile", userId: req.userId });
  res.json({ ok: true, profileImage: isAllowedAvatarPath(req.user.profileImage) ? req.user.profileImage : "" });
});

app.get("/api/users/:id/profile", auth, (req, res) => {
  const u = getUser(req.params.id);
  if (!u) return res.status(404).json({ error: "not found" });
  if (!sharesFamily(req.userId, u.id) && req.userId !== u.id) {
    return res.json({ ok: true, image: "" });
  }
  res.json({ ok: true, image: u.profileImage || "" });
});

app.get("/api/search", auth, (req, res) => {
  const qRaw = String(req.query.q || "").trim();
  const q = qRaw.toLowerCase();
  const qDigits = normalizePhone(qRaw);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit || 50) || 50));
  const offset = Math.max(0, Number(req.query.offset || 0) || 0);
  const users = [];
  const families = [];
  const helpers = {
    sharesFamily: (a, b) => sharesFamily(a, b),
    areFriends: (a, b) => social.areFriends(DB, a, b),
    userPrefs
  };

  DB.users.forEach((u) => {
    if (u.id === req.userId) return;
    if (social.blockedBetween(DB, req.userId, u.id)) return;
    const prefs = userPrefs(u);
    if (prefs.hideBlockedInSearch !== false && social.iBlocked(DB, req.userId, u.id)) return;
    if (q.length < 1) {
      if (prefs.appearInSearch === false && !sharesFamily(req.userId, u.id) && !social.areFriends(DB, req.userId, u.id)) return;
    } else {
      const name = (u.name || "").toLowerCase();
      const email = (u.email || "").toLowerCase();
      const phD = normalizePhone(u.phone);
      let nameHit = name.includes(q);
      let emailHit = email.includes(q);
      let phoneHit = qDigits.length >= 3 && phD.includes(qDigits);
      if (nameHit && !graph.canDiscover(req.userId, u, "name", helpers)) nameHit = false;
      if (emailHit && !graph.canDiscover(req.userId, u, "email", helpers)) emailHit = false;
      if (phoneHit && !graph.canDiscover(req.userId, u, "phone", helpers)) phoneHit = false;
      if (!(nameHit || emailHit || phoneHit)) return;
    }
    const card = publicUser(u, req.userId, { forSearch: true });
    card.relationship = graph.relationshipOf(DB, req.userId, u.id, { sharesFamily });
    users.push(card);
  });
  if (q.length < 1) {
    users.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    if (users.length > 24) users.length = 24;
  }

  DB.families.forEach((f) => {
    const isMember = Array.isArray(f.members) && f.members.includes(req.userId);
    const nameHit = !q || (f.name || "").toLowerCase().includes(q) || (f.id || "").toLowerCase().includes(q);
    if (!nameHit) return;
    if (f.privacy === "public" || isMember) {
      families.push({
        id: f.id,
        name: f.name,
        privacy: f.privacy,
        memberCount: (f.members || []).length,
        isMember,
        createdAt: f.createdAt
      });
    }
  });

  const rooms = [];
  if (q.length >= 1) {
    (DB.rooms || []).forEach((r) => {
      const blob = `${r.name || ""} ${r.topic || ""} ${r.desc || ""}`.toLowerCase();
      if (!blob.includes(q)) return;
      const isMember = Array.isArray(r.members) && r.members.includes(req.userId);
      if (r.privacy === "public" || isMember) {
        rooms.push({
          id: r.id,
          name: r.name,
          topic: r.topic,
          privacy: r.privacy,
          memberCount: (r.members || []).length,
          isMember
        });
      }
    });
  }

  const posts = [];
  if (q.length >= 1) {
    (DB.posts || []).forEach((p) => {
      const blob = String(p.text || "").toLowerCase();
      if (!blob.includes(q)) return;
      if (p.audience === "public" || p.authorId === req.userId || (p.familyId && (DB.families.find((f) => f.id === p.familyId && (f.members || []).includes(req.userId))))) {
        const au = getUser(p.authorId);
        posts.push({ id: p.id, text: p.text, authorName: au ? au.name : "User", audience: p.audience, createdAt: p.createdAt });
      }
    });
  }

  res.json({
    ok: true,
    users: users.slice(offset, offset + limit),
    families: families.slice(0, 50),
    posts: posts.slice(0, 20),
    rooms: rooms.slice(0, 20),
    offset,
    limit
  });
});

app.get("/api/sync", auth, (req, res) => {
  const mine = DB.families.filter((f) => Array.isArray(f.members) && f.members.includes(req.userId));
  const memberIds = memberSetFor(req.userId);
  const users = [];
  memberIds.forEach((id) => {
    const u = getUser(id);
    if (u) users.push(publicUser(u, req.userId, { includeHistory: true, includeProfile: true }));
  });
  const friendCount = (DB.friends || []).filter((f) => f.status === "accepted" && (f.from === req.userId || f.to === req.userId)).length;
  const messages = DB.messages.filter((m) => {
    if (!visibleMessage(m, req.userId)) return false;
    if (m.from === req.userId || m.to === req.userId) return true;
    if (m.familyId) {
      const f = DB.families.find((x) => x.id === m.familyId);
      return !!(f && Array.isArray(f.members) && f.members.includes(req.userId));
    }
    if (m.roomId) {
      const r = (DB.rooms || []).find((x) => x.id === m.roomId);
      return !!(r && Array.isArray(r.members) && r.members.includes(req.userId));
    }
    return false;
  }).slice(-2000);
  const places = DB.places.filter((p) => p.ownerId === req.userId);
  const joinRequests = DB.joinRequests.filter((r) => {
    if (r.userId === req.userId) return true;
    const f = DB.families.find((x) => x.id === r.familyId);
    return f && f.ownerId === req.userId && r.status === "pending";
  });
  const rooms = (DB.rooms || []).filter((r) => Array.isArray(r.members) && r.members.includes(req.userId));
  res.json({
    ok: true,
    user: publicUser(req.user, req.userId, { includeHistory: true, includeProfile: true }),
    users,
    families: mine.map(publicFamily),
    messages,
    places,
    joinRequests,
    rooms,
    friendCount,
    incomingFriends: (DB.friends || []).filter((f) => f.status === "pending" && f.to === req.userId).length
  });
});

app.post("/api/location", auth, (req, res) => {
  const { lat, lng, type, record } = req.body || {};
  const c = coords(lat, lng);
  if (!c) return res.status(400).json({ error: "lat & lng required" });
  const la = c.lat, ln = c.lng;
  const ts = now();
  req.user.lastLocation = { lat: la, lng: ln, ts };
  const kind = String(type || "live");
  const trackingOn = (req.body && req.body.tracking) === false || kind === "preview" || kind === "approx"
    ? false
    : (req.body && req.body.tracking) === true
      ? true
      : (kind !== "preview" && kind !== "approx");
  req.user.tracking = !!trackingOn;
  const force = record === true || kind === "minute" || kind === "trail" || kind === "manual";
  const prefs = userPrefs(req.user);
  let recorded = false;
  if (prefs.recordHistory !== false && force) {
    recorded = appendHistory(req.user, la, ln, ts, kind === "gps" || kind === "live" ? "minute" : kind, true);
  }
  saveData();
  broadcastToFamilyOf(req.userId, {
    type: "location",
    userId: req.userId,
    lat: la,
    lng: ln,
    ts,
    tracking: !!req.user.tracking
  });
  res.json({ ok: true, ts, recorded, tracking: !!req.user.tracking });
});

app.post("/api/me/tracking", auth, (req, res) => {
  const on = !!(req.body && req.body.on);
  req.user.tracking = on;
  saveData();
  broadcastToFamilyOf(req.userId, {
    type: "location",
    userId: req.userId,
    lat: req.user.lastLocation ? req.user.lastLocation.lat : null,
    lng: req.user.lastLocation ? req.user.lastLocation.lng : null,
    ts: now(),
    tracking: on
  });
  res.json({ ok: true, tracking: on });
});

app.delete("/api/me/history", auth, (req, res) => {
  const b = req.body || {};
  const from = Number(b.from || req.query.from || 0);
  const to = Number(b.to || req.query.to || 0);
  const list = req.user.locationHistory || [];
  if (from > 0 || to > 0) {
    req.user.locationHistory = list.filter((h) => {
      const t = h.ts || 0;
      const inFrom = from <= 0 || t >= from;
      const inTo = to <= 0 || t <= to;
      return !(inFrom && inTo);
    });
  } else {
    req.user.locationHistory = [];
  }
  saveData();
  res.json({ ok: true, remaining: (req.user.locationHistory || []).length });
});

app.get("/api/locations", auth, (req, res) => {
  const memberIds = memberSetFor(req.userId);
  const locations = [];
  memberIds.forEach((id) => {
    const u = getUser(id);
    if (!u || !u.lastLocation) return;
    if (id !== req.userId && social.blockedBetween(DB, req.userId, id)) return;
    const prefs = userPrefs(u);
    if (id !== req.userId && prefs.appearOnMap === false) return;
    if (id !== req.userId && !u.tracking) return;
    const loc = u.lastLocation;
    const approx = id !== req.userId && prefs.preciseLocation === false;
    locations.push({
      userId: id,
      name: u.name,
      lat: approx ? fuzzCoord(loc.lat) : loc.lat,
      lng: approx ? fuzzCoord(loc.lng) : loc.lng,
      ts: (id !== req.userId && prefs.showLastSeen === false) ? null : loc.ts,
      approx,
      online: isOnline(id),
      tracking: !!u.tracking,
      live: !!u.tracking
    });
  });
  res.json({ ok: true, locations });
});

app.get("/api/users/:id", auth, (req, res) => {
  const u = getUser(req.params.id);
  if (!u) return res.status(404).json({ error: "not found" });
  const user = publicUser(u, req.userId, { includeHistory: sharesFamily(req.userId, u.id) });
  user.relationship = graph.relationshipOf(DB, req.userId, u.id, { sharesFamily });
  res.json({ ok: true, user, relationship: user.relationship });
});

app.get("/api/users/:id/history", auth, (req, res) => {
  const u = getUser(req.params.id);
  if (!u) return res.status(404).json({ error: "not found" });
  if (!sharesFamily(req.userId, u.id)) {
    return res.status(403).json({ error: "location is only visible to family members" });
  }
  const shared = DB.families.filter((f) => (f.members || []).includes(req.userId) && (f.members || []).includes(u.id));
  const locOk = req.userId === u.id || shared.some((f) => {
    ensureFamilyRoles(f);
    return familyCan(f, req.userId, "viewHistory") && familyCan(f, u.id, "viewLocation");
  });
  if (!locOk) return res.status(403).json({ error: "your role cannot view location history" });
  if (req.userId !== u.id && userPrefs(u).allowHistory === false) {
    return res.status(403).json({ error: "this member does not share location history" });
  }
  const from = Number(req.query.from || 0);
  const to = Number(req.query.to || 0);
  let hist = (u.locationHistory || []).slice();
  if (from > 0) hist = hist.filter((h) => (h.ts || 0) >= from);
  if (to > 0) hist = hist.filter((h) => (h.ts || 0) <= to);
  hist = hist.slice(-HISTORY_CAP);
  if (req.userId !== u.id && userPrefs(u).preciseLocation === false) {
    hist = hist.map((h) => ({ lat: fuzzCoord(h.lat), lng: fuzzCoord(h.lng), ts: h.ts, type: h.type, approx: true }));
  }
  res.json({ ok: true, history: hist, count: hist.length });
});

app.get("/api/families", auth, (req, res) => {
  const mine = DB.families.filter((f) => Array.isArray(f.members) && f.members.includes(req.userId));
  const pub = DB.families.filter((f) => f.privacy === "public" && !(f.members || []).includes(req.userId));
  res.json({
    ok: true,
    families: mine.map(publicFamily),
    public: pub.map((f) => ({
      id: f.id,
      name: f.name,
      privacy: f.privacy,
      memberCount: (f.members || []).length
    }))
  });
});

app.post("/api/families", auth, (req, res) => {
  try {
    const { name, password, privacy } = req.body || {};
    const f = {
      id: makeId("f"),
      name: String(name || "").trim() || ("Family " + randomHex(2)),
      password: password ? hashPassword(password) : "",
      privacy: privacy === "public" ? "public" : "private",
      members: [req.userId],
      invites: [],
      ownerId: req.userId,
      createdAt: now(),
      roles: { [req.userId]: "owner" },
      roleDefs: undefined
    };
    ensureFamilyRoles(f);
    const token = mintInviteToken(f.id, req.userId);
    f.invites.push(token);
    DB.families.push(f);
    saveData();
    sendToUser(req.userId, { type: "family", action: "created", family: publicFamily(f) });
    res.json({ ok: true, family: publicFamily(f), briefing: familyBriefing(f, req.userId) });
  } catch (e) {
    logError("create family failed", { err: String(e && e.message || e) });
    res.status(500).json({ error: "could not create family" });
  }
});

app.post("/api/families/join", auth, (req, res) => {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error: "token required" });
  const found = findInviteFamily(token);
  if (!found) return res.status(400).json({ error: "invalid invite" });
  const f = found.f;
  if (!f.members.includes(req.userId)) f.members.push(req.userId);
  ensureFamilyRoles(f);
  if (!f.roles[req.userId] || f.roles[req.userId] === "guest") f.roles[req.userId] = "member";
  saveData();
  broadcastToFamilyOf(req.userId, { type: "family", action: "joined", familyId: f.id, userId: req.userId });
  res.json({ ok: true, family: publicFamily(f), briefing: familyBriefing(f, req.userId) });
});

app.post("/api/families/:id/join", auth, (req, res) => {
  const f = DB.families.find((x) => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: "family not found" });
  if (f.members.includes(req.userId)) return res.json({ ok: true, family: publicFamily(f), already: true, briefing: familyBriefing(f, req.userId) });
  const { password } = req.body || {};
  if (f.privacy === "public") {
    f.members.push(req.userId);
    ensureFamilyRoles(f);
    f.roles[req.userId] = "member";
    saveData();
    broadcastToFamilyOf(req.userId, { type: "family", action: "joined", familyId: f.id, userId: req.userId });
    return res.json({ ok: true, family: publicFamily(f), briefing: familyBriefing(f, req.userId) });
  }
  if (f.password) {
    const ok = verifyPassword(password || "", f.password);
    if (!ok) return res.status(401).json({ error: "bad family password" });
    f.members.push(req.userId);
    ensureFamilyRoles(f);
    f.roles[req.userId] = "member";
    saveData();
    broadcastToFamilyOf(req.userId, { type: "family", action: "joined", familyId: f.id, userId: req.userId });
    return res.json({ ok: true, family: publicFamily(f), briefing: familyBriefing(f, req.userId) });
  }
  const existing = DB.joinRequests.find((r) => r.familyId === f.id && r.userId === req.userId && r.status === "pending");
  if (existing) return res.json({ ok: true, requested: true, request: existing });
  const r = { id: makeId("jr"), familyId: f.id, userId: req.userId, status: "pending", createdAt: now() };
  DB.joinRequests.push(r);
  saveData();
  if (f.ownerId) sendToUser(f.ownerId, { type: "join_request", request: r, familyId: f.id, userName: req.user.name });
  res.json({ ok: true, requested: true, request: r });
});

app.post("/api/families/:id/leave", auth, (req, res) => {
  const f = DB.families.find((x) => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: "family not found" });
  f.members = (f.members || []).filter((id) => id !== req.userId);
  saveData();
  broadcastToFamilyOf(f.ownerId || (f.members[0] || req.userId), { type: "family", action: "left", familyId: f.id, userId: req.userId });
  sendToUser(req.userId, { type: "family", action: "left", familyId: f.id, userId: req.userId });
  res.json({ ok: true });
});

app.post("/api/families/:id/invite", auth, (req, res) => {
  const f = DB.families.find((x) => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: "family not found" });
  if (!f.members.includes(req.userId)) return res.status(403).json({ error: "not a member" });
  const token = mintInviteToken(f.id, req.userId);
  if (!f.invites) f.invites = [];
  f.invites.push(token);
  saveData();
  const origin = `${req.protocol}://${req.get("host")}`;
  res.json({
    ok: true,
    token,
    url: `${origin}/?invite=${encodeURIComponent(token)}`,
    qrUrl: `${origin}/invite/${token}`
  });
});

function handleInvitePreview(req, res) {
  const token = String((req.body && req.body.token) || req.query.token || "").trim();
  if (!token) return res.status(400).json({ error: "token required" });
  const found = findInviteFamily(token);
  if (!found) return res.status(400).json({ error: "invalid invite" });
  res.json(invitePreviewPayload(found.f, req.userId, found.stored, found.decoded));
}
app.get("/api/invite/preview", auth, handleInvitePreview);
app.post("/api/invite/preview", auth, handleInvitePreview);

app.get("/api/families/:id/requests", auth, (req, res) => {
  const f = DB.families.find((x) => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: "family not found" });
  if (f.ownerId !== req.userId && !f.members.includes(req.userId)) return res.status(403).json({ error: "forbidden" });
  const list = DB.joinRequests.filter((r) => r.familyId === f.id && r.status === "pending").map((r) => {
    const u = getUser(r.userId);
    return { ...r, name: u ? u.name : "User" };
  });
  res.json({ ok: true, requests: list });
});

app.post("/api/families/:id/requests/:rid/accept", auth, (req, res) => {
  const f = DB.families.find((x) => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: "family not found" });
  if (!familyCan(f, req.userId, "manageMembers")) return res.status(403).json({ error: "only Head / Admin can accept" });
  const r = DB.joinRequests.find((x) => x.id === req.params.rid && x.familyId === f.id);
  if (!r) return res.status(404).json({ error: "request not found" });
  r.status = "accepted";
  if (!f.members.includes(r.userId)) f.members.push(r.userId);
  ensureFamilyRoles(f);
  f.roles[r.userId] = "member";
  saveData();
  sendToUser(r.userId, { type: "family", action: "joined", familyId: f.id, userId: r.userId });
  broadcastToFamilyOf(r.userId, { type: "family", action: "joined", familyId: f.id, userId: r.userId });
  res.json({ ok: true, family: publicFamily(f) });
});

app.post("/api/families/:id/requests/:rid/decline", auth, (req, res) => {
  const f = DB.families.find((x) => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: "family not found" });
  if (!familyCan(f, req.userId, "manageMembers")) return res.status(403).json({ error: "only Head / Admin can decline" });
  const r = DB.joinRequests.find((x) => x.id === req.params.rid && x.familyId === f.id);
  if (!r) return res.status(404).json({ error: "request not found" });
  r.status = "declined";
  saveData();
  sendToUser(r.userId, { type: "join_request", action: "declined", familyId: f.id });
  res.json({ ok: true });
});

function isUnreadFor(m, userId) {
  if (!m || m.from === userId) return false;
  if (Array.isArray(m.deletedFor) && m.deletedFor.includes(userId)) return false;
  if (Array.isArray(m.readBy) && m.readBy.includes(userId)) return false;
  if (m.to === userId) return !m.readAt;
  if (m.familyId || m.roomId) return true;
  return false;
}

function messagePreview(m) {
  if (!m) return "";
  if (m.kind === "sos") return String(m.text || "SOS").replace(/\s+/g, " ").trim().slice(0, 80);
  if (m.enc) return "Encrypted message";
  if (m.image && !m.text) return "Sent a photo";
  const t = String(m.text || "").replace(/\s+/g, " ").trim();
  if (t) return t.slice(0, 80);
  if (m.image) return "Sent a photo";
  return "New message";
}

app.get("/api/inbox", auth, (req, res) => {
  const mine = DB.messages.filter((m) => {
    if (!visibleMessage(m, req.userId)) return false;
    if (m.from === req.userId || m.to === req.userId) return true;
    if (m.familyId) {
      const f = DB.families.find((x) => x.id === m.familyId);
      return !!(f && (f.members || []).includes(req.userId));
    }
    if (m.roomId) {
      const r = (DB.rooms || []).find((x) => x.id === m.roomId);
      return !!(r && (r.members || []).includes(req.userId));
    }
    return false;
  });
  const threads = {};
  mine.forEach((m) => {
    if (m.roomId) {
      const key = "room:" + m.roomId;
      if (!threads[key]) threads[key] = { roomId: m.roomId, unread: 0, count: 0, last: null };
      threads[key].count += 1;
      if (isUnreadFor(m, req.userId)) threads[key].unread += 1;
      if (!threads[key].last || threads[key].last.ts < m.ts) threads[key].last = m;
      return;
    }
    if (m.familyId) {
      const key = "fam:" + m.familyId;
      if (!threads[key]) threads[key] = { familyId: m.familyId, unread: 0, count: 0, last: null };
      threads[key].count += 1;
      if (isUnreadFor(m, req.userId)) threads[key].unread += 1;
      if (!threads[key].last || threads[key].last.ts < m.ts) threads[key].last = m;
      return;
    }
    const other = m.from === req.userId ? m.to : m.from;
    if (!other) return;
    if (!threads[other]) threads[other] = { otherId: other, unread: 0, count: 0, last: null };
    threads[other].count += 1;
    if (isUnreadFor(m, req.userId)) threads[other].unread += 1;
    if (!threads[other].last || threads[other].last.ts < m.ts) threads[other].last = m;
  });

  (DB.rooms || []).forEach((r) => {
    if (!(r.members || []).includes(req.userId)) return;
    const key = "room:" + r.id;
    if (!threads[key]) threads[key] = { roomId: r.id, unread: 0, count: 0, last: null };
  });
  myFamiliesForInbox(req.userId).forEach((f) => {
    const key = "fam:" + f.id;
    if (!threads[key]) threads[key] = { familyId: f.id, unread: 0, count: 0, last: null };
  });

  const list = Object.values(threads).sort((a, b) => (b.last?.ts || 0) - (a.last?.ts || 0)).map((t) => {
    const lastFrom = t.last ? getUser(t.last.from) : null;
    const preview = t.last ? messagePreview(t.last) : "No messages yet";
    const lastFromName = t.last && t.last.from === req.userId ? "You" : (lastFrom ? lastFrom.name : "");
    if (t.roomId) {
      const r = (DB.rooms || []).find((x) => x.id === t.roomId);
      return {
        roomId: t.roomId,
        name: r ? r.name : "Group",
        topic: r ? r.topic : "",
        kind: "room",
        unread: t.unread,
        count: t.count,
        lastTs: t.last ? t.last.ts : 0,
        lastPreview: preview,
        lastFromName,
        memberCount: r ? (r.members || []).length : 0
      };
    }
    if (t.familyId) {
      const f = DB.families.find((x) => x.id === t.familyId);
      return {
        familyId: t.familyId,
        name: f ? f.name : "Family",
        kind: "family",
        unread: t.unread,
        count: t.count,
        lastTs: t.last ? t.last.ts : 0,
        lastPreview: preview,
        lastFromName,
        memberCount: f ? (f.members || []).length : 0
      };
    }
    const u = getUser(t.otherId);
    return {
      otherId: t.otherId,
      name: u ? u.name : "User",
      kind: "direct",
      inFamily: sharesFamily(req.userId, t.otherId),
      online: isOnline(t.otherId),
      unread: t.unread,
      count: t.count,
      lastTs: t.last ? t.last.ts : 0,
      lastPreview: preview,
      lastFromName
    };
  });
  const unread = list.reduce((s, t) => s + t.unread, 0);
  res.json({ ok: true, threads: list, unread });
});

function myFamiliesForInbox(userId) {
  return DB.families.filter((f) => Array.isArray(f.members) && f.members.includes(userId));
}

function visibleMessage(m, userId) {
  if (!m) return false;
  if (Array.isArray(m.deletedFor) && m.deletedFor.includes(userId)) return false;
  return true;
}

app.get("/api/messages", auth, (req, res) => {
  const familyId = String(req.query.family || "");
  if (familyId) {
    const f = DB.families.find((x) => x.id === familyId);
    if (!f || !(f.members || []).includes(req.userId)) return res.status(403).json({ error: "not a member" });
    const msgs = DB.messages.filter((m) => m.familyId === familyId && visibleMessage(m, req.userId)).sort((a, b) => a.ts - b.ts);
    return res.json({ ok: true, messages: msgs });
  }
  const roomId = String(req.query.room || "");
  if (roomId) {
    const r = (DB.rooms || []).find((x) => x.id === roomId);
    if (!r || !(r.members || []).includes(req.userId)) return res.status(403).json({ error: "not a member" });
    const msgs = DB.messages.filter((m) => m.roomId === roomId && visibleMessage(m, req.userId)).sort((a, b) => a.ts - b.ts);
    return res.json({ ok: true, messages: msgs });
  }
  const other = String(req.query.with || "");
  if (!other) return res.status(400).json({ error: "with, family, or room required" });
  const msgs = DB.messages
    .filter((m) => visibleMessage(m, req.userId) && !m.familyId && !m.roomId && ((m.from === req.userId && m.to === other) || (m.from === other && m.to === req.userId)))
    .sort((a, b) => a.ts - b.ts);
  res.json({ ok: true, messages: msgs });
});

app.post("/api/messages", auth, (req, res) => {
  const { to, familyId, roomId, enc, text, image, kind } = req.body || {};
  if (roomId) {
    const r = (DB.rooms || []).find((x) => x.id === roomId);
    if (!r) return res.status(404).json({ error: "room not found" });
    if (!(r.members || []).includes(req.userId)) return res.status(403).json({ error: "not a member" });
    const m = {
      id: makeId("m"),
      from: req.userId,
      to: null,
      roomId,
      enc: enc || null,
      text: enc ? undefined : (text || ""),
      image: enc ? undefined : (image || undefined),
      kind: kind || "chat",
      ts: now(),
      readAt: null,
      readBy: [req.userId]
    };
    DB.messages.push(m);
    if (DB.messages.length > 20000) DB.messages = DB.messages.slice(-15000);
    saveData();
    (r.members || []).forEach((id) => sendToUser(id, { type: "message", message: m }));
    const preview = m.enc ? "New encrypted group message" : (m.text || "Sent a photo");
    pushApi.notifyUsers(r.members, {
      title: r.name,
      body: (req.user.name || "Group") + ": " + preview,
      url: "/?room=" + r.id,
      tag: "room-" + r.id,
      kind: "chat"
    }, req.userId);
    return res.json({ ok: true, message: m });
  }
  if (familyId) {
    const f = DB.families.find((x) => x.id === familyId);
    if (!f) return res.status(404).json({ error: "family not found" });
    if (!(f.members || []).includes(req.userId)) return res.status(403).json({ error: "not a member" });
    const m = {
      id: makeId("m"),
      from: req.userId,
      to: null,
      familyId,
      enc: enc || null,
      text: enc ? undefined : (text || ""),
      image: enc ? undefined : (image || undefined),
      kind: kind || "chat",
      ts: now(),
      readAt: null,
      readBy: [req.userId]
    };
    DB.messages.push(m);
    if (DB.messages.length > 20000) DB.messages = DB.messages.slice(-15000);
    saveData();
    (f.members || []).forEach((id) => sendToUser(id, { type: "message", message: m }));
    const preview = m.enc ? "New encrypted family message" : (m.text || "Sent a photo");
    pushApi.notifyUsers(f.members, {
      title: f.name,
      body: (req.user.name || "Family") + ": " + preview,
      url: "/?family=" + f.id,
      tag: "fam-" + f.id,
      kind: "chat"
    }, req.userId);
    return res.json({ ok: true, message: m });
  }
  if (!to) return res.status(400).json({ error: "to or familyId required" });
  const target = getUser(to);
  if (!target) return res.status(404).json({ error: "user not found" });
  if (social.blockedBetween(DB, req.userId, to)) return res.status(403).json({ error: "you cannot message this person" });
  const family = sharesFamily(req.userId, to);
  const friends = social.areFriends(DB, req.userId, to);
  if (isChild(req.user) && !family && !friends) {
    return res.status(403).json({ error: "child accounts can only message family and friends" });
  }
  msgReq.ensure(DB);
  let mr = msgReq.pair(DB, req.userId, to);
  const connected = family || friends || (mr && mr.status === "accepted");
  if (!connected) {
    const gate = social.canDm(DB, req.userId, to, { getUser, sharesFamily, userPrefs });
    if (!gate.ok) return res.status(403).json({ error: gate.error });
    const preview = enc ? "Encrypted message" : String(text || "Sent a photo").slice(0, 80);
    if (mr && mr.status === "pending") {
      mr.preview = preview;
      mr.pending = Array.isArray(mr.pending) ? mr.pending : [];
      mr.pending.push({ enc: enc || null, text: enc ? undefined : (text || ""), image: enc ? undefined : (image || undefined), ts: now() });
      saveData();
      return res.json({ ok: true, requested: true, incoming: mr.to === req.userId, messageRequest: msgReq.serialize(mr, req.userId, getUser, publicUser) });
    }
    mr = {
      id: makeId("mr"),
      from: req.userId,
      to,
      status: "pending",
      preview,
      pending: [{ enc: enc || null, text: enc ? undefined : (text || ""), image: enc ? undefined : (image || undefined), ts: now() }],
      createdAt: now()
    };
    DB.messageRequests.push(mr);
    saveData();
    sendToUser(to, { type: "message_request", from: req.userId, name: req.user.name, id: mr.id });
    createNotification(DB, saveData, {
      id: makeId("nt"),
      recipientId: to,
      type: "message",
      actorId: req.userId,
      entityType: "message_request",
      entityId: mr.id,
      title: "Message request",
      body: (req.user.name || "Someone") + " sent a message request.",
      url: "/?inbox=1",
      createdAt: now()
    });
    return res.json({ ok: true, requested: true, messageRequest: msgReq.serialize(mr, req.userId, getUser, publicUser) });
  }
  const gate = social.canDm(DB, req.userId, to, { getUser, sharesFamily, userPrefs });
  if (!gate.ok) return res.status(403).json({ error: gate.error });
  const m = {
    id: makeId("m"),
    from: req.userId,
    to,
    enc: enc || null,
    text: enc ? undefined : (text || ""),
    image: enc ? undefined : (image || undefined),
    kind: kind || "chat",
    ts: now(),
    readAt: null
  };
  DB.messages.push(m);
  if (DB.messages.length > 20000) DB.messages = DB.messages.slice(-15000);
  saveData();
  sendToUser(to, { type: "message", message: m });
  sendToUser(req.userId, { type: "message", message: m });
  pushApi.notifyUser(to, {
    title: req.user.name || "GPS FAMILIA",
    body: m.enc ? "New encrypted message" : (m.text || "Sent a photo"),
    url: "/?chat=" + req.userId,
    tag: "chat-" + req.userId,
    kind: "chat"
  });
  res.json({ ok: true, message: m });
});

app.post("/api/sos", auth, (req, res) => {
  const loc = req.user.lastLocation || null;
  const mine = DB.families.filter((f) => (f.members || []).includes(req.userId));
  if (!mine.length) return res.status(400).json({ error: "join a family first" });
  const sent = [];
  mine.forEach((f) => {
    const m = {
      id: makeId("m"),
      from: req.userId,
      to: null,
      familyId: f.id,
      text: loc
        ? `🚨 SOS from ${req.user.name || "a family member"} — last pin ${Number(loc.lat).toFixed(5)}, ${Number(loc.lng).toFixed(5)}`
        : `🚨 SOS from ${req.user.name || "a family member"} — no GPS yet. Open the app.`,
      kind: "sos",
      ts: now(),
      readAt: null,
      lat: loc ? loc.lat : undefined,
      lng: loc ? loc.lng : undefined
    };
    DB.messages.push(m);
    sent.push(m);
    (f.members || []).forEach((id) => sendToUser(id, { type: "sos", message: m, userId: req.userId, lat: m.lat, lng: m.lng }));
  });
  saveData();
  res.json({ ok: true, families: mine.length, messages: sent.length });
});


app.post("/api/messages/read", auth, (req, res) => {
  const { with: other, familyId, roomId } = req.body || {};
  const ts = now();
  if (roomId) {
    const r = (DB.rooms || []).find((x) => x.id === roomId);
    if (!r || !(r.members || []).includes(req.userId)) return res.status(403).json({ error: "not a member" });
    DB.messages.forEach((m) => {
      if (m.roomId !== roomId) return;
      if (m.from === req.userId) return;
      m.readBy = Array.isArray(m.readBy) ? m.readBy : [];
      if (!m.readBy.includes(req.userId)) m.readBy.push(req.userId);
    });
    saveData();
    return res.json({ ok: true });
  }
  if (familyId) {
    const f = DB.families.find((x) => x.id === familyId);
    if (!f || !(f.members || []).includes(req.userId)) return res.status(403).json({ error: "not a member" });
    DB.messages.forEach((m) => {
      if (m.familyId !== familyId) return;
      if (m.from === req.userId) return;
      m.readBy = Array.isArray(m.readBy) ? m.readBy : [];
      if (!m.readBy.includes(req.userId)) m.readBy.push(req.userId);
      if (!m.readAt) m.readAt = ts;
    });
    saveData();
    return res.json({ ok: true });
  }
  if (!other) return res.status(400).json({ error: "with, familyId, or roomId required" });
  DB.messages.forEach((m) => {
    if (m.to === req.userId && m.from === other && !m.familyId && !m.roomId && !m.readAt) m.readAt = ts;
    if (m.to === req.userId && m.from === other) {
      m.readBy = Array.isArray(m.readBy) ? m.readBy : [];
      if (!m.readBy.includes(req.userId)) m.readBy.push(req.userId);
    }
  });
  saveData();
  sendToUser(other, { type: "read", from: req.userId, ts });
  res.json({ ok: true });
});

app.delete("/api/messages/:id", auth, (req, res) => {
  const m = DB.messages.find((x) => x.id === req.params.id);
  if (!m) return res.status(404).json({ error: "not found" });
  const inThread = m.from === req.userId || m.to === req.userId;
  let inFam = false;
  let inRoom = false;
  if (m.familyId) {
    const f = DB.families.find((x) => x.id === m.familyId);
    inFam = !!(f && (f.members || []).includes(req.userId));
  }
  if (m.roomId) {
    const r = (DB.rooms || []).find((x) => x.id === m.roomId);
    inRoom = !!(r && (r.members || []).includes(req.userId));
  }
  if (!inThread && !inFam && !inRoom) return res.status(403).json({ error: "forbidden" });
  if (m.from === req.userId) {
    DB.messages = DB.messages.filter((x) => x.id !== m.id);
    const payload = { type: "message_deleted", id: m.id, familyId: m.familyId || null, roomId: m.roomId || null, from: m.from, to: m.to };
    if (m.familyId) {
      const f = DB.families.find((x) => x.id === m.familyId);
      (f && f.members || []).forEach((id) => sendToUser(id, payload));
    } else if (m.roomId) {
      const r = (DB.rooms || []).find((x) => x.id === m.roomId);
      (r && r.members || []).forEach((id) => sendToUser(id, payload));
    } else {
      sendToUser(m.from, payload);
      if (m.to) sendToUser(m.to, payload);
    }
  } else {
    m.deletedFor = Array.isArray(m.deletedFor) ? m.deletedFor : [];
    if (!m.deletedFor.includes(req.userId)) m.deletedFor.push(req.userId);
    sendToUser(req.userId, { type: "message_deleted", id: m.id, familyId: m.familyId || null, roomId: m.roomId || null, from: m.from, to: m.to });
  }
  saveData();
  res.json({ ok: true });
});

app.get("/api/places", auth, (req, res) => {
  res.json({ ok: true, places: DB.places.filter((p) => p.ownerId === req.userId) });
});

app.post("/api/places", auth, (req, res) => {
  const { name, desc, lat, lng } = req.body || {};
  const c = coords(lat, lng);
  if (!c) return res.status(400).json({ error: "lat & lng required" });
  const la = c.lat, ln = c.lng;
  const p = {
    id: makeId("p"),
    ownerId: req.userId,
    name: String(name || "Place").trim(),
    desc: String(desc || ""),
    lat: la,
    lng: ln,
    createdAt: now()
  };
  DB.places.push(p);
  saveData();
  res.json({ ok: true, place: p });
});

app.delete("/api/places/:id", auth, (req, res) => {
  const i = DB.places.findIndex((p) => p.id === req.params.id && p.ownerId === req.userId);
  if (i < 0) return res.status(404).json({ error: "not found" });
  DB.places.splice(i, 1);
  saveData();
  res.json({ ok: true });
});

function onlineUserIds() {
  return Array.from(socketsByUser.keys());
}

attachCommunity({
  app, DB, saveData, auth, makeId, now, getUser, publicUser, publicFamily,
  sharesFamily, hashPassword, createSession, sendToUser, broadcastToFamilyOf, DEMO,
  DEMO_PASSWORD, onlineUserIds, userPrefs
});

attachRooms({
  app, DB, saveData, auth, makeId, now, getUser, sendToUser, DEMO
});

social.attach({
  app, DB, saveData, auth, makeId, now, getUser, publicUser,
  sharesFamily, sendToUser, userPrefs, DEMO
});

attachMarket({
  app, DB, saveData, auth, makeId, now, getUser, sendToUser, onlineUserIds, DEMO,
  sharesFamily, userPrefs
});

attachPay({
  app, DB, saveData, auth, makeId, now, DEMO, sendToUser, getUser
});

const { attach: attachNotify } = require("./notify-server");
attachNotify({ app, DB, saveData, auth, makeId, now, sendToUser });

app.get("/api/message-requests", auth, (req, res) => {
  msgReq.ensure(DB);
  const mine = DB.messageRequests.filter((x) => x.from === req.userId || x.to === req.userId);
  res.json({
    ok: true,
    incoming: mine.filter((x) => x.status === "pending" && x.to === req.userId).map((x) => msgReq.serialize(x, req.userId, getUser, publicUser)),
    outgoing: mine.filter((x) => x.status === "pending" && x.from === req.userId).map((x) => msgReq.serialize(x, req.userId, getUser, publicUser)),
    accepted: mine.filter((x) => x.status === "accepted").map((x) => msgReq.serialize(x, req.userId, getUser, publicUser))
  });
});

app.post("/api/message-requests/:id/accept", auth, (req, res) => {
  msgReq.ensure(DB);
  const row = DB.messageRequests.find((x) => x.id === req.params.id);
  if (!row) return res.status(404).json({ error: "request not found" });
  if (row.status === "accepted" && (row.to === req.userId || row.from === req.userId)) {
    return res.json({ ok: true, already: true, messageRequest: msgReq.serialize(row, req.userId, getUser, publicUser) });
  }
  if (row.status !== "pending") return res.status(404).json({ error: "request not found" });
  if (row.to !== req.userId) return res.status(403).json({ error: "this request is not for you" });
  row.status = "accepted";
  row.resolvedAt = now();
  (row.pending || []).forEach((p) => {
    const m = {
      id: makeId("m"),
      from: row.from,
      to: row.to,
      enc: p.enc || null,
      text: p.enc ? undefined : (p.text || ""),
      image: p.enc ? undefined : (p.image || undefined),
      kind: "chat",
      ts: p.ts || now(),
      readAt: null
    };
    DB.messages.push(m);
    sendToUser(row.from, { type: "message", message: m });
    sendToUser(row.to, { type: "message", message: m });
  });
  row.pending = [];
  saveData();
  sendToUser(row.from, { type: "message_request", action: "accepted", from: req.userId, id: row.id });
  res.json({ ok: true, messageRequest: msgReq.serialize(row, req.userId, getUser, publicUser) });
});

app.post("/api/message-requests/:id/decline", auth, (req, res) => {
  msgReq.ensure(DB);
  const row = DB.messageRequests.find((x) => x.id === req.params.id);
  if (!row || row.status !== "pending") return res.status(404).json({ error: "request not found" });
  if (row.to !== req.userId && row.from !== req.userId) return res.status(403).json({ error: "forbidden" });
  row.status = "declined";
  row.resolvedAt = now();
  row.pending = [];
  saveData();
  const other = row.from === req.userId ? row.to : row.from;
  sendToUser(other, { type: "message_request", action: "declined", from: req.userId, id: row.id });
  res.json({ ok: true });
});

const { attach: attachQr } = require("./qr-server");
attachQr({
  app, DB, saveData, auth, optionalAuth, makeId, now, getUser, publicUser,
  sharesFamily, userPrefs, findInviteFamily, invitePreviewPayload
});

app.get(["/invite/:token", "/join/:token"], (req, res) => {
  const token = String(req.params.token || "").trim();
  if (!token) return res.redirect(302, "/");
  res.redirect(302, "/?invite=" + encodeURIComponent(token));
});

const { attachPush } = require("./push");
const pushApi = attachPush({ app, DB, saveData, auth });

const callsApi = attachCalls({
  app, DB, saveData, auth, makeId, now, getUser, sendToUser, DEMO,
  notifyUser: pushApi.notifyUser
});

app.use(express.static(__dirname, {
  index: "index.html",
  extensions: ["html"],
  setHeaders(res, filePath) {
    const f = String(filePath || "").replace(/\\/g, "/");
    if (f.endsWith(".html") || f.endsWith("/sw.js") || f.endsWith("/manifest.json")) {
      res.setHeader("Cache-Control", "no-cache");
    } else if (/\/avatars\//.test(f) || /\.(png|jpe?g|webp|gif|svg|ico)$/i.test(f)) {
      res.setHeader("Cache-Control", "public, max-age=86400, immutable");
    } else if (/\.(js|css)$/i.test(f)) {
      res.setHeader("Cache-Control", "no-cache");
    }
  }
}));

app.use(unhandled);

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

function tokenFromReq(req) {
  try {
    const u = new URL(req.url, "http://localhost");
    return u.searchParams.get("token") || "";
  } catch (e) {
    return "";
  }
}

wss.on("connection", (ws, req) => {
  const token = tokenFromReq(req);
  const sess = token && DB.sessions[token];
  if (!sess || sess.exp < now() || !getUser(sess.userId)) {
    ws.close(4401, "unauthorized");
    return;
  }
  attachSocket(sess.userId, ws);
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });
  sendToUser(sess.userId, { type: "hello", userId: sess.userId, ts: now() });
  broadcastToFamilyOf(sess.userId, { type: "presence", userId: sess.userId, online: true }, sess.userId);

  ws.on("message", (buf) => {
    let msg;
    try { msg = JSON.parse(String(buf)); } catch (e) { return; }
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "ping") {
      ws.send(JSON.stringify({ type: "pong", ts: now() }));
      return;
    }
    if (msg.type === "location") {
      const la = Number(msg.lat), ln = Number(msg.lng);
      if (!Number.isFinite(la) || !Number.isFinite(ln)) return;
      const u = getUser(sess.userId);
      if (!u) return;
      const ts = now();
      u.lastLocation = { lat: la, lng: ln, ts };
      const kind = String(msg.kind || "gps");
      const force = msg.record === true || kind === "minute" || kind === "trail";
      if (userPrefs(u).recordHistory !== false) {
        appendHistory(u, la, ln, ts, force ? (kind === "gps" ? "minute" : kind) : kind, force);
      }
      saveData();
      broadcastToFamilyOf(sess.userId, { type: "location", userId: sess.userId, lat: la, lng: ln, ts });
      return;
    }
    if (msg.type === "typing") {
      if (msg.familyId) {
        const f = DB.families.find((x) => x.id === msg.familyId);
        if (f && (f.members || []).includes(sess.userId)) {
          (f.members || []).forEach((id) => {
            if (id !== sess.userId) sendToUser(id, { type: "typing", from: sess.userId, familyId: f.id, ts: now() });
          });
        }
        return;
      }
      if (msg.roomId) {
        const r = (DB.rooms || []).find((x) => x.id === msg.roomId);
        if (r && (r.members || []).includes(sess.userId)) {
          (r.members || []).forEach((id) => {
            if (id !== sess.userId) sendToUser(id, { type: "typing", from: sess.userId, roomId: r.id, ts: now() });
          });
        }
        return;
      }
      const to = msg.to;
      if (to) sendToUser(to, { type: "typing", from: sess.userId, ts: now() });
      return;
    }
    if (msg.type === "call") {
      callsApi.handleCallWs(sess, ws, msg);
      return;
    }
  });

  ws.on("close", () => {
    detachSocket(ws);
    if (!isOnline(sess.userId)) {
      broadcastToFamilyOf(sess.userId, { type: "presence", userId: sess.userId, online: false }, sess.userId);
    }
  });
});

const beat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    try { ws.ping(); } catch (e) {}
  });
}, 25000);
wss.on("close", () => clearInterval(beat));

server.listen(PORT, HOST, () => {
  logInfo("listen", { version: VERSION, port: PORT });
  console.log(`GPS-FAMILIA v${VERSION} ready at http://127.0.0.1:${PORT}/`);
  console.log(`Realtime WebSocket: ws://127.0.0.1:${PORT}/ws`);
  if (OTP_ECHO) console.log("OTP_ECHO is on — verification codes print here and are returned by the API for local use.");
});
