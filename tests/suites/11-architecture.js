"use strict";

/** Modular-monolith architecture: config, ready, invite helpers, backend JS not static. */
const invites = require("../../modules/families/invites");
const { VERSION, getConfig, getPublicConfig } = require("../../config");
const cryptoLib = require("../../lib/crypto");
const validate = require("../../lib/validate");

module.exports = {
  id: "architecture",
  name: "Architecture & module boundaries",
  async run(t) {
    t.section("Architecture & module boundaries");

    t.check("config VERSION 2.16.0", VERSION === "2.16.0", VERSION);
    const cfg = getConfig();
    t.check("config has PORT/HOST", !!(cfg.PORT && cfg.HOST));
    const pub = getPublicConfig();
    t.check("public config has no demoPassword", !Object.prototype.hasOwnProperty.call(pub, "DEMO_PASSWORD") && !Object.prototype.hasOwnProperty.call(pub, "demoPassword"));

    const hashed = cryptoLib.hashPassword("demo123");
    t.check("scrypt hash shape", /^scrypt\$[0-9a-f]+\$[0-9a-f]+$/.test(hashed));
    t.check("verifyPassword accepts match", cryptoLib.verifyPassword("demo123", hashed) === true);
    t.check("verifyPassword rejects miss", cryptoLib.verifyPassword("nope", hashed) === false);
    t.check("isEmail accepts", validate.isEmail("vito@familia.test") === true);
    t.check("isEmail rejects", validate.isEmail("not-an-email") === false);
    t.check("passwordOk min 6", validate.passwordOk("12345") === false && validate.passwordOk("123456") === true);
    t.check("coords finite", !!(validate.coords("39.7", "-104.9") && !validate.coords("x", "y")));
    t.check("normalizePhone strips +1", validate.normalizePhone("+1 (303) 555-1212") === "3035551212");

    const tok = invites.mintInviteToken("f_arch", "u_arch", 1700000000000);
    t.check("minted token is url-safe", !!(tok && !/[+/=]/.test(tok)));
    const decoded = invites.decodeInviteToken(tok);
    t.check("decode round-trip fid", !!(decoded && decoded.fid === "f_arch" && decoded.from === "u_arch"));
    const families = [{ id: "f_arch", invites: [tok], members: ["u_arch"] }];
    const messy = tok.replace(/-/g, "+").replace(/_/g, "/");
    let padded = messy;
    while (padded.length % 4) padded += "=";
    const spaced = padded.replace(/\+/g, " ");
    t.check("findInviteFamily accepts spaces-for-plus", !!(invites.findInviteFamily(spaced, families)));
    t.check("findInviteFamily accepts /invite/ URL", !!(invites.findInviteFamily("https://phone.example/invite/" + tok, families)));

    const ready = await t.get("/api/ready");
    await t.expectStatus(ready, 200, "GET /api/ready");
    t.check("ready.ready", !!(ready.json && ready.json.ready === true && ready.json.version === "2.16.0"));

    const blocked = [
      "/server.js", "/community-server.js", "/security.js", "/config/index.js",
      "/modules/families/invites.js", "/lib/log.js", "/package.json", "/tests/run-all.js",
      "/docs/API.md", "/Dockerfile"
    ];
    for (const p of blocked) {
      const r = await t.get(p);
      t.check("backend not static " + p, r.status === 404 || r.status === 403, "status " + r.status);
    }

    const appjs = await t.get("/app.js");
    t.check("browser app.js still served", appjs.status === 200);
    const cc = String((appjs.headers && (appjs.headers["cache-control"] || appjs.headers["Cache-Control"])) || "");
    t.check("app.js is no-cache", /no-cache/i.test(cc), cc);

    const av = await t.get("/avatars/av-01.png");
    t.check("avatar served", av.status === 200);
    const avcc = String((av.headers && (av.headers["cache-control"] || av.headers["Cache-Control"])) || "");
    t.check("avatar cache immutable", /max-age/i.test(avcc) && /immutable/i.test(avcc), avcc);
  }
};
