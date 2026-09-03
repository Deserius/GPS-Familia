"use strict";

const express = require("express");
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cors = require("cors");
const nodemailer = require("nodemailer");
const { WebSocketServer } = require("ws");

loadDotEnv(path.join(__dirname, ".env"));

const DATA_FILE = path.join(__dirname, "f360_data.json");
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const OTP_ECHO = String(process.env.OTP_ECHO || "true").toLowerCase() !== "false";
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const VERSION = "2.4.0";
const DEMO = String(process.env.DEMO_MODE || "true").toLowerCase() !== "false";
const { attach: attachCommunity, ensureFamilyRoles, can: familyCan, roleOf } = require("./community-server");

function loadDotEnv(file) {
  try {
    if (!fs.existsSync(file)) return;
    fs.readFileSync(file, "utf8").split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const eq = trimmed.indexOf("=");
      if (eq < 1) return;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    });
  } catch (e) {
    console.warn("Could not load .env", e && e.message);
  }
}

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
  return d;
}

function googleClientId() {
  return String(process.env.GOOGLE_CLIENT_ID || (DB.settings && DB.settings.googleClientId) || "").trim();
}

let DB = normalizeDb(loadData());
saveData();

function saveData() {
  try {
    const tmp = DATA_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(DB, null, 2));
    fs.renameSync(tmp, DATA_FILE);
  } catch (e) {
    try { fs.writeFileSync(DATA_FILE, JSON.stringify(DB, null, 2)); } catch (e2) {
      console.error("Failed to persist database", e2 && e2.message);
    }
  }
}

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.example.com",
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
});

function makeId(prefix = "id") {
  return prefix + "_" + crypto.randomBytes(6).toString("hex");
}
function now() { return Date.now(); }
function digits(s) { return String(s || "").replace(/\D/g, ""); }

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(pw), salt, 32).toString("hex");
  return `scrypt$${salt}$${hash}`;
}
function verifyPassword(pw, stored) {
  if (!stored) return !pw;
  if (String(stored).startsWith("scrypt$")) {
    const parts = String(stored).split("$");
    const salt = parts[1];
    const hash = parts[2];
    const h = crypto.scryptSync(String(pw), salt, 32).toString("hex");
    if (h.length !== hash.length) return false;
    try {
      return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(h, "hex"));
    } catch (e) {
      return false;
    }
  }
  return stored === pw;
}

function createSession(userId) {
  const token = crypto.randomBytes(24).toString("hex");
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

function maskPhone(p) {
  const d = digits(p);
  if (!d) return "";
  if (d.length < 4) return "••••";
  return "•••-•••-" + d.slice(-4);
}
function maskEmail(e) {
  const s = String(e || "");
  const at = s.indexOf("@");
  if (at < 1) return s ? "•••" : "";
  return s[0] + "•••" + s.slice(at);
}

function defaultPrefs() {
  return {
    appearOnMap: true,
    preciseLocation: true,
    showLastSeen: true,
    shareEmailWithFamily: true,
    sharePhoneWithFamily: true,
    allowHistory: true,
    recordHistory: true
  };
}
function userPrefs(u) {
  return Object.assign({}, defaultPrefs(), (u && u.prefs && typeof u.prefs === "object") ? u.prefs : {});
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
  const prefs = userPrefs(u);
  let showLoc = !!(self || family);
  if (showLoc && viewerId && viewerId !== u.id) {
    const shared = DB.families.filter((f) => (f.members || []).includes(viewerId) && (f.members || []).includes(u.id));
    showLoc = shared.some((f) => {
      ensureFamilyRoles(f);
      return familyCan(f, viewerId, "viewLocation") && familyCan(f, u.id, "viewLocation");
    });
    if (prefs.appearOnMap === false) showLoc = false;
  }
  const out = {
    id: u.id,
    name: u.name || "",
    createdAt: u.createdAt,
    inFamily: !!family,
    online: isOnline(u.id),
    hasProfile: !!(u.profileImage),
    appearOnMap: prefs.appearOnMap !== false
  };
  if (self) out.prefs = prefs;
  if (self || family || opts.forSearch) {
    const hideContact = opts.forSearch && !self && !family;
    if (hideContact) {
      out.phone = maskPhone(u.phone);
      out.email = maskEmail(u.email);
    } else {
      out.phone = (self || prefs.sharePhoneWithFamily) ? (u.phone || "") : maskPhone(u.phone);
      out.email = (self || prefs.shareEmailWithFamily) ? (u.email || "") : maskEmail(u.email);
    }
  }
  if (showLoc && !opts.forSearch && u.lastLocation) {
    const loc = u.lastLocation;
    if (prefs.preciseLocation === false && !self) {
      out.lastLocation = {
        lat: fuzzCoord(loc.lat),
        lng: fuzzCoord(loc.lng),
        ts: prefs.showLastSeen === false && !self ? null : loc.ts,
        approx: true
      };
    } else {
      out.lastLocation = {
        lat: loc.lat,
        lng: loc.lng,
        ts: prefs.showLastSeen === false && !self ? null : loc.ts,
        approx: false
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
  if ((self || family) && u.profileImage && opts.includeProfile) {
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

async function sendMail(to, subject, text) {
  if (!to || !process.env.SMTP_USER) return false;
  try {
    await transporter.sendMail({
      from: process.env.FROM_EMAIL || process.env.SMTP_USER || "no-reply@gps-familia.local",
      to,
      subject,
      text
    });
    return true;
  } catch (err) {
    console.warn("Email send failed:", err && err.message);
    return false;
  }
}

async function sendSms(to, text) {
  const sid = process.env.TWILIO_SID;
  const token = process.env.TWILIO_TOKEN;
  const from = process.env.TWILIO_FROM;
  if (!sid || !token || !from || !to) return false;
  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
    const body = new URLSearchParams({ To: to, From: from, Body: text });
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    });
    if (!res.ok) {
      const t = await res.text();
      console.warn("Twilio failed", res.status, t.slice(0, 200));
      return false;
    }
    return true;
  } catch (e) {
    console.warn("Twilio error", e && e.message);
    return false;
  }
}

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "8mb" }));

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  next();
});

