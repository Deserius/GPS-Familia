"use strict";

/** Google Identity Services ID-token verification. No client secret. */

async function verifyGoogleIdToken(credential, aud) {
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

module.exports = { verifyGoogleIdToken };
