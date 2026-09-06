function uiNotice(msg){
  if (window.f360 && typeof window.f360.notice === "function") return window.f360.notice(String(msg == null ? "" : msg));
  return Promise.resolve();
}

let H = {};
let session = {
  call: null,
  kind: "video",
  role: "callee",
  pc: null,
  peers: new Map(),
  localStream: null,
  livekitRoom: null,
  layer: null,
  ringTimer: null,
  audioCtx: null,
  osc: null,
  facing: "user",
  muted: false,
  camOff: false
};

export function bindCalls(bag){
  H = bag || H;
}

function cfg(){
  return (typeof window !== "undefined" && window.__serverConfig) || (H.serverConfig && H.serverConfig()) || {};
}

function iceServers(){
  const c = cfg();
  if (Array.isArray(c.iceServers) && c.iceServers.length) return c.iceServers;
  return [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ];
}

function livekitOn(){
  const c = cfg();
  return !!(c.livekit && c.livekit.enabled && c.livekit.url);
}

function makeEl(tag, props, ...kids){
  if (H.make) return H.make(tag, props || {}, ...kids);
  const el = document.createElement(tag);
  Object.assign(el, props || {});
  kids.forEach((k) => {
    if (typeof k === "string") el.appendChild(document.createTextNode(k));
    else if (k) el.appendChild(k);
  });
  return el;
}

function stopRing(){
  if (session.ringTimer) { clearInterval(session.ringTimer); session.ringTimer = null; }
  try { if (session.osc) session.osc.stop(); } catch (e) {}
  session.osc = null;
  try { if (session.audioCtx) session.audioCtx.close(); } catch (e) {}
  session.audioCtx = null;
}

function startRing(){
  stopRing();
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    session.audioCtx = ctx;
    const beep = () => {
      if (!session.audioCtx) return;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = 440;
      g.gain.value = 0.08;
      o.connect(g); g.connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.35);
      const o2 = ctx.createOscillator();
      const g2 = ctx.createGain();
      o2.type = "sine";
      o2.frequency.value = 520;
      g2.gain.value = 0.07;
      o2.connect(g2); g2.connect(ctx.destination);
      o2.start(ctx.currentTime + 0.4);
      o2.stop(ctx.currentTime + 0.75);
    };
    beep();
    session.ringTimer = setInterval(beep, 2200);
  } catch (e) {}
}

function tearMedia(){
  stopRing();
  if (session.localStream) {
    session.localStream.getTracks().forEach((t) => { try { t.stop(); } catch (e) {} });
    session.localStream = null;
  }
  session.peers.forEach((pc) => { try { pc.close(); } catch (e) {} });
  session.peers.clear();
  if (session.pc) { try { session.pc.close(); } catch (e) {} session.pc = null; }
  if (session.livekitRoom) {
    try { session.livekitRoom.disconnect(); } catch (e) {}
    session.livekitRoom = null;
  }
}

function closeLayer(){
  stopRing();
  if (session.layer && session.layer.parentNode) session.layer.parentNode.removeChild(session.layer);
  session.layer = null;
  document.body.classList.remove("in-call");
}

function setStateText(t){
  const el = session.layer && session.layer.querySelector(".call-state");
  if (el) el.textContent = t;
}

function attachStream(video, stream){
  if (!video || !stream) return;
  video.srcObject = stream;
  video.muted = video.classList.contains("call-self");
  video.playsInline = true;
  video.autoplay = true;
  const p = video.play();
  if (p && p.catch) p.catch(() => {});
}

function detectCallPlatform(){
  const ua = navigator.userAgent || "";
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isAndroid = /Android/i.test(ua);
  return {
    isIOS,
    isAndroid,
    isMobile: isIOS || isAndroid,
    isSafari: /Safari/i.test(ua) && !/Chrome|CriOS|Android/i.test(ua),
    isChrome: /Chrome|CriOS|Edg/i.test(ua)
  };
}

