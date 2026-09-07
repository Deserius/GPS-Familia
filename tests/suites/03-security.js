"use strict";

/**
 * Defensive security: headers, secret files, authz isolation,
 * contact masking, location privacy. No exploit payloads.
 */
module.exports = {
  id: "security",
  name: "Security hardening & isolation",
  async run(t) {
    t.section("Security hardening & isolation");

    const health = await t.get("/api/health");
    t.check("X-Content-Type-Options nosniff", (health.headers["x-content-type-options"] || "") === "nosniff");
    t.check("Referrer-Policy set", !!(health.headers["referrer-policy"]));
    t.check("X-Powered-By hidden", health.headers["x-powered-by"] == null);
    t.check("X-Frame-Options DENY", (health.headers["x-frame-options"] || "") === "DENY");
    t.check("CSP default-src self", /default-src 'self'/.test(health.headers["content-security-policy"] || ""));
    t.check("Permissions-Policy present", /geolocation/.test(health.headers["permissions-policy"] || ""));
    t.check("rate-limit headers on /api", !!(health.headers["x-ratelimit-limit"]));

    const blocked = ["/.env", "/f360_data.json", "/f360_data.json.tmp", "/node_modules/express/package.json"];
    for (const p of blocked) {
      const r = await t.get(p);
      t.check("blocked " + p, r.status === 404 || r.status === 403, "status " + r.status);
      const leak = /PORT=|scrypt\$|sessionToken/.test(r.text || "");
      t.check("no secret body " + p, !leak, leak ? "body looked like secrets" : "ok");
    }

    const trav = await t.get("/api/../.env");
    t.check("path-normalize does not serve .env", trav.status !== 200 || !/^[A-Z_]+=/m.test(trav.text || ""), "status " + trav.status);

    const vito = await t.login("vito@familia.test", "demo123");
    const kay = await t.login("kay@familia.test", "demo123");
    const outsider = await t.register();
    if (!vito || !outsider) {
      t.fail("logins for isolation", "need vito + a fresh outsider");
      return;
    }

    const guarded = [
      "/api/sync", "/api/locations", "/api/inbox", "/api/feed",
      "/api/families", "/api/rooms", "/api/people/hub", "/api/calls/ice", "/api/matrix/whoami"
    ];
    for (const p of guarded) {
      const r = await t.get(p);
      await t.expectStatus(r, 401, "unauth " + p + " → 401");
    }

    const qtok = await t.get("/api/sync?token=" + encodeURIComponent(vito.token));
    await t.expectStatus(qtok, 401, "REST query token rejected");

    const syncV = await t.get("/api/sync", { token: vito.token });
    await t.expectStatus(syncV, 200, "vito sync");
    const usersV = (syncV.json && syncV.json.users) || [];
    const idsV = new Set(usersV.map((u) => u.id));
    t.check("vito sync includes sonny (family)", idsV.has("u_demo_sonny"));
    t.check("vito sync does not include fresh outsider", !idsV.has(outsider.user.id));
    t.hasNoSecret(syncV.json, "sync JSON has no password hashes");

    const locV = await t.get("/api/locations", { token: vito.token });
    const locIds = new Set(((locV.json && locV.json.locations) || []).map((l) => l.userId));
    t.check("vito sees family pins", locIds.has("u_demo_vito") || locIds.has("u_demo_sonny"));
    t.check("vito does not see outsider pin", !locIds.has(outsider.user.id));
    if (kay) {
      t.check("guest Kay pin hidden from Head (viewLocation=false)", !locIds.has("u_demo_kay"));
    }

    await t.post("/api/location", { lat: 40.0, lng: -105.0, type: "live" }, { token: vito.token });
    const locO = await t.get("/api/locations", { token: outsider.token });
    const locOids = new Set(((locO.json && locO.json.locations) || []).map((l) => l.userId));
    t.check("outsider does not see vito pin", !locOids.has("u_demo_vito"));

    const histDenied = await t.get("/api/users/u_demo_vito/history", { token: outsider.token });
    await t.expectStatus(histDenied, 403, "non-family history → 403");

    const histOk = await t.get("/api/users/u_demo_sonny/history", { token: vito.token });
    await t.expectStatus(histOk, 200, "family history allowed for Head");

    const search = await t.get("/api/search?q=" + encodeURIComponent(outsider.user.name), { token: vito.token });
    await t.expectStatus(search, 200, "directory search");
    const hit = ((search.json && search.json.users) || []).find((u) => u.id === outsider.user.id);
    if (hit) {
      t.check("search does not include lastLocation", hit.lastLocation == null, JSON.stringify(hit.lastLocation || null));
      const em = String(hit.email || "");
      t.check("non-family email masked in search", em.includes("•••") || em === "", em);
    } else {
      t.warn("search outsider", "no user hit — query=" + outsider.user.name);
    }

    const privFam = ((syncV.json && syncV.json.families) || []).find((f) => f.id === "f_demo_corleone");
    if (privFam) {
      const msgs = await t.get("/api/messages?family=" + encodeURIComponent(privFam.id), { token: outsider.token });
      await t.expectStatus(msgs, 403, "non-member cannot read family chat");
    }

    const poke = await t.post("/api/families/f_demo_corleone/join", {}, { token: outsider.token });
    t.check("private family join without invite is request or 4xx, not silent add",
      (poke.status === 200 && poke.json && poke.json.requested === true) || poke.status >= 400,
      "status " + poke.status + " " + JSON.stringify(poke.json && { requested: poke.json.requested, already: poke.json.already }));

    const kick = await t.post("/api/families/f_demo_corleone/kick", { userId: "u_demo_sonny" }, { token: outsider.token });
    await t.expectStatus(kick, [403, 404], "outsider cannot kick Corleone member");

    const admin = await t.get("/api/families/f_demo_corleone/admin", { token: outsider.token });
    await t.expectStatus(admin, 403, "outsider cannot open family admin");

    const member = await t.login("fredo@familia.test", "demo123");
    if (member) {
      const edit = await t.patch("/api/families/f_demo_corleone", { name: "Hacked" }, { token: member.token });
      await t.expectStatus(edit, 403, "plain member cannot edit family");
      const xfer = await t.post("/api/families/f_demo_corleone/transfer", { userId: "u_demo_fredo" }, { token: member.token });
      await t.expectStatus(xfer, 403, "only Head can transfer");
    }

    const setupG = await t.post("/api/setup/google", { clientId: "not-a-client" });
    t.check("google setup rejects junk client id", setupG.status === 400 || setupG.status === 403, "status " + setupG.status);

    const media = await t.http("POST", "/api/media", {
      token: vito.token,
      headers: { "content-type": "application/x-msdownload" },
      body: Buffer.from("MZ")
    });
    t.check("media rejects non photo/video", media.status === 400, "status " + media.status);
  }
};
