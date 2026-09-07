"use strict";

/** Matrix whoami, ICE, call create/accept/hangup, WS m.call.* signaling. */
module.exports = {
  id: "calls",
  name: "Voice/video calling",
  async run(t) {
    t.section("Voice/video calling");

    const vito = await t.login("vito@familia.test", "demo123");
    const sonny = await t.login("sonny@familia.test", "demo123");
    const tessio = await t.login("tessio@familia.test", "demo123");
    if (!vito || !sonny || !tessio) return;

    const who = await t.get("/api/matrix/whoami", { token: vito.token });
    await t.expectStatus(who, 200, "GET /api/matrix/whoami");
    t.check("mxid shape", !!(who.json && /^@.+gps-familia\.local$/.test(who.json.user_id)), who.json && who.json.user_id);

    const ice = await t.get("/api/calls/ice", { token: vito.token });
    await t.expectStatus(ice, 200, "GET /api/calls/ice");
    t.check("STUN present", !!(ice.json && Array.isArray(ice.json.iceServers) && ice.json.iceServers.some((s) => /stun/i.test(String(s.urls || "")))));
    const stunUrls = ((ice.json && ice.json.iceServers) || []).map((s) => String(s.urls || "")).join(" ");
    t.check("Google STUN", /stun\.l\.google\.com/i.test(stunUrls));
    t.check("Cloudflare STUN", /stun\.cloudflare\.com/i.test(stunUrls));
    t.check("multiple free STUN servers", ((ice.json && ice.json.iceServers) || []).filter((s) => /stun/i.test(String(s.urls || ""))).length >= 3);

    const self = await t.post("/api/calls", { toUserId: vito.user.id, kind: "voice" }, { token: vito.token });
    await t.expectStatus(self, 400, "cannot call yourself");

    const wsS = await t.openWs(sonny.token);
    const ring = await t.post("/api/calls", { toUserId: sonny.user.id, kind: "video" }, { token: vito.token });
    await t.expectStatus(ring, 200, "Vito calls Sonny (video)");
    const call = ring.json && ring.json.call;
    t.check("call ringing", !!(call && call.status === "ringing" && call.id));
    t.check("call media p2p or livekit", !!(call && (call.media === "p2p" || call.media === "livekit")), call && call.media);

    try {
      const inv = await wsS.wait((m) => m.type === "call" && m.event === "m.call.invite", 4000);
      t.check("WS m.call.invite to callee", !!(inv && inv.callId === call.id));
    } catch (e) {
      t.fail("WS m.call.invite", e.message);
    }

    const stolen = await t.get("/api/calls/" + call.id, { token: tessio.token });
    await t.expectStatus(stolen, 404, "non-participant cannot fetch call");

    const got = await t.get("/api/calls/" + call.id, { token: sonny.token });
    await t.expectStatus(got, 200, "callee GET call");

    const ans = await t.post("/api/calls/" + call.id + "/accept", {}, { token: sonny.token });
    await t.expectStatus(ans, 200, "callee accepts");
    t.check("call active", !!(ans.json && ans.json.call && ans.json.call.status === "active"));

    const sig = await t.post("/api/calls/" + call.id + "/signal", {
      event: "m.call.candidates",
      candidates: [{ candidate: "candidate:0 1 UDP 123 1.1.1.1 3478 typ host", sdpMid: "0" }]
    }, { token: vito.token });
    await t.expectStatus(sig, 200, "signal ICE candidates");

    const hang = await t.post("/api/calls/" + call.id + "/hangup", {}, { token: vito.token });
    await t.expectStatus(hang, 200, "hangup");

    const famCall = await t.post("/api/calls", { familyId: "f_demo_corleone", kind: "voice" }, { token: vito.token });
    await t.expectStatus(famCall, 200, "family group call");
    if (famCall.json && famCall.json.call) {
      await t.post("/api/calls/" + famCall.json.call.id + "/hangup", {}, { token: vito.token });
    }

    const stranger = await t.register();
    if (stranger) {
      const deny = await t.post("/api/calls", { familyId: "f_demo_corleone", kind: "voice" }, { token: stranger.token });
      await t.expectStatus(deny, 403, "outsider cannot start Corleone call");
    }

    const tok = await t.post("/api/calls/" + (call.id) + "/token", {}, { token: sonny.token });
    t.check("LiveKit token endpoint responds", tok.status === 200 || tok.status === 400,
      tok.status === 400 ? "P2P mode (no LIVEKIT_URL) — expected" : "LiveKit JWT minted");

    wsS.close();
  }
};