async function queryMediaPerm(name){
  try {
    if (!navigator.permissions || !navigator.permissions.query) return "unknown";
    const s = await navigator.permissions.query({ name });
    return s.state || "unknown";
  } catch (e) {
    return "unknown";
  }
}

function tryOpenDeviceSettings(){
  const p = detectCallPlatform();
  const urls = [];
  if (p.isIOS) urls.push("app-settings:");
  if (p.isAndroid) {
    urls.push("intent://settings#Intent;action=android.settings.APPLICATION_DETAILS_SETTINGS;scheme=package;end");
    urls.push("app-settings:");
  }
  if (!urls.length) return false;
  try {
    const a = document.createElement("a");
    a.href = urls[0];
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { try { a.remove(); } catch (e) {} }, 400);
    return true;
  } catch (e) {
    try { window.open(urls[0], "_blank"); return true; } catch (e2) { return false; }
  }
}

function showCallPermModal(opts){
  opts = opts || {};
  return new Promise((resolve) => {
    const kind = opts.kind === "audio" ? "audio" : "video";
    const blocked = !!opts.blocked;
    const need = kind === "video" ? "camera and microphone" : "microphone";
    const p = detectCallPlatform();
    const layer = document.createElement("div");
    layer.className = "popup-layer";
    layer.setAttribute("role", "dialog");
    const box = document.createElement("div");
    box.className = "popup-box";
    const kicker = document.createElement("div");
    kicker.className = "popup-kicker";
    kicker.textContent = blocked ? "Permission blocked" : "One tap to allow";
    const h = document.createElement("h3");
    h.textContent = blocked ? "Turn on " + need : (kind === "video" ? "Allow camera & mic" : "Allow microphone");
    const body = document.createElement("div");
    body.className = "popup-body";
    const msg = document.createElement("p");
    msg.className = "popup-msg";
    if (blocked) {
      if (p.isIOS) {
        msg.textContent = "iPhone Settings → Safari (or this browser) → " + (kind === "video" ? "Camera and Microphone" : "Microphone") + " → Allow. Then come back and tap Try again.";
      } else if (p.isAndroid) {
        msg.textContent = "Tap Open settings, allow " + need + " for this browser, then return here and tap Try again. You can also tap the lock icon next to the site address → Permissions.";
      } else {
        msg.textContent = "Click the lock (or camera/mic) icon in the address bar → Site settings → set " + need + " to Allow. Then tap Try again.";
      }
    } else {
      msg.textContent = "GPS FAMILIA needs the " + need + " for this call. Your browser will ask next — tap Allow. We never record the call to our servers.";
    }
    body.appendChild(msg);
    const row = document.createElement("div");
    row.className = "popup-actions";
    const cancel = document.createElement("button");
    cancel.className = "btn secondary";
    cancel.type = "button";
    cancel.textContent = "Not now";
    cancel.onclick = () => { layer.remove(); resolve("cancel"); };
    row.appendChild(cancel);
    if (blocked) {
      const open = document.createElement("button");
      open.className = "btn secondary";
      open.type = "button";
      open.textContent = "Open settings";
      open.onclick = () => {
        const opened = tryOpenDeviceSettings();
        if (!opened && !p.isMobile) {
          msg.textContent = "Use the lock icon in the address bar → Site settings → Allow " + need + ", then tap Try again.";
        }
      };
      row.appendChild(open);
    }
    const go = document.createElement("button");
    go.className = "btn";
    go.type = "button";
    go.textContent = blocked ? "Try again" : "Continue";
    go.onclick = () => { layer.remove(); resolve(blocked ? "retry" : "ok"); };
    row.appendChild(go);
    box.append(kicker, h, body, row);
    layer.appendChild(box);
    document.body.appendChild(layer);
    setTimeout(() => { try { go.focus(); } catch (e) {} }, 40);
  });
}

