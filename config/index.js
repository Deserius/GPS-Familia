"use strict";

/**
 * Central configuration. Loads .env once, then reads process.env.
 * Feature modules should call getConfig() instead of scattering env access.
 * Secrets are never logged or returned from getPublicConfig().
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const VERSION = "2.16.0";

function loadDotEnv(file) {
  file = file || path.join(ROOT, ".env");
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

function boolEnv(name, fallbackTrue) {
  const v = process.env[name];
  if (v == null || v === "") return fallbackTrue;
  return String(v).toLowerCase() !== "false";
}

function getConfig() {
  const PROD = process.env.NODE_ENV === "production";
  return {
    VERSION,
    PROD,
    PORT: Number(process.env.PORT || 3000),
    HOST: process.env.HOST || "0.0.0.0",
    DATA_FILE: process.env.DATA_FILE || path.join(ROOT, "f360_data.json"),
    OTP_ECHO: boolEnv("OTP_ECHO", !PROD),
    DEMO: boolEnv("DEMO_MODE", !PROD),
    DEMO_PASSWORD: String(process.env.DEMO_PASSWORD || "demo123"),
    SESSION_MS: 30 * 24 * 60 * 60 * 1000,
    RATE_API: Number(process.env.RATE_API_MAX || (PROD ? 240 : 4000)),
    RATE_LOGIN: Number(process.env.RATE_LOGIN_MAX || (PROD ? 30 : 400)),
    RATE_REG: Number(process.env.RATE_REGISTER_MAX || (PROD ? 10 : 200)),
    RATE_OTP: Number(process.env.RATE_OTP_MAX || (PROD ? 8 : 80)),
    RATE_AUTH: Number(process.env.RATE_AUTH_MAX || (PROD ? 30 : 200))
  };
}

function getPublicConfig() {
  const c = getConfig();
  return {
    version: c.VERSION,
    demo: c.DEMO,
    otpEcho: c.OTP_ECHO,
    realtime: true
  };
}

module.exports = { VERSION, ROOT, loadDotEnv, getConfig, getPublicConfig };
