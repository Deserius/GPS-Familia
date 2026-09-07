"use strict";

/** Families, invites, location, history, roles. */
module.exports = {
  id: "families",
  name: "Families, location & roles",
  async run(t) {
    t.section("Families, location & roles");

    const a = await t.register();
    const b = await t.register();
    const c = await t.register();
    if (!a || !b || !c) return;

    const created = await t.post("/api/families", {
      name: "QA House " + Date.now().toString(36),
      password: "famlock",
      privacy: "private"
    }, { token: a.token });
    await t.expectStatus(created, 200, "create private family");
    const fam = created.json && created.json.family;
    t.check("family has id + invite", !!(fam && fam.id && Array.isArray(fam.invites) && fam.invites[0]));
    t.check("creator is owner/member", !!(fam && fam.ownerId === a.user.id && fam.members.includes(a.user.id)));
    if (fam && fam.password) {
      if (String(fam.password).startsWith("scrypt$")) {
        t.warn("create family returns password hash", "strip `password` from API responses in production");
      } else {
        t.fail("family password returned in plaintext", "never return raw family passwords");
      }
    } else {
      t.pass("family password omitted from response");
    }

    const badJoin = await t.post("/api/families/" + fam.id + "/join", { password: "nope" }, { token: b.token });
    await t.expectStatus(badJoin, 401, "wrong family password → 401");
    const goodJoin = await t.post("/api/families/" + fam.id + "/join", { password: "famlock" }, { token: b.token });
    await t.expectStatus(goodJoin, 200, "join with family password");

    const inv = await t.post("/api/families/" + fam.id + "/invite", {}, { token: a.token });
    await t.expectStatus(inv, 200, "mint invite token");
    const token = inv.json && inv.json.token;
    t.check("invite url opens app", !!(inv.json && inv.json.url && String(inv.json.url).includes("invite=")));
    t.check("invite token is url-safe", !!(token && !/[+/=]/.test(String(token))));
    t.check("qrUrl uses /invite/ path", !!(inv.json && inv.json.qrUrl && /\/invite\//.test(String(inv.json.qrUrl))));

    const previewUnauth = await t.get("/api/invite/preview?token=" + encodeURIComponent(token));
    await t.expectStatus(previewUnauth, 401, "invite preview requires auth");

    const preview = await t.get("/api/invite/preview?token=" + encodeURIComponent(token), { token: c.token });
    await t.expectStatus(preview, 200, "invite preview");
    t.check("preview family name", !!(preview.json && preview.json.family && preview.json.family.name));
    t.check("preview members listed", !!(preview.json && Array.isArray(preview.json.members) && preview.json.members.length >= 2));
    t.check("preview roles listed", !!(preview.json && Array.isArray(preview.json.roles) && preview.json.roles.length >= 1));
    t.check("preview briefing rules", !!(preview.json && preview.json.briefing && Array.isArray(preview.json.briefing.theyCan)));
    t.check("preview not auto-joined", preview.json && preview.json.alreadyMember === false);
    t.check("preview invitedBy is Head", !!(preview.json && preview.json.invitedBy && preview.json.invitedBy.id === a.user.id));

    const beforeJoin = await t.get("/api/families", { token: c.token });
    const mineBefore = (beforeJoin.json && beforeJoin.json.families) || [];
    t.check("preview does not add member", !mineBefore.some((f) => f.id === fam.id));

    const joinTok = await t.post("/api/families/join", { token }, { token: c.token });
    await t.expectStatus(joinTok, 200, "join via invite token");
    t.check("join returns briefing", !!(joinTok.json && joinTok.json.briefing && joinTok.json.briefing.role));

    const alreadyPrev = await t.get("/api/invite/preview?token=" + encodeURIComponent(token), { token: c.token });
    t.check("already-member preview", !!(alreadyPrev.json && alreadyPrev.json.alreadyMember === true));

    const inv2 = await t.post("/api/families/" + fam.id + "/invite", {}, { token: a.token });
    const token2 = (inv2.json && inv2.json.token) || token;
    const d = await t.register();
    if (d && token2) {
      let std = String(token2).replace(/-/g, "+").replace(/_/g, "/");
      while (std.length % 4) std += "=";
      const messy = std.replace(/\+/g, " ");
      const prevPost = await t.post("/api/invite/preview", { token: messy }, { token: d.token });
      await t.expectStatus(prevPost, 200, "POST preview with spaces-for-plus");
      t.check("preview returns stored token", !!(prevPost.json && prevPost.json.token));
      const pathJoin = await t.post("/api/families/join", { token: "https://phone.example/invite/" + token2 }, { token: d.token });
      await t.expectStatus(pathJoin, 200, "join via /invite/ URL");
    }
    const e = await t.register();
    if (e && token2) {
      const qJoin = await t.post("/api/families/join", { token: "https://host.example/?invite=" + encodeURIComponent(token2) }, { token: e.token });
      await t.expectStatus(qJoin, 200, "join via ?invite= URL");
    }
    const redir = await t.get("/invite/" + token2);
    await t.expectStatus(redir, 302, "GET /invite/:token redirects into app");
    t.check("redirect Location has invite=", !!(redir.headers && /invite=/.test(String(redir.headers.location || ""))));

    const pub = await t.post("/api/families", { name: "QA Public " + Date.now().toString(36), privacy: "public" }, { token: a.token });
    const pubFam = pub.json && pub.json.family;
    if (pubFam) {
      const outsider = await t.register();
      if (outsider) {
        const j = await t.post("/api/families/" + pubFam.id + "/join", {}, { token: outsider.token });
        await t.expectStatus(j, 200, "join public family without password");
      }
    }

    const pinA = await t.post("/api/location", { lat: 39.7392, lng: -104.9903, type: "live", record: true }, { token: a.token });
    await t.expectStatus(pinA, 200, "POST /api/location A");
    const pinB = await t.post("/api/location", { lat: 39.758, lng: -104.978, type: "minute", record: true }, { token: b.token });
    await t.expectStatus(pinB, 200, "POST /api/location B");

    const locs = await t.get("/api/locations", { token: a.token });
    const ids = new Set(((locs.json && locs.json.locations) || []).map((l) => l.userId));
    t.check("A sees own pin", ids.has(a.user.id));
    t.check("A sees B pin (same family)", ids.has(b.user.id));

    const hist = await t.get("/api/users/" + b.user.id + "/history", { token: a.token });
    await t.expectStatus(hist, 200, "A reads B history");
    t.check("history has points", !!(hist.json && Array.isArray(hist.json.history) && hist.json.history.length >= 1),
      hist.json && String(hist.json.count));

    await t.put("/api/me", { prefs: { appearOnMap: false } }, { token: b.token });
    const locs2 = await t.get("/api/locations", { token: a.token });
    const ids2 = new Set(((locs2.json && locs2.json.locations) || []).map((l) => l.userId));
    t.check("appearOnMap=false hides B from A", !ids2.has(b.user.id));
    await t.put("/api/me", { prefs: { appearOnMap: true, preciseLocation: false } }, { token: b.token });
    const locs3 = await t.get("/api/locations", { token: a.token });
    const rowB = ((locs3.json && locs3.json.locations) || []).find((l) => l.userId === b.user.id);
    t.check("approx pin when preciseLocation=false", !!(rowB && rowB.approx === true));

    const admin = await t.get("/api/families/" + fam.id + "/admin", { token: a.token });
    await t.expectStatus(admin, 200, "Head opens family admin");
    t.check("Head can manageRoles", !!(admin.json && admin.json.can && admin.json.can.manageRoles));

    const role = await t.put("/api/families/" + fam.id + "/roles", { userId: b.user.id, role: "admin" }, { token: a.token });
    await t.expectStatus(role, 200, "Head appoints Admin");

    const def = await t.post("/api/families/" + fam.id + "/role-defs", {
      key: "scout",
      label: "Scout",
      privileges: { invite: true, viewLocation: true, viewHistory: false }
    }, { token: a.token });
    await t.expectStatus(def, 200, "create custom role");

    const asMember = await t.patch("/api/families/" + fam.id, { name: "Nope" }, { token: c.token });
    await t.expectStatus(asMember, 403, "member without editFamily cannot rename");

    const leave = await t.post("/api/families/" + fam.id + "/leave", {}, { token: c.token });
    await t.expectStatus(leave, 200, "member can leave");
    const locs4 = await t.get("/api/locations", { token: c.token });
    const ids4 = new Set(((locs4.json && locs4.json.locations) || []).map((l) => l.userId));
    t.check("after leave, C no longer sees A pin", !ids4.has(a.user.id));

    const wipe = await t.del("/api/me/history", {}, { token: a.token });
    await t.expectStatus(wipe, 200, "clear own location history");
  }
};