async function ensureCallPermissions(kind){
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    await uiNotice("This device cannot place calls.");
    return false;
  }
  const needVideo = kind === "video";
  const mic = await queryMediaPerm("microphone");
  const cam = needVideo ? await queryMediaPerm("camera") : "granted";
  if (mic === "granted" && (!needVideo || cam === "granted")) return true;

  const blocked = mic === "denied" || (needVideo && cam === "denied");
  let choice = await showCallPermModal({ kind, blocked });
  if (choice === "cancel") return false;

  async function probe(){
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: needVideo ? { facingMode: session.facing || "user" } : false
    });
    stream.getTracks().forEach((t) => { try { t.stop(); } catch (e) {} });
    return true;
  }

  try {
    return await probe();
  } catch (e) {
    const again = await showCallPermModal({ kind, blocked: true });
    if (again === "cancel") return false;
    try {
      return await probe();
    } catch (e2) {
      await uiNotice("Still blocked. Allow the " + (needVideo ? "camera and microphone" : "microphone") + " for this site, then tap the call button again.");
      return false;
    }
  }
}

async function getMedia(kind){
  const video = kind === "video" ? { facingMode: session.facing, width: { ideal: 1280 }, height: { ideal: 720 } } : false;
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video });
  session.localStream = stream;
  const self = session.layer && session.layer.querySelector(".call-self");
  if (self) {
    self.hidden = kind !== "video";
    attachStream(self, stream);
  }
  return stream;
}

function ensurePc(peerId){
  if (session.peers.has(peerId)) return session.peers.get(peerId);
  const pc = new RTCPeerConnection({ iceServers: iceServers() });
  pc._pendingIce = [];
  session.peers.set(peerId, pc);
  if (session.localStream) {
    session.localStream.getTracks().forEach((t) => pc.addTrack(t, session.localStream));
  }
  pc.onicecandidate = (ev) => {
    if (!ev.candidate || !session.call) return;
    signal({ event: "m.call.candidates", candidates: [ev.candidate.toJSON ? ev.candidate.toJSON() : ev.candidate], to: peerId });
  };
  pc.ontrack = (ev) => {
    const remote = session.layer && session.layer.querySelector(".call-remote");
    const stream = ev.streams[0] || new MediaStream([ev.track]);
    if (remote) {
      remote.hidden = false;
      attachStream(remote, stream);
    }
    setStateText("Connected");
    stopRing();
  };
  pc.onconnectionstatechange = () => {
    const st = pc.connectionState;
    if (st === "connected") { setStateText("Connected"); stopRing(); }
    if (st === "failed") { try { pc.restartIce(); } catch (e) {} setStateText("Reconnecting…"); }
    if (st === "disconnected") setStateText("Reconnecting…");
  };
  return pc;
}

function signal(body){
  if (!session.call) return;
  const pack = Object.assign({ type: "call", callId: session.call.id }, body);
  if (H.wsSend) H.wsSend(pack);
  if (H.apiTry) H.apiTry("/api/calls/" + encodeURIComponent(session.call.id) + "/signal", { method: "POST", body });
}

function callButtons(){
  const row = makeEl("div", { className: "call-actions" });
  const mk = (cls, label, title) => {
    const b = makeEl("button", { className: "call-fab " + cls, type: "button", title: title }, label);
    return b;
  };
  return { row, mk };
}

