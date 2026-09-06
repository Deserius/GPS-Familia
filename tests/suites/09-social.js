"use strict";

/** Friend requests, block, report, DM policy, family briefing. */
module.exports = {
  id: "social",
  name: "Friends, block, report & family briefing",
  async run(t) {
    t.section("Friends, block, report & family briefing");

    const a = await t.register();
    const b = await t.register();
    const c = await t.register();
    if (!a || !b || !c) return;

    const unauth = await t.get("/api/friends");
    await t.expectStatus(unauth, 401, "friends requires auth");

    const reqAb = await t.post("/api/friends/request", { userId: b.user.id }, { token: a.token });
    await t.expectStatus(reqAb, 200, "A requests B");
    t.check("request pending", !!(reqAb.json && reqAb.json.requested));

    const listB = await t.get("/api/friends", { token: b.token });
    await t.expectStatus(listB, 200, "B friends list");
    t.check("B sees incoming", !!(listB.json && listB.json.incoming && listB.json.incoming.length >= 1));

    const fid = listB.json.incoming[0].id;
    const acc = await t.post("/api/friends/" + encodeURIComponent(fid) + "/accept", {}, { token: b.token });
    await t.expectStatus(acc, 200, "B accepts A");

    const listA = await t.get("/api/friends", { token: a.token });
    t.check("A and B are friends", !!(listA.json && listA.json.friends && listA.json.friends.some((f) => f.otherId === b.user.id)));

    const selfFr = await t.post("/api/friends/request", { userId: a.user.id }, { token: a.token });
    await t.expectStatus(selfFr, 400, "cannot friend yourself");

    const blk = await t.post("/api/blocks", { userId: c.user.id }, { token: a.token });
    await t.expectStatus(blk, 200, "A blocks C");
    const blocks = await t.get("/api/blocks", { token: a.token });
    t.check("block listed", !!(blocks.json && blocks.json.blocks && blocks.json.blocks.some((x) => x.userId === c.user.id)));

    const dm = await t.post("/api/messages", { to: c.user.id, enc: { v: 1, iv: "aa", ct: "bb" } }, { token: a.token });
    await t.expectStatus(dm, 403, "blocked pair cannot DM");

    const dmOther = await t.post("/api/messages", { to: a.user.id, enc: { v: 1, iv: "aa", ct: "bb" } }, { token: c.token });
    await t.expectStatus(dmOther, 403, "C cannot DM A after block");

    const frBlocked = await t.post("/api/friends/request", { userId: c.user.id }, { token: a.token });
    await t.expectStatus(frBlocked, 403, "cannot friend a blocked user");

    const rpt = await t.post("/api/reports", { userId: c.user.id, reason: "harassment", details: "test" }, { token: a.token });
    await t.expectStatus(rpt, 200, "file a report");
    t.check("report id returned", !!(rpt.json && rpt.json.id));
    t.hasNoSecret(rpt.json, "report response has no secrets");

    const badReason = await t.post("/api/reports", { userId: c.user.id, reason: "not-a-reason" }, { token: a.token });
    await t.expectStatus(badReason, 400, "unknown report reason");

    const mine = await t.get("/api/reports/mine", { token: a.token });
    t.check("own reports listed", !!(mine.json && mine.json.reports && mine.json.reports.length >= 1));

    const prefs = await t.put("/api/me", {
      prefs: {
        allowFriendRequests: false,
        allowMessagesFrom: "family",
        appearInSearch: false,
        shareLocationWithFriends: false
      }
    }, { token: b.token });
    await t.expectStatus(prefs, 200, "expanded privacy prefs");
    t.check("allowMessagesFrom family", prefs.json && prefs.json.user && prefs.json.user.prefs && prefs.json.user.prefs.allowMessagesFrom === "family");

    const frOff = await t.post("/api/friends/request", { userId: b.user.id }, { token: c.token });
    await t.expectStatus(frOff, [403, 400], "B is not accepting friend requests");

    const vito = await t.login("vito@familia.test", "demo123");
    if (vito) {
      const brief = await t.get("/api/families/f_demo_corleone/briefing", { token: vito.token });
      await t.expectStatus(brief, 200, "family briefing");
      t.check("briefing has roles", !!(brief.json && brief.json.briefing && Array.isArray(brief.json.briefing.roles) && brief.json.briefing.roles.length >= 4));
      t.check("briefing has youCan", !!(brief.json.briefing.youCan && brief.json.briefing.youCan.length >= 1));
      t.hasNoSecret(brief.json, "briefing has no password hashes");
    }

    const outsider = await t.register();
    if (outsider) {
      const denied = await t.get("/api/families/f_demo_corleone/briefing", { token: outsider.token });
      await t.expectStatus(denied, 403, "non-member cannot read briefing");
    }

    const unblk = await t.del("/api/blocks/" + encodeURIComponent(c.user.id), {}, { token: a.token });
    await t.expectStatus(unblk, 200, "unblock");
  }
};
