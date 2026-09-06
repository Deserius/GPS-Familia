"use strict";

const crypto = require("crypto");

function b64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function mintLivekitToken({ apiKey, apiSecret, identity, name, room, ttl }) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    iss: apiKey,
    sub: String(identity),
    name: name || String(identity),
    nbf: now - 10,
    exp: now + (ttl || 3600),
    jti: crypto.randomBytes(8).toString("hex"),
    video: {
      roomJoin: true,
      room: String(room),
      canPublish: true,
      canSubscribe: true,
      canPublishData: true
    }
  }));
  const sig = b64url(crypto.createHmac("sha256", apiSecret).update(header + "." + payload).digest());
  return header + "." + payload + "." + sig;
}

function mxid(user) {
  if (!user) return "@unknown:gps-familia.local";
  const local = String(user.id || "user").replace(/[^a-zA-Z0-9._=-]/g, "_");
  return `@${local}:gps-familia.local`;
}

function iceServersFromEnv() {
  const ice = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ];
  const turn = String(process.env.TURN_URL || "").trim();
  if (turn) {
    ice.push({
      urls: turn,
      username: process.env.TURN_USER || "",
      credential: process.env.TURN_PASS || ""
    });
  }
  return ice;
}

function livekitConfig() {
  const url = String(process.env.LIVEKIT_URL || "").trim();
  const apiKey = String(process.env.LIVEKIT_API_KEY || "").trim();
  const apiSecret = String(process.env.LIVEKIT_API_SECRET || "").trim();
  return { url, apiKey, apiSecret, enabled: !!(url && apiKey && apiSecret) };
}

