"use strict";

/** Health, config, static PWA shell, avatar catalog. */
module.exports = {
  id: "health",
  name: "Health, PWA & static shell",
  async run(t) {
    t.section("Health, PWA & static shell");

    const health = await t.get("/api/health");
    await t.expectStatus(health, 200, "GET /api/health");
    t.check("health.ok", !!(health.json && health.json.ok === true));
    t.check("health.version 2.16.0", health.json && health.json.version === "2.16.0", health.json && health.json.version);
    t.check("health.realtime", !!(health.json && health.json.realtime === true));
    t.check("health.uptime", !!(health.json && Number(health.json.uptime) >= 0));
    t.check("health has X-Request-Id", !!(health.headers && health.headers["x-request-id"]));
    const diag = await t.get("/api/diag");
    await t.expectStatus(diag, 200, "GET /api/diag (demo)");
    t.check("diag counts", !!(diag.json && diag.json.counts && Number(diag.json.counts.users) >= 1));
    t.hasNoSecret(diag.json, "diag has no secrets");

    const cfg = await t.get("/api/config");
    await t.expectStatus(cfg, 200, "GET /api/config");
    t.check("config.ok", !!(cfg.json && cfg.json.ok));
    t.check("config.realtime", !!(cfg.json && cfg.json.realtime));
    t.check("config.pwa", !!(cfg.json && cfg.json.pwa));
    t.check("config.calls", !!(cfg.json && cfg.json.calls));
    t.check("config.matrix.voip", !!(cfg.json && cfg.json.matrix && cfg.json.matrix.voip));
    t.check("config.iceServers", Array.isArray(cfg.json && cfg.json.iceServers) && cfg.json.iceServers.length >= 1);
    t.hasNoSecret(cfg.json, "config JSON has no private keys");
    t.check("config has no demoPassword", !(cfg.json && Object.prototype.hasOwnProperty.call(cfg.json, "demoPassword")));
    t.check("config.i18n lists en/es", !!(cfg.json && Array.isArray(cfg.json.i18n) && cfg.json.i18n.includes("en") && cfg.json.i18n.includes("es")));
    t.check("config.market", !!(cfg.json && cfg.json.market === true));
    t.check("config.friends", !!(cfg.json && cfg.json.friends === true));
    t.check("config.payments", !!(cfg.json && cfg.json.payments === true));
    t.check("config.p2p", !!(cfg.json && cfg.json.p2p === true));
    t.check("config.feePercent 6.9%", !!(cfg.json && cfg.json.feePercent === 0.069));
    t.check("config has no stripe secret", !/sk_live|sk_test/.test(JSON.stringify(cfg.json || {})));

    const i18nEs = await t.get("/api/i18n?lang=es");
    await t.expectStatus(i18nEs, 200, "GET /api/i18n?lang=es");
    t.check("i18n Spanish catalog", !!(i18nEs.json && i18nEs.json.lang === "es" && i18nEs.json.strings && i18nEs.json.strings["splash.enter"]));
    const i18nEn = await t.get("/api/i18n?lang=en");
    t.check("i18n English catalog", !!(i18nEn.json && i18nEn.json.lang === "en" && i18nEn.json.strings && i18nEn.json.strings["a11y.skip"]));

    const home = await t.get("/");
    t.check("skip-link in shell", /skip-link/.test(home.text || "") && /href="#map"/.test(home.text || ""));
    t.check("html lang attribute", /<html\s+lang=/i.test(home.text || ""));
    t.check("toolbar aria-label on map tools", /aria-label="Map zoom/.test(home.text || ""));

    const pages = [
      ["/", "text/html"],
      ["/index.html", "text/html"],
      ["/styles.css", "text/css"],
      ["/app.js", "javascript"],
      ["/i18n.js", "javascript"],
      ["/locales/en.json", "json"],
      ["/locales/es.json", "json"],
      ["/sw.js", "javascript"],
      ["/ui-call.js", "javascript"],
      ["/ui-community.js", "javascript"],
      ["/ui-feed.js", "javascript"],
      ["/ui-market.js", "javascript"],
      ["/manifest.json", "json"],
      ["/icon-192.png", "image"],
      ["/icon-512.png", "image"]
    ];
    for (const [p, kind] of pages) {
      const r = await t.get(p);
      const ct = (r.headers["content-type"] || "").toLowerCase();
      t.check("static " + p, r.status === 200 && ct.includes(kind.split("/")[0] === "text" ? kind : kind), `status ${r.status} ct=${ct || "?"}`);
    }

    const man = await t.get("/manifest.json");
    t.check("manifest name", !!(man.json && (man.json.name || man.json.short_name)));

    const sw = await t.get("/sw.js");
    t.check("service worker cache version", /gps-familia-v\d+/.test(sw.text || ""), (sw.text || "").match(/gps-familia-v\d+/) && (sw.text || "").match(/gps-familia-v\d+/)[0]);

    const av = await t.get("/api/avatars");
    await t.expectStatus(av, 200, "GET /api/avatars");
    t.check("avatar catalog count 65", !!(av.json && av.json.count === 65), av.json && String(av.json.count));
    t.check("avatar files listed", !!(av.json && Array.isArray(av.json.avatars) && av.json.avatars.length === 65));
    if (av.json && av.json.avatars && av.json.avatars[0]) {
      const file = av.json.avatars[0].file;
      const img = await t.get(file);
      t.check("first avatar file served", img.status === 200, file + " → " + img.status);
    }
  }
};