app.use((req, res, next) => {
  const p = (req.path || "").toLowerCase();
  if (
    p.includes("f360_data") ||
    p === "/.env" ||
    p.startsWith("/node_modules") ||
    p.endsWith(".tmp")
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
  else if (req.query && req.query.token) token = String(req.query.token);
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
  res.json({ ok: true, ts: now(), version: VERSION, realtime: true });
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
    demoPassword: DEMO ? "demo123" : undefined,
    demoOtp: DEMO ? "000000" : undefined,
    vapidPublic: (DB.settings && DB.settings.vapidPublic) || "",
    push: !!(DB.settings && DB.settings.vapidPublic)
  });
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
  const aud = googleClientId();
  if (!aud) throw new Error("Google Sign-In is not configured. Add a Client ID in Help → Google.");
  const url = "https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(credential);
  const res = await fetch(url);
  const p = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(p.error_description || p.error || "invalid google token");
  if (p.aud !== aud) throw new Error("Google client id mismatch. Check Authorized JavaScript origins.");
  if (p.iss !== "accounts.google.com" && p.iss !== "https://accounts.google.com") throw new Error("bad token issuer");
  if (Number(p.exp) * 1000 < Date.now()) throw new Error("google token expired");
  if (p.email_verified !== "true" && p.email_verified !== true) throw new Error("google email not verified");
  if (!p.email) throw new Error("google account has no email");
  return p;
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
  let u = DB.users.find((x) => x.googleSub === profile.sub || (x.email && x.email.toLowerCase() === em));
  if (!u) {
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
  res.json({ ok: true, sessionToken, user: publicUser(u, u.id, { includeProfile: true, includeHistory: true }) });
});


