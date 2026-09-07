"use strict";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isEmail(s) {
  return EMAIL_RE.test(String(s || "").trim());
}

function passwordOk(pw) {
  return String(pw || "").length >= 6;
}

function coords(lat, lng) {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  return { lat: la, lng: ln };
}

function digits(s) {
  return String(s || "").replace(/\D/g, "");
}

function normalizePhone(s) {
  let d = digits(s);
  if (d.length === 11 && d.charAt(0) === "1") d = d.slice(1);
  return d;
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

module.exports = { isEmail, passwordOk, coords, digits, normalizePhone, maskPhone, maskEmail };