function paintLayer(opts){
  closeLayer();
  const layer = makeEl("div", { className: "call-layer", id: "call-layer" });
  const stage = makeEl("div", { className: "call-stage" });
  const remote = makeEl("video", { className: "call-remote", autoplay: true, playsInline: true });
  remote.setAttribute("playsinline", "true");
  remote.hidden = true;
  const self = makeEl("video", { className: "call-self", autoplay: true, muted: true, playsInline: true });
  self.setAttribute("playsinline", "true");
  self.muted = true;
  if (opts.kind !== "video") self.hidden = true;
  const meta = makeEl("div", { className: "call-meta" });
  const av = makeEl("div", { className: "call-avatar" });
  if (opts.avatarHtml) av.innerHTML = opts.avatarHtml;
  else av.textContent = (opts.name || "U").slice(0, 1);
  meta.append(
    av,
    makeEl("div", { className: "call-name" }, opts.name || "Family"),
    makeEl("div", { className: "call-state" }, opts.state || "Calling…")
  );
  const { row, mk } = callButtons();
  if (opts.incoming) {
    const no = mk("decline", "✕", "Decline");
    const yes = mk("accept", "✓", "Accept");
    no.onclick = () => declineCall();
    yes.onclick = () => acceptCall();
    row.append(no, yes);
  } else {
    const mute = mk("", "🔇", "Mute");
    mute.onclick = () => toggleMute(mute);
    const cam = mk("", "📷", "Camera");
    cam.hidden = opts.kind !== "video";
    cam.onclick = () => toggleCam(cam);
    const hang = mk("hang", "☎", "Hang up");
    hang.onclick = () => hangup("hangup");
    row.append(mute, cam, hang);
  }
  stage.append(remote, self, meta, row);
  layer.appendChild(stage);
  document.body.appendChild(layer);
  document.body.classList.add("in-call");
  session.layer = layer;
}

function toggleMute(btn){
  session.muted = !session.muted;
  if (session.localStream) session.localStream.getAudioTracks().forEach((t) => { t.enabled = !session.muted; });
  if (btn) btn.classList.toggle("off", session.muted);
  if (btn) btn.textContent = session.muted ? "🔈" : "🔇";
}

function toggleCam(btn){
  session.camOff = !session.camOff;
  if (session.localStream) session.localStream.getVideoTracks().forEach((t) => { t.enabled = !session.camOff; });
  if (btn) btn.classList.toggle("off", session.camOff);
  const self = session.layer && session.layer.querySelector(".call-self");
  if (self) self.style.opacity = session.camOff ? "0.25" : "1";
}

async function connectLivekit(url, token){
  const mod = await import("livekit-client");
  const Room = mod.Room;
  const RoomEvent = mod.RoomEvent;
  const room = new Room({ adaptiveStream: true, dynacast: true });
  session.livekitRoom = room;
  room.on(RoomEvent.TrackSubscribed, (track) => {
    const el = track.attach();
    if (track.kind === "video") {
      const remote = session.layer && session.layer.querySelector(".call-remote");
      if (remote) {
        remote.hidden = false;
        remote.srcObject = el.srcObject || (el.captureStream ? el.captureStream() : null);
        if (el.srcObject) attachStream(remote, el.srcObject);
        else {
          el.autoplay = true;
          el.playsInline = true;
          el.className = "call-remote";
          remote.replaceWith(el);
        }
      }
    } else {
      el.autoplay = true;
      document.body.appendChild(el);
      el.style.display = "none";
    }
    setStateText("Connected");
    stopRing();
  });
  room.on(RoomEvent.Disconnected, () => setStateText("Ended"));
  await room.connect(url, token);
  if (session.kind === "video") await room.localParticipant.enableCameraAndMicrophone();
  else await room.localParticipant.setMicrophoneEnabled(true);
  const self = session.layer && session.layer.querySelector(".call-self");
  const camPub = Array.from(room.localParticipant.videoTrackPublications.values())[0];
  if (self && camPub && camPub.track) {
    const v = camPub.track.attach();
    self.srcObject = v.srcObject;
    self.hidden = false;
  }
}

async function callerOffer(peerId){
  const pc = ensurePc(peerId);
  const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: session.kind === "video" });
  await pc.setLocalDescription(offer);
  signal({ event: "m.call.invite", sdp: pc.localDescription, to: peerId });
}