app.post("/api/send-otp", async (req, res) => {
  const { phone, email } = req.body || {};
  if (!phone) return res.status(400).json({ error: "phone required" });
  const code = DEMO ? "000000" : String(Math.floor(Math.random() * 900000) + 100000);
  const exp = now() + 3 * 60 * 1000;
  const token = crypto.randomBytes(16).toString("hex");
  DB.otps[phone] = { code, exp, token };
  saveData();
  const text = `Your GPS-FAMILIA code is ${code}. It expires in 3 minutes.`;
  let emailed = false, sms = false;
  if (email) emailed = await sendMail(email, "Your GPS-FAMILIA OTP", text);
  sms = await sendSms(phone, text);
  console.log(`[OTP] ${phone} -> ${code}${emailed ? " (email)" : ""}${sms ? " (sms)" : ""}`);
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
  let user = DB.users.find((u) => u.phone === phone);
  if (!user) {
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
  if (!em || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return res.status(400).json({ error: "valid email required" });
  if (!password || String(password).length < 6) return res.status(400).json({ error: "password must be at least 6 characters" });

  if (DB.users.find((u) => u.email && u.email.toLowerCase() === em.toLowerCase())) {
    return res.status(409).json({ error: "email used" });
  }
  if (DB.users.find((u) => u.name && u.name.toLowerCase() === nameTxt.toLowerCase())) {
    return res.status(409).json({ error: "username taken" });
  }
  if (phoneTxt && DB.users.find((u) => u.phone && (u.phone === phoneTxt || digits(u.phone) === digits(phoneTxt)))) {
    return res.status(409).json({ error: "phone used" });
  }

  const u = {
    id: makeId("u"),
    name: nameTxt,
    email: em,
    phone: phoneTxt,
    password: hashPassword(password),
    createdAt: now(),
    locationHistory: []
  };
  DB.users.push(u);
  const sessionToken = createSession(u.id);
  saveData();
  sendMail(em, "Welcome to GPS-FAMILIA", `Hi ${nameTxt},\n\nWelcome to GPS-FAMILIA. Your account is ready.\n\n- The GPS-FAMILIA Team`);
  res.json({ ok: true, sessionToken, user: publicUser(u, u.id, { includeProfile: true }) });
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
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return res.status(400).json({ error: "valid email required" });
    const clash = DB.users.find((x) => x.id !== req.userId && x.email && x.email.toLowerCase() === em.toLowerCase());
    if (clash) return res.status(409).json({ error: "email used" });
    req.user.email = em;
  }
  if (phone !== undefined) req.user.phone = String(phone).trim();
  if (prefs && typeof prefs === "object") {
    const cur = userPrefs(req.user);
    const next = Object.assign({}, cur);
    ["appearOnMap", "preciseLocation", "showLastSeen", "shareEmailWithFamily", "sharePhoneWithFamily", "allowHistory", "recordHistory"].forEach((k) => {
      if (typeof prefs[k] === "boolean") next[k] = prefs[k];
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
  if (nextPw.length < 6) return res.status(400).json({ error: "password must be at least 6 characters" });
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
  DB.users = DB.users.filter((u) => u.id !== uid);
  saveData();
  res.json({ ok: true });
});

app.post("/api/me/profile", auth, (req, res) => {
  const { image } = req.body || {};
  if (!image || typeof image !== "string" || !image.startsWith("data:image/")) {
    return res.status(400).json({ error: "image data URL required" });
  }
  if (image.length > 7_000_000) return res.status(413).json({ error: "image too large" });
  req.user.profileImage = image;
  saveData();
  broadcastToFamilyOf(req.userId, { type: "profile", userId: req.userId });
  res.json({ ok: true });
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
  const q = String(req.query.q || "").trim().toLowerCase();
  const qDigits = digits(q);
  const users = [];
  const families = [];

  if (q.length >= 1) {
    DB.users.forEach((u) => {
      if (u.id === req.userId) return;
      const name = (u.name || "").toLowerCase();
      const email = (u.email || "").toLowerCase();
      const phone = (u.phone || "").toLowerCase();
      const phD = digits(u.phone);
      const hit =
        (q && (name.includes(q) || email.includes(q) || phone.includes(q))) ||
        (qDigits.length >= 3 && phD.includes(qDigits));
      if (hit) users.push(publicUser(u, req.userId, { forSearch: true }));
    });
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
    users: users.slice(0, 50),
    families: families.slice(0, 50),
    posts: posts.slice(0, 20)
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
  const messages = DB.messages.filter((m) => {
    if (!visibleMessage(m, req.userId)) return false;
    if (m.from === req.userId || m.to === req.userId) return true;
    if (m.familyId) {
      const f = DB.families.find((x) => x.id === m.familyId);
      return !!(f && Array.isArray(f.members) && f.members.includes(req.userId));
    }
    return false;
  }).slice(-2000);
  const places = DB.places.filter((p) => p.ownerId === req.userId);
  const joinRequests = DB.joinRequests.filter((r) => {
    if (r.userId === req.userId) return true;
    const f = DB.families.find((x) => x.id === r.familyId);
    return f && f.ownerId === req.userId && r.status === "pending";
  });
  res.json({
    ok: true,
    user: publicUser(req.user, req.userId, { includeHistory: true, includeProfile: true }),
    users,
    families: mine,
    messages,
    places,
    joinRequests
  });
});

app.post("/api/location", auth, (req, res) => {
  const { lat, lng, type, record } = req.body || {};
  const la = Number(lat), ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return res.status(400).json({ error: "lat & lng required" });
  const ts = now();
  req.user.lastLocation = { lat: la, lng: ln, ts };
  const kind = String(type || "live");
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
    ts
  });
  res.json({ ok: true, ts, recorded });
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
    const prefs = userPrefs(u);
    if (id !== req.userId && prefs.appearOnMap === false) return;
    const loc = u.lastLocation;
    const approx = id !== req.userId && prefs.preciseLocation === false;
    locations.push({
      userId: id,
      name: u.name,
      lat: approx ? fuzzCoord(loc.lat) : loc.lat,
      lng: approx ? fuzzCoord(loc.lng) : loc.lng,
      ts: (id !== req.userId && prefs.showLastSeen === false) ? null : loc.ts,
      approx,
      online: isOnline(id)
    });
  });
  res.json({ ok: true, locations });
});

app.get("/api/users/:id", auth, (req, res) => {
  const u = getUser(req.params.id);
  if (!u) return res.status(404).json({ error: "not found" });
  res.json({ ok: true, user: publicUser(u, req.userId, { includeHistory: sharesFamily(req.userId, u.id) }) });
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
    families: mine,
    public: pub.map((f) => ({
      id: f.id,
      name: f.name,
      privacy: f.privacy,
      memberCount: (f.members || []).length
    }))
  });
});

