"use strict";

const crypto = require("crypto");

function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString("hex");
}

function makeId(prefix) {
  return (prefix || "id") + "_" + randomHex(6);
}

function hashPassword(pw) {
  const salt = randomHex(16);
  const hash = crypto.scryptSync(String(pw), salt, 32).toString("hex");
  return "scrypt$" + salt + "$" + hash;
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

module.exports = { randomHex, makeId, hashPassword, verifyPassword };
