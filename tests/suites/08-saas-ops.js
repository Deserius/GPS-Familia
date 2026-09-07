"use strict";

/** Places, media, push, load smoke, account delete, static hygiene. */
module.exports = {
  id: "saas",
  name: "SaaS ops (places, media, push, load, delete)",
  async run(t) {
    t.section("SaaS ops (places, media, push, load, delete)");

    const a = await t.register();
    const b = await t.register();
    if (!a || !b) return;

    const place = await t.post("/api/places", {
      name: "QA HQ",
      desc: "test pin",
      lat: 39.7392,
      lng: -104.9903
    }, { token: a.token });
    await t.expectStatus(place, 200, "save named place");
    const pid = place.json && place.json.place && place.json.place.id;
    const list = await t.get("/api/places", { token: a.token });
    t.check("place listed for owner", ((list.json && list.json.places) || []).some((p) => p.id === pid));
    const otherList = await t.get("/api/places", { token: b.token });
    t.check("place not listed for other user", !((otherList.json && otherList.json.places) || []).some((p) => p.id === pid));
    const steal = await t.del("/api/places/" + pid, {}, { token: b.token });
    await t.expectStatus(steal, 404, "cannot delete someone else's place");
    const gone = await t.del("/api/places/" + pid, {}, { token: a.token });
    await t.expectStatus(gone, 200, "owner deletes place");

    const jpeg = Buffer.from(
      "/9j/4AAQSkZJRgABAQAAAQABAAD/2wAAAAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI/8AAEQgAAQABAwERAAIRAQMRAf/EABQBAQAAAAAAAAAAAAAAAAAAAAD/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGf/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPwB//9k=",
      "base64"
    );
    const up = await t.http("POST", "/api/media", {
      token: a.token,
      headers: { "content-type": "image/jpeg" },
      body: jpeg
    });
    await t.expectStatus(up, 200, "upload jpeg via /api/media");
    t.check("media url under /uploads", !!(up.json && /^\/uploads\/[A-Za-z0-9._-]+\.jpg$/.test(up.json.url)), up.json && up.json.url);
    if (up.json && up.json.url) {
      const file = await t.get(up.json.url);
      t.check("uploaded file is served", file.status === 200 && (file.headers["content-type"] || "").includes("image"));
    }

    const subBad = await t.post("/api/push/subscribe", {}, { token: a.token });
    await t.expectStatus(subBad, 400, "push subscribe requires endpoint");
    const sub = await t.post("/api/push/subscribe", {
      subscription: { endpoint: "https://example.invalid/push/" + a.user.id, keys: { p256dh: "x", auth: "y" } }
    }, { token: a.token });
    await t.expectStatus(sub, 200, "push subscribe stored");
    const unsub = await t.post("/api/push/unsubscribe", { endpoint: "https://example.invalid/push/" + a.user.id }, { token: a.token });
    await t.expectStatus(unsub, 200, "push unsubscribe");

    const cfg = await t.get("/api/config");
    t.check("vapidPublic advertised when push on", !!(cfg.json && (cfg.json.push === true || cfg.json.vapidPublic)), "push=" + (cfg.json && cfg.json.push));

    const t0 = Date.now();
    const burst = await Promise.all(Array.from({ length: 20 }, () => t.get("/api/health")));
    const allOk = burst.every((r) => r.status === 200 && r.json && r.json.ok);
    t.check("20 concurrent /api/health", allOk, "slowest " + Math.max(...burst.map((r) => r.ms)) + "ms, wall " + (Date.now() - t0) + "ms");

    const logins = await Promise.all([
      t.post("/api/login", { identifier: "vito@familia.test", password: "demo123" }),
      t.post("/api/login", { identifier: "sonny@familia.test", password: "demo123" }),
      t.post("/api/login", { identifier: "michael@familia.test", password: "demo123" })
    ]);
    t.check("parallel demo logins", logins.every((r) => r.status === 200 && r.json && r.json.sessionToken));

    const doomed = await t.register();
    if (doomed) {
      const no = await t.del("/api/me", { password: "wrong" }, { token: doomed.token });
      await t.expectStatus(no, 401, "delete account bad password → 401");
      const yes = await t.del("/api/me", { password: doomed.creds.password }, { token: doomed.token });
      await t.expectStatus(yes, 200, "delete own account");
      const again = await t.post("/api/login", { identifier: doomed.creds.email, password: doomed.creds.password });
      await t.expectStatus(again, 401, "deleted account cannot log in");
    }

    const demoDel = await t.login("vito@familia.test", "demo123");
    if (demoDel) {
      const blocked = await t.del("/api/me", { password: "demo123" }, { token: demoDel.token });
      await t.expectStatus(blocked, 403, "demo accounts cannot be deleted");
    }
  }
};