app.post("/api/families", auth, (req, res) => {
  const { name, password, privacy } = req.body || {};
  const f = {
    id: makeId("f"),
    name: String(name || "").trim() || ("Family " + crypto.randomBytes(2).toString("hex")),
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
  const token = Buffer.from(JSON.stringify({ fid: f.id, ts: now() })).toString("base64");
  f.invites.push(token);
  DB.families.push(f);
  saveData();
  sendToUser(req.userId, { type: "family", action: "created", family: f });
  res.json({ ok: true, family: f });
});

app.post("/api/families/join", auth, (req, res) => {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error: "token required" });
  try {
    const decoded = JSON.parse(Buffer.from(String(token), "base64").toString("utf8"));
    const f = DB.families.find((x) => x.id === decoded.fid);
    if (!f) return res.status(400).json({ error: "family not found" });
    if (!f.invites || !f.invites.includes(token)) return res.status(400).json({ error: "invalid invite" });
    if (!f.members.includes(req.userId)) f.members.push(req.userId);
    ensureFamilyRoles(f);
    if (!f.roles[req.userId] || f.roles[req.userId] === "guest") f.roles[req.userId] = "member";
    saveData();
    broadcastToFamilyOf(req.userId, { type: "family", action: "joined", familyId: f.id, userId: req.userId });
    res.json({ ok: true, family: f });
  } catch (e) {
    return res.status(400).json({ error: "bad token" });
  }
});

app.post("/api/families/:id/join", auth, (req, res) => {
  const f = DB.families.find((x) => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: "family not found" });
  if (f.members.includes(req.userId)) return res.json({ ok: true, family: f, already: true });
  const { password } = req.body || {};
  if (f.privacy === "public") {
    f.members.push(req.userId);
    ensureFamilyRoles(f);
    f.roles[req.userId] = "member";
    saveData();
    broadcastToFamilyOf(req.userId, { type: "family", action: "joined", familyId: f.id, userId: req.userId });
    return res.json({ ok: true, family: f });
  }
  if (f.password) {
    const ok = verifyPassword(password || "", f.password);
    if (!ok) return res.status(401).json({ error: "bad family password" });
    f.members.push(req.userId);
    ensureFamilyRoles(f);
    f.roles[req.userId] = "member";
    saveData();
    broadcastToFamilyOf(req.userId, { type: "family", action: "joined", familyId: f.id, userId: req.userId });
    return res.json({ ok: true, family: f });
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
  const token = Buffer.from(JSON.stringify({ fid: f.id, ts: now() })).toString("base64");
  if (!f.invites) f.invites = [];
  f.invites.push(token);
  saveData();
  const origin = `${req.protocol}://${req.get("host")}`;
  res.json({ ok: true, token, url: `${origin}/?invite=${encodeURIComponent(token)}` });
});

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
  res.json({ ok: true, family: f });
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

