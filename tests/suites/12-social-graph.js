"use strict";

/**
 * People discovery, relationship state, message requests, QR confirm, notifications.
 * Journeys A–E. Does not auto-friend or auto-join.
 */
module.exports = {
  id: "social-graph",
  name: "People graph, QR & notifications",
  async run(t) {
    t.section("People graph, QR & notifications");

    const unauthRel = await t.get("/api/users/u_x/relationship");
    await t.expectStatus(unauthRel, 401, "relationship requires auth");
    const unauthNt = await t.get("/api/notifications");
    await t.expectStatus(unauthNt, 401, "notifications require auth");
    const unauthQr = await t.post("/api/qr/generate", { type: "profile" });
    await t.expectStatus(unauthQr, 401, "QR generate requires auth");

    const a = await t.register();
    const b = await t.register({
      name: "Findable " + Date.now().toString(36),
      email: "find." + Date.now().toString(36) + "@familia.test",
      phone: "3035550199"
    });
    const c = await t.register();
    if (!a || !b || !c) return;

    /* A — search + relationship + friend request (no auto-friend) */
    const rel0 = await t.get("/api/users/" + encodeURIComponent(b.user.id) + "/relationship", { token: a.token });
    await t.expectStatus(rel0, 200, "GET relationship");
    t.check("strangers start NONE", !!(rel0.json && rel0.json.relationship && rel0.json.relationship.state === "NONE"),
      JSON.stringify(rel0.json && rel0.json.relationship));
    t.check("label is user-facing", !!(rel0.json.relationship.label && rel0.json.relationship.label !== "NONE"));
    t.hasNoSecret(rel0.json, "relationship has no secrets");

    const byName = await t.get("/api/search?q=" + encodeURIComponent(b.creds.name.split(" ")[0]), { token: a.token });
    await t.expectStatus(byName, 200, "search by name");
    t.check("search includes relationship", ((byName.json && byName.json.users) || []).some((u) => u.relationship && u.relationship.state));

    const page = await t.get("/api/search?q=&limit=5&offset=0", { token: a.token });
    t.check("search honors limit", !!(page.json && Array.isArray(page.json.users) && page.json.users.length <= 5));

    const reqAb = await t.post("/api/friends/request", { userId: b.user.id }, { token: a.token });
    await t.expectStatus(reqAb, 200, "A friend-requests B");
    t.check("not auto-accepted", !!(reqAb.json && reqAb.json.requested && !reqAb.json.accepted));

    const relOut = await t.get("/api/users/" + encodeURIComponent(b.user.id) + "/relationship", { token: a.token });
    t.check("A sees PENDING_OUTGOING", relOut.json && relOut.json.relationship && relOut.json.relationship.state === "PENDING_OUTGOING");

    const relIn = await t.get("/api/users/" + encodeURIComponent(a.user.id) + "/relationship", { token: b.token });
    t.check("B sees PENDING_INCOMING", relIn.json && relIn.json.relationship && relIn.json.relationship.state === "PENDING_INCOMING");

    const outgoing = await t.get("/api/friends/requests", { token: a.token });
    await t.expectStatus(outgoing, 200, "GET friend requests");
    const outId = ((outgoing.json && outgoing.json.outgoing) || [])[0] && outgoing.json.outgoing[0].id;
    t.check("outgoing request id", !!outId);

    const cancel = await t.post("/api/friends/" + encodeURIComponent(outId) + "/cancel", {}, { token: a.token });
    await t.expectStatus(cancel, 200, "A cancels pending request");
    const relNone = await t.get("/api/users/" + encodeURIComponent(b.user.id) + "/relationship", { token: a.token });
    t.check("cancel returns to NONE", relNone.json && relNone.json.relationship && relNone.json.relationship.state === "NONE");

    const req2 = await t.post("/api/friends/request", { userId: b.user.id }, { token: a.token });
    const fid = req2.json && req2.json.friend && req2.json.friend.id;
    const acc = await t.post("/api/friends/" + encodeURIComponent(fid) + "/accept", {}, { token: b.token });
    await t.expectStatus(acc, 200, "B accepts A");
    const acc2 = await t.post("/api/friends/" + encodeURIComponent(fid) + "/accept", {}, { token: b.token });
    await t.expectStatus(acc2, 200, "accept is idempotent");
    t.check("idempotent already flag", !!(acc2.json && (acc2.json.already || acc2.json.ok)));
    const relF = await t.get("/api/users/" + encodeURIComponent(b.user.id) + "/relationship", { token: a.token });
    t.check("now FRIENDS", relF.json && relF.json.relationship && relF.json.relationship.state === "FRIENDS");

    /* D — notifications from friend request */
    const nts = await t.get("/api/notifications", { token: b.token });
    await t.expectStatus(nts, 200, "GET notifications");
    t.check("B has friend notification", ((nts.json && nts.json.notifications) || []).some((n) => n.type === "friend"));
    t.hasNoSecret(nts.json, "notifications have no secrets");
    const sum = await t.get("/api/notifications/summary", { token: b.token });
    t.check("notification summary unread", !!(sum.json && typeof sum.json.unread === "number"));

    /* B — message request between strangers (A is friends with B; use A↔C) */
    const dmReq = await t.post("/api/messages", { to: c.user.id, enc: { v: 1, iv: "YWE", ct: "YmI" } }, { token: a.token });
    await t.expectStatus(dmReq, 200, "stranger DM becomes request");
    t.check("requested flag, no message row", !!(dmReq.json && dmReq.json.requested) && !dmReq.json.message,
      JSON.stringify(dmReq.json));
    const empty = await t.get("/api/messages?with=" + encodeURIComponent(c.user.id), { token: a.token });
    t.check("stranger thread empty until accept", ((empty.json && empty.json.messages) || []).length === 0,
      "count " + ((empty.json && empty.json.messages) || []).length);
    const emptyC = await t.get("/api/messages?with=" + encodeURIComponent(a.user.id), { token: c.token });
    t.check("recipient stranger thread empty", ((emptyC.json && emptyC.json.messages) || []).length === 0);

    const mrs = await t.get("/api/message-requests", { token: c.token });
    await t.expectStatus(mrs, 200, "C lists message requests");
    const mrid = ((mrs.json && mrs.json.incoming) || [])[0] && mrs.json.incoming[0].id;
    t.check("incoming message request", !!mrid);
    const acceptMr = await t.post("/api/message-requests/" + encodeURIComponent(mrid) + "/accept", {}, { token: c.token });
    await t.expectStatus(acceptMr, 200, "C accepts message request");
    const thread = await t.get("/api/messages?with=" + encodeURIComponent(c.user.id), { token: a.token });
    t.check("accepted request copied into messages", ((thread.json && thread.json.messages) || []).some((m) => m.enc));

    /* privacy: findByEmail nobody */
    const emailQ = await t.get("/api/search?q=" + encodeURIComponent(b.creds.email), { token: c.token });
    t.check("email search finds by default", ((emailQ.json && emailQ.json.users) || []).some((u) => u.id === b.user.id));
    await t.put("/api/me", { prefs: { findByEmail: "nobody", findByPhone: "nobody" } }, { token: b.token });
    const emailHidden = await t.get("/api/search?q=" + encodeURIComponent(b.creds.email), { token: c.token });
    t.check("findByEmail nobody hides email hit", !((emailHidden.json && emailHidden.json.users) || []).some((u) => u.id === b.user.id));
    const plusPhone = await t.get("/api/search?q=" + encodeURIComponent("+13035550199"), { token: c.token });
    t.check("+1 phone does not leak when findByPhone nobody", !((plusPhone.json && plusPhone.json.users) || []).some((u) => u.id === b.user.id));

    const d = await t.register({ phone: "7205550100" });
    if (d) {
      const plusHit = await t.get("/api/search?q=" + encodeURIComponent("+1 720-555-0100"), { token: a.token });
      t.check("+1 search matches 10-digit phone", ((plusHit.json && plusHit.json.users) || []).some((u) => u.id === d.user.id));
    }

    /* C — profile QR: resolve, never auto-friend */
    const qr = await t.post("/api/qr/generate", { type: "profile" }, { token: b.token });
    await t.expectStatus(qr, 200, "generate profile QR");
    t.check("QR url present", !!(qr.json && qr.json.qr && qr.json.qr.url));
    t.hasNoSecret(qr.json, "QR payload has no email/phone/password");
    const resolved = await t.post("/api/qr/resolve", { token: qr.json.token }, { token: c.token });
    await t.expectStatus(resolved, 200, "resolve profile QR");
    t.check("QR confirm required", !!(resolved.json && resolved.json.confirmRequired));
    t.check("QR is profile not auto-friend", resolved.json.kind === "USER_PROFILE" || resolved.json.kind === "FRIEND_INVITE");
    const still = await t.get("/api/users/" + encodeURIComponent(b.user.id) + "/relationship", { token: c.token });
    t.check("scan did not auto-friend", still.json && still.json.relationship && still.json.relationship.state !== "FRIENDS");

    const badQr = await t.post("/api/qr/resolve", { token: "nope-not-a-token" }, { token: a.token });
    await t.expectStatus(badQr, 400, "unknown QR is 400");

    /* family invite still previews, does not auto-join */
    const fam = await t.post("/api/families", { name: "QR Fam " + Date.now().toString(36), privacy: "private" }, { token: a.token });
    const family = fam.json && fam.json.family;
    const inv = await t.post("/api/families/" + family.id + "/invite", {}, { token: a.token });
    const tok = inv.json && inv.json.token;
    const preview = await t.post("/api/qr/resolve", { token: tok }, { token: c.token });
    await t.expectStatus(preview, 200, "family invite QR resolves");
    t.check("family QR confirm required", !!(preview.json && preview.json.confirmRequired && preview.json.kind === "FAMILY_INVITE"));
    t.check("not already a member", preview.json.alreadyMember !== true);

    /* E — payment QR: confirm then (do not auto-charge) */
    const payQr = await t.post("/api/qr/generate", { type: "payment", amount: 4.5 }, { token: a.token });
    await t.expectStatus(payQr, 200, "generate payment QR");
    const payRes = await t.post("/api/qr/resolve", { token: payQr.json.token }, { token: c.token });
    await t.expectStatus(payRes, 200, "resolve payment QR");
    t.check("payment QR confirm required", !!(payRes.json && payRes.json.confirmRequired && payRes.json.kind === "PAYMENT_REQUEST"));
    t.check("payment amount preserved", Number(payRes.json.amount) === 4.5);

    const cfg = await t.get("/api/config", { token: a.token });
    t.check("config advertises people/qr/notifications", !!(cfg.json && cfg.json.people && cfg.json.qr && cfg.json.notifications));
  }
};