export async function startCall(opts){
  opts = opts || {};
  const s = H.currentSession && H.currentSession();
  if (!s) return uiNotice("Sign in first");
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return uiNotice("This device cannot place calls.");
  }
  const kind = opts.kind === "audio" ? "audio" : "video";
  const allowed = await ensureCallPermissions(kind);
  if (!allowed) return;
  session.kind = kind;
  session.role = "caller";
  session.facing = "user";
  session.muted = false;
  session.camOff = false;
  const other = opts.toUserId ? (H.getUserById && H.getUserById(opts.toUserId)) : null;
  const name = other ? other.name : (opts.familyId ? "Family call" : (opts.roomId ? "Group call" : "Call"));
  const avatarHtml = other && H.getAvatarFor ? H.getAvatarFor(other) : "";
  paintLayer({ kind, name, avatarHtml, state: "Calling…", incoming: false });
  startRing();
  try {
    await getMedia(kind);
  } catch (e) {
    closeLayer();
    tearMedia();
    const retry = await ensureCallPermissions(kind);
    if (!retry) return;
    paintLayer({ kind, name, avatarHtml, state: "Calling…", incoming: false });
    startRing();
    try { await getMedia(kind); } catch (e2) {
      closeLayer();
      tearMedia();
      return uiNotice("Camera / mic permission is needed for calls.");
    }
  }
  const j = await H.apiTry("/api/calls", {
    method: "POST",
    body: { kind, toUserId: opts.toUserId || null, familyId: opts.familyId || null, roomId: opts.roomId || null }
  });
  if (!j || !j.call) {
    hangup("failed");
    return uiNotice((j && j.error) || "Could not start the call.");
  }
  session.call = j.call;
  if (j.token && j.livekitUrl) {
    try {
      await connectLivekit(j.livekitUrl, j.token);
      setStateText("Waiting for them…");
      return;
    } catch (e) {
      console.warn("LiveKit connect failed, using peer-to-peer", e);
    }
  }
  const peers = (j.call.members || []).filter((id) => id !== s.userId);
  if (opts.toUserId) await callerOffer(opts.toUserId);
  else if (peers.length === 1) await callerOffer(peers[0]);
}

async function acceptCall(){
  if (!session.call) return;
  stopRing();
  setStateText("Connecting…");
  const actions = session.layer && session.layer.querySelector(".call-actions");
  if (actions) {
    actions.innerHTML = "";
    const { mk } = callButtons();
    const mute = mk("", "🔇", "Mute");
    mute.onclick = () => toggleMute(mute);
    const cam = mk("", "📷", "Camera");
    cam.hidden = session.kind !== "video";
    cam.onclick = () => toggleCam(cam);
    const hang = mk("hang", "☎", "Hang up");
    hang.onclick = () => hangup("hangup");
    actions.append(mute, cam, hang);
  }
  try {
    await getMedia(session.kind);
  } catch (e) {
    await declineCall();
    return uiNotice("Camera / mic permission is needed to answer.");
  }
  const j = await H.apiTry("/api/calls/" + encodeURIComponent(session.call.id) + "/accept", { method: "POST", body: {} });
  if (j && j.token && j.livekitUrl) {
    try {
      await connectLivekit(j.livekitUrl, j.token);
      return;
    } catch (e) {
      console.warn("LiveKit answer failed, using peer-to-peer", e);
    }
  }
  const fromId = session.call.fromId;
  const pc = ensurePc(fromId);
  const offer = (j && j.offer) || session.pendingOffer;
  if (offer) {
    await pc.setRemoteDescription(offer);
    await flushIce(pc);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    signal({ event: "m.call.answer", sdp: pc.localDescription, to: fromId });
  }
}

async function declineCall(){
  stopRing();
  if (session.call && H.apiTry) {
    await H.apiTry("/api/calls/" + encodeURIComponent(session.call.id) + "/decline", { method: "POST", body: {} });
  }
  tearMedia();
  closeLayer();
  session.call = null;
}

async function hangup(reason){
  stopRing();
  if (session.call && H.apiTry) {
    await H.apiTry("/api/calls/" + encodeURIComponent(session.call.id) + "/hangup", { method: "POST", body: { reason: reason || "hangup" } });
  }
  tearMedia();
  closeLayer();
  session.call = null;
}