app.get("/api/inbox", auth, (req, res) => {
  const mine = DB.messages.filter((m) => {
    if (!visibleMessage(m, req.userId)) return false;
    if (m.from === req.userId || m.to === req.userId) return true;
    if (m.familyId) {
      const f = DB.families.find((x) => x.id === m.familyId);
      return !!(f && (f.members || []).includes(req.userId));
    }
    return false;
  });
  const threads = {};
  mine.forEach((m) => {
    if (m.familyId) {
      const key = "fam:" + m.familyId;
      if (!threads[key]) threads[key] = { familyId: m.familyId, unread: 0, count: 0, last: null };
      threads[key].count += 1;
      if (m.from !== req.userId && !m.readAt) threads[key].unread += 1;
      if (!threads[key].last || threads[key].last.ts < m.ts) threads[key].last = m;
      return;
    }
    const other = m.from === req.userId ? m.to : m.from;
    if (!other) return;
    if (!threads[other]) threads[other] = { otherId: other, unread: 0, count: 0, last: null };
    threads[other].count += 1;
    if (m.to === req.userId && !m.readAt) threads[other].unread += 1;
    if (!threads[other].last || threads[other].last.ts < m.ts) threads[other].last = m;
  });
  const list = Object.values(threads).sort((a, b) => (b.last?.ts || 0) - (a.last?.ts || 0)).map((t) => {
    if (t.familyId) {
      const f = DB.families.find((x) => x.id === t.familyId);
      return {
        familyId: t.familyId,
        name: f ? f.name : "Family",
        kind: "family",
        unread: t.unread,
        count: t.count,
        lastTs: t.last ? t.last.ts : 0
      };
    }
    const u = getUser(t.otherId);
    return {
      otherId: t.otherId,
      name: u ? u.name : "User",
      kind: "direct",
      inFamily: sharesFamily(req.userId, t.otherId),
      unread: t.unread,
      count: t.count,
      lastTs: t.last ? t.last.ts : 0
    };
  });
  const unread = list.reduce((s, t) => s + t.unread, 0);
  res.json({ ok: true, threads: list, unread });
});

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
  const other = String(req.query.with || "");
  if (!other) return res.status(400).json({ error: "with or family required" });
  const msgs = DB.messages
    .filter((m) => visibleMessage(m, req.userId) && ((m.from === req.userId && m.to === other) || (m.from === other && m.to === req.userId)))
    .sort((a, b) => a.ts - b.ts);
  res.json({ ok: true, messages: msgs });
});

app.post("/api/messages", auth, (req, res) => {
  const { to, familyId, enc, text, image, kind } = req.body || {};
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
      readAt: null
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
  const { with: other } = req.body || {};
  if (!other) return res.status(400).json({ error: "with required" });
  const ts = now();
  DB.messages.forEach((m) => {
    if (m.to === req.userId && m.from === other && !m.readAt) m.readAt = ts;
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
  if (m.familyId) {
    const f = DB.families.find((x) => x.id === m.familyId);
    inFam = !!(f && (f.members || []).includes(req.userId));
  }
  if (!inThread && !inFam) return res.status(403).json({ error: "forbidden" });
  if (m.from === req.userId) {
    DB.messages = DB.messages.filter((x) => x.id !== m.id);
    const payload = { type: "message_deleted", id: m.id, familyId: m.familyId || null, from: m.from, to: m.to };
    if (m.familyId) {
      const f = DB.families.find((x) => x.id === m.familyId);
      (f && f.members || []).forEach((id) => sendToUser(id, payload));
    } else {
      sendToUser(m.from, payload);
      if (m.to) sendToUser(m.to, payload);
    }
  } else {
    m.deletedFor = Array.isArray(m.deletedFor) ? m.deletedFor : [];
    if (!m.deletedFor.includes(req.userId)) m.deletedFor.push(req.userId);
  }
  saveData();
  res.json({ ok: true });
});

app.get("/api/places", auth, (req, res) => {
  res.json({ ok: true, places: DB.places.filter((p) => p.ownerId === req.userId) });
});

app.post("/api/places", auth, (req, res) => {
  const { name, desc, lat, lng } = req.body || {};
  const la = Number(lat), ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return res.status(400).json({ error: "lat & lng required" });
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
  app, DB, saveData, auth, makeId, now, getUser, publicUser,
  sharesFamily, hashPassword, createSession, sendToUser, broadcastToFamilyOf, DEMO,
  onlineUserIds
});

const { attachPush } = require("./push");
const pushApi = attachPush({ app, DB, saveData, auth });

app.use(express.static(__dirname, {
  index: "index.html",
  extensions: ["html"],
  setHeaders(res, filePath) {
    if (filePath.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
  }
}));

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
      const to = msg.to;
      if (to) sendToUser(to, { type: "typing", from: sess.userId, ts: now() });
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
  console.log(`GPS-FAMILIA v${VERSION} ready at http://127.0.0.1:${PORT}/`);
  console.log(`Realtime WebSocket: ws://127.0.0.1:${PORT}/ws`);
  if (OTP_ECHO) console.log("OTP_ECHO is on — verification codes print here and are returned by the API for local use.");
});
