"use strict";

/** Encrypted-shaped DMs, family/room isolation, inbox, SOS, WebSocket fan-out. */
module.exports = {
  id: "realtime",
  name: "Messaging & realtime WebSocket",
  async run(t) {
    t.section("Messaging & realtime WebSocket");

    const unauth = await t.openWs("");
    let unauthCode = unauth.closeCode;
    try { if (unauthCode == null) unauthCode = await unauth.waitClose(2500); } catch (e) { unauthCode = unauth.closeCode; }
    t.check("WS without token closes unauthorized", unauthCode === 4401,
      "code=" + unauthCode + " opened=" + unauth.opened);
    unauth.close();

    const bad = await t.openWs("deadbeef");
    let badCode = bad.closeCode;
    try { if (badCode == null) badCode = await bad.waitClose(2500); } catch (e) { badCode = bad.closeCode; }
    t.check("WS junk token closes unauthorized", badCode === 4401, "code=" + badCode);
    bad.close();

    const a = await t.register();
    const b = await t.register();
    const stranger = await t.register();
    if (!a || !b || !stranger) return;

    const fam = await t.post("/api/families", { name: "QA Chat " + Date.now().toString(36), privacy: "private" }, { token: a.token });
    const family = fam.json && fam.json.family;
    const inv = await t.post("/api/families/" + family.id + "/invite", {}, { token: a.token });
    await t.post("/api/families/join", { token: inv.json.token }, { token: b.token });

    const wsA = await t.openWs(a.token);
    const wsB = await t.openWs(b.token);
    t.check("WS A connected", wsA.opened === true);
    t.check("WS B connected", wsB.opened === true);
    try {
      const helloA = await wsA.wait((m) => m.type === "hello", 3000);
      t.check("WS hello", helloA && helloA.userId === a.user.id);
    } catch (e) {
      t.fail("WS hello", e.message);
    }

    wsA.send({ type: "ping" });
    try {
      const pong = await wsA.wait((m) => m.type === "pong", 3000);
      t.check("WS ping/pong", !!(pong && pong.ts));
    } catch (e) {
      t.fail("WS ping/pong", e.message);
    }

    const enc = { iv: "dGVzdGl2MTIzNDU2", ct: "dGVzdGNpcGhlcnRleHQ" };
    const sent = await t.post("/api/messages", { to: b.user.id, enc }, { token: a.token });
    await t.expectStatus(sent, 200, "POST encrypted DM");
    t.check("stored enc, no plaintext", !!(sent.json && sent.json.message && sent.json.message.enc) && sent.json.message.text == null);

    try {
      const fan = await wsB.wait((m) => m.type === "message" && m.message && m.message.from === a.user.id, 4000);
      t.check("WS fans out DM to B", !!(fan && fan.message && fan.message.enc));
    } catch (e) {
      t.fail("WS DM fan-out", e.message);
    }

    const thread = await t.get("/api/messages?with=" + encodeURIComponent(b.user.id), { token: a.token });
    await t.expectStatus(thread, 200, "GET DM thread");
    t.check("thread contains enc message", ((thread.json && thread.json.messages) || []).some((m) => m.enc));

    const peek = await t.get("/api/messages?with=" + encodeURIComponent(a.user.id), { token: stranger.token });
    t.check("stranger DM thread empty", peek.status === 200 && ((peek.json && peek.json.messages) || []).length === 0,
      "count " + ((peek.json && peek.json.messages) || []).length);

    const famMsg = await t.post("/api/messages", { familyId: family.id, enc: { iv: "ZmFtaWx5", ct: "c2VjcmV0" } }, { token: a.token });
    await t.expectStatus(famMsg, 200, "encrypted family message");
    const famDenied = await t.get("/api/messages?family=" + family.id, { token: stranger.token });
    await t.expectStatus(famDenied, 403, "stranger cannot read family room");

    wsA.send({ type: "typing", to: b.user.id });
    try {
      const typ = await wsB.wait((m) => m.type === "typing" && m.from === a.user.id, 3000);
      t.check("WS typing indicator", !!(typ));
    } catch (e) {
      t.fail("WS typing", e.message);
    }

    wsB.send({ type: "location", lat: 39.74, lng: -104.99, kind: "live" });
    try {
      const loc = await wsA.wait((m) => m.type === "location" && m.userId === b.user.id, 4000);
      t.check("WS location broadcast to family", !!(loc && Number.isFinite(loc.lat)));
    } catch (e) {
      t.fail("WS location broadcast", e.message);
    }

    const read = await t.post("/api/messages/read", { with: a.user.id }, { token: b.token });
    await t.expectStatus(read, 200, "mark DM read");

    const inbox = await t.get("/api/inbox", { token: b.token });
    await t.expectStatus(inbox, 200, "GET /api/inbox");
    t.check("inbox has threads array", !!(inbox.json && Array.isArray(inbox.json.threads)));

    const sosNo = await t.post("/api/sos", {}, { token: stranger.token });
    await t.expectStatus(sosNo, 400, "SOS without family → 400");
    const sos = await t.post("/api/sos", {}, { token: a.token });
    await t.expectStatus(sos, 200, "SOS to family");
    t.check("SOS fan-out count", !!(sos.json && sos.json.families >= 1));
    try {
      const sosEvt = await wsB.wait((m) => m.type === "sos", 4000);
      t.check("WS SOS event", !!(sosEvt && sosEvt.message && sosEvt.message.kind === "sos"));
    } catch (e) {
      t.fail("WS SOS", e.message);
    }

    const mid = sent.json && sent.json.message && sent.json.message.id;
    if (mid) {
      const delOther = await t.del("/api/messages/" + mid, {}, { token: stranger.token });
      await t.expectStatus(delOther, 403, "stranger cannot delete DM");
      const delMine = await t.del("/api/messages/" + mid, {}, { token: a.token });
      await t.expectStatus(delMine, 200, "sender deletes DM for everyone");
    }

    wsA.close();
    wsB.close();
  }
};
