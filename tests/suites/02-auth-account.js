"use strict";

/** Registration, login, session, OTP, demo, profile, password, logout. */
module.exports = {
  id: "auth",
  name: "Auth & account lifecycle",
  async run(t) {
    t.section("Auth & account lifecycle");

    const miss = await t.post("/api/login", {});
    await t.expectStatus(miss, 400, "login without identifier → 400");

    const badPw = await t.post("/api/login", { identifier: "vito@familia.test", password: "wrong-password-xxx" });
    await t.expectStatus(badPw, 401, "bad password → 401");

    const missing = await t.post("/api/login", { identifier: "no-such-user@familia.test", password: "demo123" });
    await t.expectStatus(missing, 401, "unknown user → 401");

    const demo = await t.login("vito@familia.test", "demo123");
    t.check("demo login vito", !!(demo && demo.token && demo.user && demo.user.id === "u_demo_vito"));
    if (demo) t.hasNoSecret(demo.raw.json, "login response has no password hash");

    const me = await t.get("/api/me", { token: demo && demo.token });
    await t.expectStatus(me, 200, "GET /api/me");
    t.check("me.id is vito", me.json && me.json.user && me.json.user.id === "u_demo_vito");
    t.hasNoSecret(me.json, "/api/me has no password");

    const noTok = await t.get("/api/me");
    await t.expectStatus(noTok, 401, "GET /api/me without token → 401");
    const junkTok = await t.get("/api/me", { token: "not-a-real-session" });
    await t.expectStatus(junkTok, 401, "GET /api/me junk token → 401");

    const weak = await t.post("/api/register", { name: "X", email: "x@y.z", password: "123" });
    await t.expectStatus(weak, 400, "short password → 400");
    const badEm = await t.post("/api/register", { name: "X", email: "not-an-email", password: "abcdef" });
    await t.expectStatus(badEm, 400, "invalid email → 400");
    const noName = await t.post("/api/register", { email: "ok@familia.test", password: "abcdef" });
    await t.expectStatus(noName, 400, "missing name → 400");

    const acc = await t.register();
    t.check("register unique user", !!(acc && acc.token && acc.user && acc.user.id));
    if (acc) {
      t.hasNoSecret(acc.raw.json, "register response has no password hash");
      const clash = await t.post("/api/register", {
        name: acc.creds.name + "2",
        email: acc.creds.email,
        password: "abcdef"
      });
      await t.expectStatus(clash, 409, "duplicate email → 409");

      const put = await t.put("/api/me", { name: acc.creds.name + " Jr" }, { token: acc.token });
      await t.expectStatus(put, 200, "PUT /api/me display name");
      t.check("name updated", put.json && put.json.user && String(put.json.user.name).endsWith(" Jr"));

      const prefs = await t.put("/api/me", {
        prefs: { appearOnMap: true, preciseLocation: false, allowHistory: true, recordHistory: true }
      }, { token: acc.token });
      await t.expectStatus(prefs, 200, "PUT /api/me privacy prefs");
      t.check("prefs.preciseLocation false", prefs.json && prefs.json.user && prefs.json.user.prefs && prefs.json.user.prefs.preciseLocation === false);

      const pwBad = await t.post("/api/me/password", { current: "nope", next: "NewPass9!" }, { token: acc.token });
      await t.expectStatus(pwBad, 401, "wrong current password → 401");
      const pwOk = await t.post("/api/me/password", { current: acc.creds.password, next: "NewPass9!" }, { token: acc.token });
      await t.expectStatus(pwOk, 200, "change password");
      const oldLogin = await t.post("/api/login", { identifier: acc.creds.email, password: acc.creds.password });
      await t.expectStatus(oldLogin, 401, "old password rejected after change");
      const newLogin = await t.login(acc.creds.email, "NewPass9!");
      t.check("new password works", !!(newLogin && newLogin.token));

      const av = await t.get("/api/avatars");
      const first = av.json && av.json.avatars && av.json.avatars[0];
      if (first) {
        const setAv = await t.post("/api/me/profile", { avatarId: first.id }, { token: acc.token });
        await t.expectStatus(setAv, 200, "set catalog profile icon");
      }
      const badAv = await t.post("/api/me/profile", { avatarId: "../../../etc/passwd" }, { token: acc.token });
      t.check("avatarId sanitised / not found", badAv.status === 404 || badAv.status === 400, "status " + badAv.status);

      const out = await t.post("/api/logout", {}, { token: acc.token });
      await t.expectStatus(out, 200, "POST /api/logout");
      const after = await t.get("/api/me", { token: acc.token });
      await t.expectStatus(after, 401, "token dead after logout");
    }

    const otp = await t.post("/api/send-otp", { phone: "5550001111" });
    await t.expectStatus(otp, 200, "POST /api/send-otp");
    t.check("OTP delivered envelope", !!(otp.json && otp.json.ok));
    const code = (otp.json && otp.json.otp) || "000000";
    const ver = await t.post("/api/verify-otp", { phone: "5550001111", code });
    await t.expectStatus(ver, 200, "POST /api/verify-otp");
    t.check("OTP issues session", !!(ver.json && ver.json.sessionToken));

    const demoList = await t.get("/api/demo/accounts");
    await t.expectStatus(demoList, 200, "GET /api/demo/accounts");
    t.check("demo accounts seeded", !!(demoList.json && Array.isArray(demoList.json.accounts) && demoList.json.accounts.length >= 8),
      demoList.json && String((demoList.json.accounts || []).length));
    const tap = await t.post("/api/demo/login", { id: "u_demo_sonny" });
    await t.expectStatus(tap, 200, "POST /api/demo/login sonny");
    t.check("demo tap session", !!(tap.json && tap.json.sessionToken));

    const gTok = await t.post("/api/auth/google", {});
    await t.expectStatus(gTok, 400, "Google auth without credential → 400");
    const gFake = await t.post("/api/auth/google", { credential: "not.a.jwt" });
    t.check("Google fake token rejected", gFake.status === 401 || gFake.status === 400, "status " + gFake.status);
  }
};