function attachCalls(ctx) {
  const {
    app, DB, saveData, auth, makeId, now, getUser, sendToUser, DEMO,
    notifyUser
  } = ctx;

  DB.calls = Array.isArray(DB.calls) ? DB.calls : [];

  function familyOf(id) {
    return (DB.families || []).find((f) => f.id === id) || null;
  }
  function roomOf(id) {
    return (DB.rooms || []).find((r) => r.id === id) || null;
  }

  function participantsOf(body, userId) {
    const ids = new Set([userId]);
    if (body.toUserId) ids.add(String(body.toUserId));
    if (body.familyId) {
      const f = familyOf(body.familyId);
      if (f && (f.members || []).includes(userId)) (f.members || []).forEach((id) => ids.add(id));
    }
    if (body.roomId) {
      const r = roomOf(body.roomId);
      if (r && (r.members || []).includes(userId)) (r.members || []).forEach((id) => ids.add(id));
    }
    return Array.from(ids);
  }

  function inCall(call, userId) {
    if (!call || !userId) return false;
    return (call.members || []).includes(userId);
  }

  function publicCall(call, viewerId) {
    const from = getUser(call.fromId);
    const to = call.toId ? getUser(call.toId) : null;
    const lk = livekitConfig();
    return {
      id: call.id,
      call_id: call.id,
      kind: call.kind,
      fromId: call.fromId,
      fromName: from ? from.name : "Member",
      fromMxid: mxid(from),
      toId: call.toId || null,
      toName: to ? to.name : "",
      familyId: call.familyId || null,
      roomId: call.roomId || null,
      members: call.members || [],
      joined: call.joined || [],
      status: call.status,
      version: 1,
      createdAt: call.createdAt,
      media: lk.enabled ? "livekit" : "p2p",
      livekit: lk.enabled ? { url: lk.url, room: call.livekitRoom } : null,
      viewer: viewerId
    };
  }

  function emit(call, payload, exceptId) {
    const body = Object.assign({ type: "call", callId: call.id, call: publicCall(call) }, payload);
    (call.members || []).forEach((id) => {
      if (exceptId && id === exceptId) return;
      sendToUser(id, body);
    });
  }

  function pushRing(call) {
    if (typeof notifyUser !== "function") return;
    const from = getUser(call.fromId);
    const title = (call.kind === "video" ? "Video call" : "Voice call") + " · " + ((from && from.name) || "GPS FAMILIA");
    (call.members || []).forEach((id) => {
      if (id === call.fromId) return;
      notifyUser(id, {
        title,
        body: "Tap to answer in GPS FAMILIA",
        tag: "call-" + call.id,
        url: "/?call=" + call.id,
        kind: "call"
      }).catch(() => {});
    });
  }

  app.get("/api/matrix/whoami", auth, (req, res) => {
    res.json({
      ok: true,
      user_id: mxid(req.user),
      device_id: "GFWEB",
      display_name: req.user.name || "",
      phone: req.user.phone || "",
      homeserver: process.env.MATRIX_HOMESERVER || "https://gps-familia.local"
    });
  });

  app.get("/api/calls/ice", auth, (req, res) => {
    const lk = livekitConfig();
    res.json({
      ok: true,
      iceServers: iceServersFromEnv(),
      livekit: lk.enabled ? { url: lk.url } : null,
      demo: !!DEMO
    });
  });

  app.post("/api/calls", auth, (req, res) => {
    const body = req.body || {};
    const kind = body.kind === "video" ? "video" : "audio";
    const members = participantsOf(body, req.userId);
    if (members.length < 2 && !body.familyId && !body.roomId) {
      return res.status(400).json({ error: "Pick someone to call" });
    }
    if (body.toUserId && body.toUserId === req.userId) {
      return res.status(400).json({ error: "You cannot call yourself" });
    }
    if (body.familyId) {
      const f = familyOf(body.familyId);
      if (!f || !(f.members || []).includes(req.userId)) return res.status(403).json({ error: "not in that family" });
    }
    if (body.roomId) {
      const r = roomOf(body.roomId);
      if (!r || !(r.members || []).includes(req.userId)) return res.status(403).json({ error: "not in that room" });
    }
    const id = makeId("call");
    const lk = livekitConfig();
    const call = {
      id,
      kind,
      fromId: req.userId,
      toId: body.toUserId || null,
      familyId: body.familyId || null,
      roomId: body.roomId || null,
      members,
      joined: [req.userId],
      status: "ringing",
      livekitRoom: "gf-" + id,
      offer: null,
      createdAt: now()
    };
    DB.calls.push(call);
    if (DB.calls.length > 200) DB.calls = DB.calls.slice(-120);
    saveData();
    const pack = publicCall(call, req.userId);
    emit(call, {
      event: "m.call.invite",
      kind,
      fromId: req.userId,
      fromName: req.user.name,
      fromMxid: mxid(req.user)
    }, req.userId);
    pushRing(call);
    let token = null;
    if (lk.enabled) {
      token = mintLivekitToken({
        apiKey: lk.apiKey, apiSecret: lk.apiSecret,
        identity: req.userId, name: req.user.name, room: call.livekitRoom
      });
    }
    res.json({ ok: true, call: pack, token, livekitUrl: lk.enabled ? lk.url : "" });
  });

  app.get("/api/calls/:id", auth, (req, res) => {
    const call = DB.calls.find((c) => c.id === req.params.id);
    if (!call || !inCall(call, req.userId)) return res.status(404).json({ error: "call not found" });
    const lk = livekitConfig();
    let token = null;
    if (lk.enabled) {
      token = mintLivekitToken({
        apiKey: lk.apiKey, apiSecret: lk.apiSecret,
        identity: req.userId, name: req.user.name, room: call.livekitRoom
      });
    }
    res.json({ ok: true, call: publicCall(call, req.userId), token, livekitUrl: lk.enabled ? lk.url : "" });
  });

  app.post("/api/calls/:id/token", auth, (req, res) => {
    const call = DB.calls.find((c) => c.id === req.params.id);
    if (!call || !inCall(call, req.userId)) return res.status(404).json({ error: "call not found" });
    const lk = livekitConfig();
    if (!lk.enabled) return res.status(400).json({ error: "LiveKit is not configured — using peer-to-peer" });
    const token = mintLivekitToken({
      apiKey: lk.apiKey, apiSecret: lk.apiSecret,
      identity: req.userId, name: req.user.name, room: call.livekitRoom
    });
    res.json({ ok: true, token, url: lk.url, room: call.livekitRoom });
  });

  app.post("/api/calls/:id/accept", auth, (req, res) => {
    const call = DB.calls.find((c) => c.id === req.params.id);
    if (!call || !inCall(call, req.userId)) return res.status(404).json({ error: "call not found" });
    if (call.status === "ended") return res.status(410).json({ error: "call ended" });
    call.status = "active";
    call.joined = Array.from(new Set([...(call.joined || []), req.userId]));
    saveData();
    emit(call, { event: "m.call.answer", fromId: req.userId }, req.userId);
    const lk = livekitConfig();
    let token = null;
    if (lk.enabled) {
      token = mintLivekitToken({
        apiKey: lk.apiKey, apiSecret: lk.apiSecret,
        identity: req.userId, name: req.user.name, room: call.livekitRoom
      });
    }
    res.json({ ok: true, call: publicCall(call, req.userId), token, livekitUrl: lk.enabled ? lk.url : "", offer: call.offer || null });
  });

  app.post("/api/calls/:id/decline", auth, (req, res) => {
    const call = DB.calls.find((c) => c.id === req.params.id);
    if (!call || !inCall(call, req.userId)) return res.status(404).json({ error: "call not found" });
    call.status = "ended";
    call.endedAt = now();
    call.reason = "rejected";
    saveData();
    emit(call, { event: "m.call.reject", fromId: req.userId, reason: "rejected" });
    res.json({ ok: true });
  });

  app.post("/api/calls/:id/hangup", auth, (req, res) => {
    const call = DB.calls.find((c) => c.id === req.params.id);
    if (!call || !inCall(call, req.userId)) return res.status(404).json({ error: "call not found" });
    call.status = "ended";
    call.endedAt = now();
    call.reason = "hangup";
    saveData();
    emit(call, { event: "m.call.hangup", fromId: req.userId, reason: "hangup" });
    res.json({ ok: true });
  });

  app.post("/api/calls/:id/signal", auth, (req, res) => {
    const call = DB.calls.find((c) => c.id === req.params.id);
    if (!call || !inCall(call, req.userId)) return res.status(404).json({ error: "call not found" });
    const { event, sdp, candidates, to } = req.body || {};
    const ev = String(event || "m.call.candidates");
    if (sdp && (ev === "m.call.invite" || ev === "m.call.negotiate")) call.offer = sdp;
    if (sdp && ev === "m.call.answer") call.answer = sdp;
    saveData();
    const payload = {
      event: ev,
      fromId: req.userId,
      sdp: sdp || null,
      candidates: Array.isArray(candidates) ? candidates : null
    };
    if (to) sendToUser(to, Object.assign({ type: "call", callId: call.id, call: publicCall(call, to) }, payload));
    else emit(call, payload, req.userId);
    res.json({ ok: true });
  });

  function handleCallWs(sess, ws, msg) {
    if (!msg || msg.type !== "call") return false;
    const call = DB.calls.find((c) => c.id === (msg.callId || (msg.call && msg.call.id)));
    if (!call || !inCall(call, sess.userId)) return true;
    const ev = String(msg.event || "");
    if (msg.sdp && (ev === "m.call.invite" || ev === "m.call.negotiate")) call.offer = msg.sdp;
    if (msg.sdp && ev === "m.call.answer") call.answer = msg.sdp;
    const payload = {
      event: ev || "m.call.candidates",
      fromId: sess.userId,
      sdp: msg.sdp || null,
      candidates: msg.candidates || null,
      kind: call.kind
    };
    if (msg.to) sendToUser(msg.to, Object.assign({ type: "call", callId: call.id, call: publicCall(call, msg.to) }, payload));
    else emit(call, payload, sess.userId);
    return true;
  }

  return { handleCallWs, iceServersFromEnv, livekitConfig, mxid };
}

function configSnippet() {
  const lk = livekitConfig();
  return {
    calls: true,
    matrix: {
      protocol: "v1.14",
      voip: true,
      homeserver: process.env.MATRIX_HOMESERVER || "",
      local: "gps-familia.local"
    },
    livekit: { enabled: lk.enabled, url: lk.enabled ? lk.url : "" },
    iceServers: iceServersFromEnv()
  };
}

module.exports = { attachCalls, configSnippet, iceServersFromEnv, livekitConfig };
