"use strict";

/** Family create reliability, live vs idle pins, public search, child accounts. */
module.exports = {
  id: "map-child",
  name: "Family create, live pins, child accounts",
  async run(t) {
    t.section("Family create, live pins, child accounts");

    const a = await t.register();
    const b = await t.register();
    if (!a || !b) return;

    const empty = await t.post("/api/families", { name: "   ", privacy: "public" }, { token: a.token });
    await t.expectStatus(empty, 200, "create family with blank name still works");
    t.check("blank name filled in", !!(empty.json && empty.json.family && empty.json.family.name));
    t.check("creator is member", !!(empty.json.family.members && empty.json.family.members.includes(a.user.id)));

    const pub = await t.post("/api/families", { name: "Public Search House " + Date.now().toString(36), privacy: "public" }, { token: a.token });
    await t.expectStatus(pub, 200, "create public family");
    const pubId = pub.json && pub.json.family && pub.json.family.id;
    const priv = await t.post("/api/families", { name: "Private Keep Out " + Date.now().toString(36), privacy: "private" }, { token: a.token });
    const privId = priv.json && priv.json.family && priv.json.family.id;

    const dir = await t.get("/api/search?q=", { token: b.token });
    await t.expectStatus(dir, 200, "empty search");
    t.check("public family listed for stranger", ((dir.json && dir.json.families) || []).some((f) => f.id === pubId));
    t.check("private family hidden from stranger", !((dir.json && dir.json.families) || []).some((f) => f.id === privId));

    const named = await t.get("/api/search?q=" + encodeURIComponent(a.creds.name), { token: b.token });
    t.check("users searchable by name", ((named.json && named.json.users) || []).some((u) => u.id === a.user.id));

    await t.put("/api/me", { prefs: { appearInSearch: false, findByName: "nobody" } }, { token: a.token });
    const hidden = await t.get("/api/search?q=" + encodeURIComponent(a.creds.name), { token: b.token });
    t.check("appearInSearch off hides name", !((hidden.json && hidden.json.users) || []).some((u) => u.id === a.user.id));

    const inv = await t.post("/api/families/" + pubId + "/invite", {}, { token: a.token });
    const tok = inv.json && inv.json.token;
    t.check("family invite token for QR", !!tok);
    const preview = await t.post("/api/qr/resolve", { token: tok }, { token: b.token });
    await t.expectStatus(preview, 200, "family QR resolves");
    t.check("QR does not auto-join", preview.json && preview.json.confirmRequired && preview.json.alreadyMember !== true);

    const famJoin = await t.post("/api/families/join", { token: tok }, { token: b.token });
    await t.expectStatus(famJoin, 200, "B joins via invite token");

    const idle = await t.post("/api/location", { lat: 39.74, lng: -104.99, type: "preview", tracking: false }, { token: b.token });
    await t.expectStatus(idle, 200, "preview location");
    t.check("preview is not tracking", idle.json && idle.json.tracking === false);
    const locsIdle = await t.get("/api/locations", { token: a.token });
    t.check("idle pin hidden from family", !((locsIdle.json && locsIdle.json.locations) || []).some((l) => l.userId === b.user.id && l.live));

    const live = await t.post("/api/location", { lat: 39.75, lng: -104.98, type: "live", tracking: true }, { token: b.token });
    await t.expectStatus(live, 200, "live location");
    t.check("live tracking on", live.json && live.json.tracking === true);
    const locsLive = await t.get("/api/locations", { token: a.token });
    t.check("live pin visible to family", ((locsLive.json && locsLive.json.locations) || []).some((l) => l.userId === b.user.id && l.tracking));

    const off = await t.post("/api/me/tracking", { on: false }, { token: b.token });
    await t.expectStatus(off, 200, "stop tracking");
    const locsOff = await t.get("/api/locations", { token: a.token });
    t.check("stopped tracking hides pin from others", !((locsOff.json && locsOff.json.locations) || []).some((l) => l.userId === b.user.id));

    const kid = await t.register({
      name: "Kid " + Date.now().toString(36),
      email: "kid." + Date.now().toString(36) + "@familia.test",
      phone: "303" + String(Date.now()).slice(-7),
      accountType: "child"
    });
    if (!kid) return;
    t.check("child flag on user", !!(kid.user && (kid.user.child || kid.user.accountType === "child")));
    const mkt = await t.get("/api/market", { token: kid.token });
    await t.expectStatus(mkt, 403, "child cannot open marketplace");
    const dm = await t.post("/api/messages", { to: a.user.id, enc: { v: 1, iv: "YQ", ct: "Yg" } }, { token: kid.token });
    await t.expectStatus(dm, 403, "child cannot message a stranger");
    const fr = await t.post("/api/friends/request", { userId: a.user.id }, { token: kid.token });
    await t.expectStatus(fr, 200, "child can send friend requests");
  }
};