export function handleCallEvent(msg){
  if (!msg || msg.type !== "call") return;
  const ev = msg.event || "";
  const me = H.currentSession && H.currentSession();
  if (!me) return;
  if (ev === "m.call.invite" && msg.fromId !== me.userId) {
    const cid = msg.callId || (msg.call && msg.call.id);
    if (session.call && session.call.id === cid) {
      if (msg.sdp) session.pendingOffer = msg.sdp;
      if (msg.sdp && session.localStream && session.role === "callee") {
        const pc = ensurePc(msg.fromId);
        if (!pc.currentRemoteDescription) {
          pc.setRemoteDescription(msg.sdp).then(async () => {
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            signal({ event: "m.call.answer", sdp: pc.localDescription, to: msg.fromId });
          }).catch(() => {});
        }
      }
      return;
    } else if (session.call) {
      return;
    } else {
      const call = msg.call || { id: msg.callId, fromId: msg.fromId, kind: msg.kind || "video", fromName: msg.fromName };
      session.call = call;
      session.kind = call.kind === "audio" ? "audio" : "video";
      session.role = "callee";
      session.pendingOffer = msg.sdp || null;
      const from = H.getUserById ? H.getUserById(call.fromId || msg.fromId) : null;
      const name = (from && from.name) || call.fromName || "Incoming call";
      const avatarHtml = from && H.getAvatarFor ? H.getAvatarFor(from) : "";
      paintLayer({ kind: session.kind, name, avatarHtml, state: session.kind === "video" ? "Incoming video call" : "Incoming voice call", incoming: true });
      startRing();
      if (H.showLocalNotification) {
        H.showLocalNotification({
          title: (session.kind === "video" ? "Video call" : "Voice call") + " · " + name,
          body: "Tap to answer in GPS FAMILIA",
          tag: "call-" + call.id,
          url: "/?call=" + call.id,
          kind: "call"
        });
      }
      if (msg.sdp) session.pendingOffer = msg.sdp;
      return;
    }
  }
  if (!session.call || (msg.callId && msg.callId !== session.call.id)) return;
  if (ev === "m.call.reject" || ev === "m.call.hangup") {
    setStateText(ev === "m.call.reject" ? "Declined" : "Ended");
    tearMedia();
    setTimeout(() => { closeLayer(); session.call = null; }, 700);
    return;
  }
  if (ev === "m.call.answer" && msg.fromId !== me.userId) {
    stopRing();
    setStateText("Connecting…");
    if (msg.sdp) {
      const pc = ensurePc(msg.fromId);
      pc.setRemoteDescription(msg.sdp).then(() => flushIce(pc)).catch(() => {});
    }
    return;
  }
  if (ev === "m.call.candidates" && Array.isArray(msg.candidates)) {
    const pc = ensurePc(msg.fromId);
    msg.candidates.forEach((c) => {
      if (!c) return;
      if (!pc.remoteDescription) { pc._pendingIce = pc._pendingIce || []; pc._pendingIce.push(c); return; }
      pc.addIceCandidate(c).catch(() => {});
    });
  }
}

async function flushIce(pc){
  const q = pc && pc._pendingIce;
  if (!q || !q.length || !pc.remoteDescription) return;
  pc._pendingIce = [];
  for (const c of q) {
    try { await pc.addIceCandidate(c); } catch (e) {}
  }
}

export function chatCallBtns(opts){
  const row = makeEl("div", { className: "chat-call-btns" });
  const aud = makeEl("button", { className: "chat-call-btn", type: "button", title: "Voice call" }, "📞");
  const vid = makeEl("button", { className: "chat-call-btn", type: "button", title: "Video call" }, "🎥");
  aud.onclick = (e) => { e.preventDefault(); e.stopPropagation(); startCall(Object.assign({}, opts, { kind: "audio" })); };
  vid.onclick = (e) => { e.preventDefault(); e.stopPropagation(); startCall(Object.assign({}, opts, { kind: "video" })); };
  row.append(aud, vid);
  return row;
}
