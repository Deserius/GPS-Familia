import { socialBtn, mountDemoPanel, renderCommunityFeed, renderFamilyAdmin, mountCommunityFeed } from "./ui-community.js";
import { startCall, handleCallEvent, bindCalls, chatCallBtns } from "./ui-call.js";
import { t, setLang, getLang, applyI18n } from "./i18n.js";
import { mountMarketplace } from "./ui-market.js";
import { bindPeople } from "./ui-people.js";
// Leaflet is loaded via CDN in index.html; we can reference global L once script is parsed.
// This file extends the app with: tile style toggle (street/satellite), profile images inside markers,
// persistent named places (home/school/work), and per-user location history logging + viewer.
// Production additions: server sync, WebSocket realtime, family-only location, multi-family, directory search.

const DB = {
  usersKey: "f360_users_v1",
  familiesKey: "f360_families_v1",
  sessionKey: "f360_session_v1",
  placesKey: "f360_places_v1",
  serverMsgsKey: "f360_server_msgs_v1",
  roomsKey: "f360_rooms_v1"
};

const storage = {
  get(k){ return JSON.parse(localStorage.getItem(k) || "null"); },
  set(k,v){ localStorage.setItem(k, JSON.stringify(v)); }
};

if(!storage.get(DB.usersKey)) storage.set(DB.usersKey, []);
if(!storage.get(DB.familiesKey)) storage.set(DB.familiesKey, []);
if(!storage.get(DB.placesKey)) storage.set(DB.placesKey, []);
if(!storage.get(DB.roomsKey)) storage.set(DB.roomsKey, []);

const qs = s => document.querySelector(s);
const THEME_KEY = "f360_theme";
const TRACK_KEY = "f360_track_on";
const GPS_OK_KEY = "f360_gps_ok";
function applyTheme(name){
  const allowed = ["dark", "gold", "light", "noir"];
  const t = allowed.includes(name) ? name : (localStorage.getItem(THEME_KEY) || "dark");
  document.documentElement.setAttribute("data-theme", t);
  try{ localStorage.setItem(THEME_KEY, t); }catch(e){}
  return t;
}
applyTheme();
const make = (tag, props={}, ...children) => {
  const el = document.createElement(tag);
  Object.assign(el, props);
  children.forEach(c => { if(typeof c === "string") el.appendChild(document.createTextNode(c)); else if(c) el.appendChild(c); });
  return el;
};
const uid = (prefix="id") => prefix + "_" + Math.random().toString(36).slice(2,10);
const now = () => Date.now();
const digits = s => String(s || "").replace(/\D/g, "");
function debounce(fn, ms){
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

const LEGAL_KEY = "f360_tos_v1";
const LEGAL_VERSION = "1";

function extractInviteToken(raw){
  let s = String(raw || "").trim().replace(/^["']|["']$/g, "");
  if(!s) return "";
  const looksUrl = /^https?:\/\//i.test(s) || /(?:^|[/?#&])(?:invite|token)=/.test(s) || /\/(?:invite|join)\//.test(s);
  if(looksUrl){
    try{
      const u = /^https?:\/\//i.test(s) ? new URL(s) : new URL(s, (typeof location !== "undefined" && location.origin) || "http://local.invalid");
      const q = u.searchParams.get("invite") || u.searchParams.get("token");
      if(q) s = q;
      else {
        const m = String(u.pathname || "").match(/\/(?:invite|join)\/([^/?#]+)/);
        if(m) s = decodeURIComponent(m[1]);
        else return "";
      }
    }catch(e){ return ""; }
  }
  try{ if(/%[0-9A-Fa-f]{2}/.test(s)) s = decodeURIComponent(s); }catch(e){}
  return s.replace(/\s+/g, "+").trim();
}
function pendingInviteToken(){
  try{ return extractInviteToken(sessionStorage.getItem("f360_pending_invite") || ""); }catch(e){ return ""; }
}
function clearPendingInvite(){
  try{ sessionStorage.removeItem("f360_pending_invite"); }catch(e){}
}
function captureInviteFromUrl(){
  try{
    const params = new URLSearchParams(window.location.search);
    let pre = params.get("invite") || params.get("token") || "";
    const qrTok = params.get("qr") || "";
    if(qrTok){
      try{ sessionStorage.setItem("f360_pending_qr", qrTok); }catch(e){}
    }
    if(!pre){
      const m = String(window.location.pathname || "").match(/^\/(?:invite|join)\/([^/?#]+)/);
      if(m) pre = decodeURIComponent(m[1]);
    }
    if(!qrTok){
      const qm = String(window.location.pathname || "").match(/^\/qr\/([^/?#]+)/);
      if(qm){
        try{ sessionStorage.setItem("f360_pending_qr", decodeURIComponent(qm[1])); }catch(e){}
      }
    }
    if(!pre && window.location.hash){
      try{
        const hp = new URLSearchParams(String(window.location.hash).replace(/^#/, ""));
        pre = hp.get("invite") || hp.get("token") || "";
      }catch(e){}
    }
    pre = extractInviteToken(pre || (qrTok ? "" : window.location.href));
    if(pre){
      try{ sessionStorage.setItem("f360_pending_invite", pre); }catch(e){}
    }
    if(pre || qrTok){
      try{
        const url = new URL(window.location.href);
        url.searchParams.delete("invite");
        url.searchParams.delete("token");
        url.searchParams.delete("qr");
        if(/^\/(?:invite|join)\//.test(url.pathname)) url.pathname = "/";
        if(/^\/qr\//.test(url.pathname)) url.pathname = "/";
        history.replaceState({}, "", url.pathname + url.search + url.hash);
      }catch(e){}
    }
    return pendingInviteToken();
  }catch(e){ return pendingInviteToken(); }
}


function legalTermsHtml(){
  return [
    "<p class=\"legal-lead\">Effective date: September 2, 2026. Please read these Terms of Use, Disclaimer, and Location Disclosure (the “Terms”) in full before using GPS FAMILIA. By tapping I Agree you enter a binding agreement.</p>",
    "<h4>1. Parties</h4>",
    "<p>These Terms are a contract between you (“you,” “user”) and the operator of this application, <strong>Hustler Anomalies Enterprises</strong>, together with its owners, officers, employees, contractors, affiliates, successors, licensors, and the individual developer(s) who built or maintain GPS FAMILIA (together, the “Company,” “we,” “us”). GPS FAMILIA is a family location-sharing and messaging product. References to the “Service” mean the website, progressive web app, any wrapped Android/iOS shell, APIs, maps, notifications, and related content.</p>",
    "<h4>2. Acceptance</h4>",
    "<p>You must be at least 18 years old (or the age of majority where you live) to accept these Terms. If you use the Service on behalf of a household or organization, you represent that you have authority to bind that group. If you do not agree, you must not create an account, share location, send messages, or otherwise use the Service. Continued use after we post an updated version is acceptance of the new Terms.</p>",
    "<h4>3. Nature of the Service</h4>",
    "<p>GPS FAMILIA lets consenting adults share approximate device location with people they place in a “family,” send encrypted messages, post to a community feed, and fire an SOS ping to families they belong to. The Service is a consumer convenience tool. It is <strong>not</strong> a professional monitoring service, not a child-safety product, not medical or legal advice, and not a substitute for 911, law enforcement, or any licensed emergency system.</p>",
    "<h4>4. GPS, location, and device permissions — read this</h4>",
    "<p>When you turn Track On, the Service requests access to your device’s location (GPS, Wi-Fi, cell, IP, and similar signals) and keeps recording that location — including after you leave or close the app — until you tap Track Off. That location is stored on our servers and on participating devices, shown on a map to members of families you join, written into a location history, and may be included in SOS alerts. Accuracy varies. Batteries drain faster. Maps may be wrong. Location can lag, jump, or fail indoors. On a website, the phone may pause GPS if it fully kills the tab; reopening the app resumes Track On automatically. Native Android/iOS wrappers keep GPS running in the background. You can stop sharing by turning Track Off, revoking OS location permission, or signing out. We do not promise continuous tracking. Other users’ pins appear only if you share a family with them; search never reveals a stranger’s coordinates.</p>",
    "<p>By agreeing you expressly consent to collection, storage, transmission, and display of your location as described here and in any in-app privacy notes. You understand that anyone in your families can see your live pin and history while tracking is on. You are solely responsible for who you invite.</p>",
    "<h4>5. Informed consent of every person being located</h4>",
    "<p><strong>You may not use GPS FAMILIA to locate, follow, or monitor any person who has not given informed, voluntary consent.</strong> Secret tracking, stalking, domestic surveillance of a partner, tracking minors without lawful parental authority and the child’s knowledge where required, workplace monitoring without notice, or any similar conduct is forbidden and may be a crime. You represent that every adult whose location you will view has agreed, and that you will not share another person’s location outside the Service. The Company has no duty to verify consent and is not liable if you or another user violate this rule.</p>",
    "<h4>6. Prohibited uses</h4>",
    "<p>You will not: (a) stalk, harass, threaten, or exploit anyone; (b) attempt to bypass family membership, encryption, or access controls; (c) scrape, overload, or reverse engineer the Service; (d) upload malware or illegal content; (e) impersonate others; (f) use the Service in any way that violates law, including export, privacy, wiretap, or voyeurism statutes. We may suspend accounts without notice.</p>",
    "<h4>7. Not an emergency or safety service</h4>",
    "<p>SOS is a best-effort message to family devices. It can fail if a phone is off, notifications are blocked, the network is down, or a user never opened the app. <strong>Call 911 (or your local emergency number) in a real emergency.</strong> The Company does not dispatch help, does not watch your map, and does not guarantee delivery, sound, or lock-screen display of any alert.</p>",
    "<h4>8. Accounts, passwords, and devices</h4>",
    "<p>You are responsible for your login, OTP codes, Google account, and every device that stays signed in. Notify us if you believe an account is compromised. Demo accounts and sample family members are for trying the product; do not put real secrets in them.</p>",
    "<h4>9. Messages and user content</h4>",
    "<p>Direct and family chats are encrypted on the sending device before they are stored. Encryption can fail on old browsers; SOS and some system notices are readable by design. You own content you create and grant the Company a worldwide license to host, transmit, and display it solely to operate the Service. Do not send content you do not have the right to share. We may remove content that appears unlawful.</p>",
    "<h4>10. Privacy snapshot</h4>",
    "<p>We process account identifiers (name, email, phone), family membership, messages, posts, device push-subscription endpoints, and location history as needed to run the Service. Push notifications use your browser’s push service (for example Google FCM or Apple). Map tiles come from third parties (OpenStreetMap, Esri, OpenTopoMap). Do not treat the Service as a vault for highly sensitive data.</p>",
    "<h4>11. Third-party services</h4>",
    "<p>Google Sign-In, map providers, hosting companies, SMS/email gateways, and browser push vendors are independent. Their outages, terms, and data practices are outside our control. The Company is not liable for third-party acts or omissions.</p>",
    "<h4>12. Disclaimer of warranties</h4>",
    "<p>THE SERVICE IS PROVIDED “AS IS” AND “AS AVAILABLE,” WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, QUIET ENJOYMENT, ACCURACY OF LOCATION, UNINTERRUPTED ACCESS, OR NON-INFRINGEMENT. We do not warrant that maps, messages, SOS, or notifications will be timely, complete, or error-free.</p>",
    "<h4>13. Limitation of liability — Hustler Anomalies Enterprises and associated parties</h4>",
    "<p>TO THE MAXIMUM EXTENT PERMITTED BY LAW, <strong>HUSTLER ANOMALIES ENTERPRISES, THE DEVELOPER(S), AND ALL ASSOCIATED PARTIES</strong> SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, PUNITIVE, OR PERSONAL-INJURY DAMAGES, OR FOR LOST PROFITS, LOST DATA, LOST LOCATION HISTORY, BUSINESS INTERRUPTION, COST OF SUBSTITUTE SERVICES, OR DAMAGES ARISING FROM: (A) USE OR INABILITY TO USE THE SERVICE; (B) LOCATION THAT IS WRONG, LATE, MISSING, OR SEEN BY SOMEONE YOU DID NOT INTEND; (C) FAILURE OF SOS, CHAT, OR PHONE NOTIFICATIONS; (D) UNAUTHORIZED ACCESS TO AN ACCOUNT; (E) CONDUCT OF OTHER USERS, INCLUDING STALKING OR MISUSE; (F) DEVICE, OS, NETWORK, OR THIRD-PARTY FAILURES. THIS LIMITATION APPLIES IN CONTRACT, TORT (INCLUDING NEGLIGENCE), STRICT LIABILITY, OR ANY OTHER THEORY, EVEN IF WE WERE ADVISED OF THE POSSIBILITY OF DAMAGES.</p>",
    "<p>IF ANY LIABILITY IS NEVERTHELESS IMPOSED, THE TOTAL LIABILITY OF HUSTLER ANOMALIES ENTERPRISES, THE DEVELOPER(S), AND ASSOCIATED PARTIES FOR ALL CLAIMS TOGETHER SHALL NOT EXCEED THE GREATER OF (I) TEN U.S. DOLLARS (US $10.00) OR (II) THE AMOUNT YOU PAID US FOR THE SERVICE IN THE THREE MONTHS BEFORE THE CLAIM (WHICH IS ZERO IF THE SERVICE IS FREE). SOME JURISDICTIONS DO NOT ALLOW CERTAIN LIMITATIONS; IN THOSE PLACES OUR LIABILITY IS LIMITED TO THE FULLEST EXTENT THE LAW ALLOWS. YOU ACKNOWLEDGE THAT LOCATION SHARING AND MESSAGING CARRY INHERENT RISKS AND THAT YOU USE THE SERVICE AT YOUR OWN RISK.</p>",
    "<h4>14. Release and indemnification</h4>",
    "<p>You release and will indemnify, defend, and hold harmless Hustler Anomalies Enterprises, the developer(s), and associated parties from any claim, damage, loss, or expense (including reasonable attorneys’ fees) arising out of: your use of the Service; your location sharing; content you send; your violation of these Terms or of law; or any dispute with another user or a third party. We may assume exclusive defense of any matter subject to indemnification.</p>",
    "<h4>15. Termination</h4>",
    "<p>You may stop using the Service at any time (Track Off, sign out, delete the site data). We may suspend or terminate access immediately, with or without cause. Sections that by nature should survive (including 5, 12–14, 16–18) survive termination.</p>",
    "<h4>16. Changes</h4>",
    "<p>We may modify the Service or these Terms. Material changes may be shown in-app. If you do not agree, stop using the Service. The version you accepted is stored on this device as GPS FAMILIA Terms v1.</p>",
    "<h4>17. Governing law</h4>",
    "<p>These Terms are governed by the laws of the State of Colorado, United States, without regard to conflict-of-law rules, except where your local mandatory consumer law says otherwise. Courts located in Colorado shall have exclusive jurisdiction, except that we may seek injunctive relief anywhere.</p>",
    "<h4>18. Miscellaneous</h4>",
    "<p>If a provision is unenforceable, the rest remains in effect. These Terms are the entire agreement regarding the Service and supersede prior understandings. Failure to enforce a term is not a waiver. You may not assign these Terms without our consent; we may assign them. Headings are for convenience only. No agency, partnership, or employment is created.</p>",
    "<h4>19. Contact</h4>",
    "<p>Questions about these Terms: Hustler Anomalies Enterprises — in-app Help → Terms, or the operator who hosts this copy of GPS FAMILIA. Nothing in this document is legal advice to you; it allocates risk between you and the Company.</p>"
  ].join("");
}

function hasAcceptedLegal(){
  try{
    const v = JSON.parse(localStorage.getItem(LEGAL_KEY) || "null");
    return !!(v && v.accepted === true && v.version === LEGAL_VERSION);
  }catch(e){ return false; }
}
function acceptLegal(){
  localStorage.setItem(LEGAL_KEY, JSON.stringify({ accepted: true, version: LEGAL_VERSION, at: Date.now() }));
}

function closePopupLayer(layer){
  if(layer && layer.parentNode) layer.remove();
}

function showPopup(opts){
  opts = opts || {};
  return new Promise(resolve => {
    const layer = make("div", { className: "popup-layer" + (opts.kind === "legal" ? " legal-layer" : "") });
    const box = make("div", { className: "popup-box" + (opts.wide ? " wide" : "") + (opts.kind === "legal" ? " legal-box" : "") });
    if(opts.kicker) box.appendChild(make("div", { className: "popup-kicker" }, opts.kicker));
    box.appendChild(make("h3", {}, opts.title || "GPS FAMILIA"));
    const body = make("div", { className: "popup-body" });
    if(opts.html){
      const inner = make("div", { className: "legal-scroll" });
      inner.innerHTML = opts.html;
      body.appendChild(inner);
    } else if(opts.node){
      body.appendChild(opts.node);
    } else {
      const p = make("p", { className: "popup-msg" });
      p.textContent = String(opts.message == null ? "" : opts.message);
      body.appendChild(p);
    }
    box.appendChild(body);

    let input = null;
    if(opts.kind === "prompt"){
      input = make("input", { className: "input", placeholder: opts.placeholder || "", value: opts.defaultValue || "" });
      box.appendChild(input);
    }

    let check = null;
    if(opts.requireCheck){
      const lab = make("label", { className: "legal-check" });
      check = make("input", { type: "checkbox" });
      lab.appendChild(check);
      lab.appendChild(make("span", {}, opts.checkLabel || "I have read and agree."));
      box.appendChild(lab);
    }

    const row = make("div", { className: "popup-actions" });
    let settled = false;
    function finish(val){
      if(settled) return;
      settled = true;
      document.removeEventListener("keydown", onKey);
      closePopupLayer(layer);
      resolve(val);
    }

    if(opts.kind === "confirm" || opts.kind === "legal" || opts.kind === "prompt"){
      const no = make("button", { className: "btn secondary", type: "button" }, opts.cancelText || (opts.kind === "prompt" ? "Cancel" : "No"));
      no.onclick = () => finish(opts.kind === "prompt" ? null : false);
      row.appendChild(no);
    }
    const yes = make("button", { className: "btn", type: "button" }, opts.okText || "OK");
    yes.onclick = () => {
      if(check && !check.checked){
        labPulse(check.parentElement);
        return;
      }
      if(opts.kind === "prompt") finish(input.value);
      else finish(true);
    };
    row.appendChild(yes);
    box.appendChild(row);

    function onKey(e){
      if(e.key === "Escape" && opts.kind !== "legal"){
        e.preventDefault();
        finish(opts.kind === "prompt" ? null : (opts.kind === "ok" ? true : false));
      }
      if(e.key === "Enter" && opts.kind === "prompt" && document.activeElement === input){
        e.preventDefault();
        yes.click();
      }
    }
    document.addEventListener("keydown", onKey);

    if(opts.kind !== "legal"){
      layer.addEventListener("click", (e) => { if(e.target === layer) finish(opts.kind === "prompt" ? null : (opts.kind === "ok" ? true : false)); });
    }
    layer.appendChild(box);
    document.body.appendChild(layer);
    setTimeout(() => {
      const f = input || layer.querySelector("button.btn:not(.secondary), input, button");
      if(f) try{ f.focus(); }catch(e){}
    }, 40);
  });
}

function labPulse(el){
  if(!el) return;
  el.classList.remove("need-check");
  void el.offsetWidth;
  el.classList.add("need-check");
}

function notice(message, title){
  return showPopup({ kind: "ok", message: String(message == null ? "" : message), title: title || "GPS FAMILIA" });
}
function ask(message, title){
  return showPopup({ kind: "confirm", message: String(message == null ? "" : message), title: title || "Confirm", okText: "Yes", cancelText: "No" });
}
function askText(message, def){
  return showPopup({ kind: "prompt", message: String(message == null ? "" : message), title: "Enter", defaultValue: def || "", okText: "Continue", cancelText: "Cancel" });
}

window.alert = function(msg){ return notice(String(msg == null ? "" : msg)); };

async function showLegalGate(){
  if(hasAcceptedLegal()) return true;
  while(true){
    const ok = await showPopup({
      kind: "legal",
      wide: true,
      title: "Terms of Use & Disclaimer",
      kicker: "Hustler Anomalies Enterprises",
      html: legalTermsHtml(),
      requireCheck: true,
      checkLabel: "I am 18+, I have read these Terms, and I agree.",
      okText: "I Agree",
      cancelText: "I Do Not Agree"
    });
    if(ok){
      acceptLegal();
      return true;
    }
    await notice("You must accept the Terms of Use to use GPS FAMILIA. Without that agreement we cannot provide the service.");
  }
}
function currentSession(){ return storage.get(DB.sessionKey); }
function setSession(s){
  storage.set(DB.sessionKey, s);
  updateUIForSession();
  updateInboxBadge();
  updateProfileThumb();
  if(s && s.sessionToken){ connectRealtime(); syncFromServer(); }
  else { persistTrack(false); }
}

let serverOk = false;
let socket = null;
let socketTimer = null;
let openChatUserId = null;
let openChatFamilyId = null;
let openChatRoomId = null;
let serverConfig = { otpEcho: true, googleClientId: "" };
function applyServerConfig(j){
  if(j) serverConfig = Object.assign(serverConfig, j);
  window.__serverConfig = serverConfig;
  return serverConfig;
}

function updateLivePill(){
  const el = qs("#live-pill");
  if(!el) return;
  const on = !!(socket && socket.readyState === 1);
  el.textContent = on ? t("footer.live") : (serverOk ? "online" : t("footer.offline"));
  el.classList.toggle("on", on);
}

async function api(path, opts = {}) {
  const headers = Object.assign({ "content-type": "application/json" }, opts.headers || {});
  const s = currentSession();
  const token = (s && s.sessionToken) || localStorage.getItem("f360_otpsess") || "";
  if(token) headers["authorization"] = "Bearer " + token;
  const res = await fetch(path, {
    method: opts.method || "GET",
    headers,
    body: opts.body != null ? JSON.stringify(opts.body) : undefined
  });
  const j = await res.json().catch(() => ({}));
  if(!res.ok){
    const err = new Error((j && j.error) || res.statusText || "request failed");
    err.status = res.status;
    err.body = j;
    throw err;
  }
  serverOk = true;
  return j;
}
async function apiTry(path, opts){
  try { return await api(path, opts); }
  catch(e){ if(e && e.status !== 401) serverOk = false; console.warn("api", path, e && e.message); return null; }
}
async function apiCatch(path, opts){
  try { return await api(path, opts); }
  catch(e){
    if(e && e.body && typeof e.body === "object") return e.body;
    return { error: (e && e.message) || "request failed" };
  }
}
async function previewInvite(token){
  const tok = extractInviteToken(token);
  if(!tok) return { error: "Paste the invite link, QR URL, or token." };
  let j = await apiCatch("/api/invite/preview", { method:"POST", body: { token: tok } });
  if(!j || !j.ok) j = await apiCatch("/api/invite/preview?token=" + encodeURIComponent(tok));
  if(j && j.ok && !j.token) j.token = tok;
  return j || { error: "invalid invite" };
}
async function openInviteFromRaw(raw){
  const token = extractInviteToken(raw);
  if(!token){ await notice("Paste the invite link, QR URL, or token."); return false; }
  const prev = await previewInvite(token);
  if(prev && prev.ok){
    closeModal();
    await showInvitePreview(prev);
    return true;
  }
  await notice((prev && prev.error) || "That invite is not valid. Ask them to send a fresh QR or link.");
  return false;
}
async function decodeQrFromVideo(video){
  try{
    if("BarcodeDetector" in window){
      const det = new BarcodeDetector({ formats: ["qr_code"] });
      const codes = await det.detect(video);
      if(codes && codes[0] && codes[0].rawValue) return codes[0].rawValue;
    }
  }catch(e){}
  try{
    if(!video.videoWidth) return "";
    if(!decodeQrFromVideo._jsqr){
      const mod = await import("https://esm.sh/jsqr@1.4.0");
      decodeQrFromVideo._jsqr = mod.default || mod;
    }
    const w = video.videoWidth, h = video.videoHeight;
    const canvas = decodeQrFromVideo._c || (decodeQrFromVideo._c = document.createElement("canvas"));
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    const r = decodeQrFromVideo._jsqr(img.data, w, h);
    return (r && r.data) || "";
  }catch(e){ return ""; }
}
async function decodeQrFromFile(file){
  if(!file) return "";
  const url = URL.createObjectURL(file);
  try{
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });
    if("BarcodeDetector" in window){
      try{
        const det = new BarcodeDetector({ formats: ["qr_code"] });
        const codes = await det.detect(img);
        if(codes && codes[0] && codes[0].rawValue) return codes[0].rawValue;
      }catch(e){}
    }
    const mod = await import("https://esm.sh/jsqr@1.4.0");
    const jsQR = mod.default || mod;
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const r = jsQR(data.data, canvas.width, canvas.height);
    return (r && r.data) || "";
  }catch(e){ return ""; }
  finally { try{ URL.revokeObjectURL(url); }catch(e){} }
}
async function scanInviteFromCamera(){
  if(navigator.mediaDevices && navigator.mediaDevices.getUserMedia){
    return await new Promise((resolve) => {
      const layer = document.createElement("div");
      layer.className = "modal-backdrop";
      layer.style.cssText = "position:fixed;inset:0;z-index:80;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:16px";
      const box = document.createElement("div");
      box.className = "modal form-shell";
      box.style.cssText = "width:min(92vw,380px);display:flex;flex-direction:column;gap:10px";
      const h = document.createElement("h3");
      h.textContent = "Scan family QR";
      const hint = document.createElement("p");
      hint.className = "small-muted";
      hint.textContent = "Point the camera at the invite QR.";
      box.append(h, hint);
      const video = document.createElement("video");
      video.setAttribute("playsinline", "");
      video.setAttribute("muted", "");
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      video.style.cssText = "width:100%;max-height:280px;border-radius:12px;background:#000;object-fit:cover";
      const status = document.createElement("div");
      status.className = "small-muted";
      status.textContent = "Looking for a QR…";
      const row = document.createElement("div");
      row.className = "row";
      row.style.cssText = "justify-content:flex-end;gap:8px;flex-wrap:wrap";
      const fileBtn = document.createElement("button");
      fileBtn.className = "btn small secondary";
      fileBtn.type = "button";
      fileBtn.textContent = "Use photo";
      const cancel = document.createElement("button");
      cancel.className = "btn small secondary";
      cancel.type = "button";
      cancel.textContent = "Cancel";
      row.append(fileBtn, cancel);
      box.append(video, status, row);
      layer.appendChild(box);
      document.body.appendChild(layer);
      let stream = null, timer = null, done = false;
      const finish = (tok) => {
        if(done) return;
        done = true;
        clearInterval(timer);
        try{ if(stream) stream.getTracks().forEach((tr) => tr.stop()); }catch(e){}
        try{ layer.remove(); }catch(e){}
        resolve(extractInviteToken(tok || "") || String(tok || ""));
      };
      cancel.onclick = () => finish("");
      fileBtn.onclick = async () => {
        if(done) return;
        done = true;
        clearInterval(timer);
        try{ if(stream) stream.getTracks().forEach((tr) => tr.stop()); }catch(e){}
        try{ layer.remove(); }catch(e){}
        resolve(await pickInvitePhoto());
      };
      (async () => {
        try{
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
          video.srcObject = stream;
          await video.play().catch(()=>{});
          timer = setInterval(async () => {
            if(done) return;
            const raw = await decodeQrFromVideo(video);
            const tok = extractInviteToken(raw);
            if(tok) finish(tok);
          }, 450);
        }catch(e){
          status.textContent = "Camera blocked — use a photo or paste the link.";
        }
      })();
    });
  }
  return pickInvitePhoto();
}
async function pickInvitePhoto(){
  const file = await new Promise((resolve) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "image/*";
    inp.setAttribute("capture", "environment");
    inp.onchange = () => resolve((inp.files && inp.files[0]) || null);
    inp.click();
  });
  if(!file) return "";
  const raw = await decodeQrFromFile(file);
  return extractInviteToken(raw) || raw || "";
}

function urlBase64ToUint8Array(base64String){
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function enablePush(){
  if(!currentSession() || !currentSession().sessionToken) return;
  if(!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
  try{
    let perm = Notification.permission;
    if(perm === "default") perm = await Notification.requestPermission();
    if(perm !== "granted") return;
    if(!serverConfig.vapidPublic){
      const j = await apiTry("/api/config");
      if(j) applyServerConfig(j);
    }
    const reg = await navigator.serviceWorker.ready;
    if(serverConfig.vapidPublic){
      let sub = await reg.pushManager.getSubscription();
      if(!sub){
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(serverConfig.vapidPublic)
        });
      }
      await apiTry("/api/push/subscribe", { method:"POST", body: { subscription: sub.toJSON() } });
    }
  }catch(e){ console.warn("push", e && e.message); }
}

async function ensureAlertPermission(opts){
  opts = opts || {};
  if(!currentSession()) return false;
  if(!("Notification" in window)){
    if(!opts.quiet) await notice("This browser cannot put GPS FAMILIA on the lock screen. Add the app to your Home Screen, or use the Android/iOS wrapper, so family messages, SOS, and app mail still arrive.");
    return false;
  }
  if(Notification.permission === "granted"){
    await enablePush();
    return true;
  }
  if(Notification.permission === "denied"){
    if(!opts.quiet) await notice("Phone alerts are blocked. Open this phone’s Settings → GPS FAMILIA (or the browser) → Notifications and turn them on so family messages, SOS, and app mail hit the lock screen even when the app is closed.");
    return false;
  }
  const ok = await showPopup({
    kind: "confirm",
    title: "Turn on phone alerts",
    kicker: "Messages · SOS · Mail",
    message: "GPS FAMILIA needs permission to put family messages, SOS pings, and app mail on this phone’s lock screen — the same place texts appear — even when the app is closed.\n\nTap Allow on the next system prompt so nothing waits until you reopen the app.",
    okText: "Allow alerts",
    cancelText: "Not now"
  });
  if(!ok) return false;
  let perm = Notification.permission;
  try{ perm = await Notification.requestPermission(); }catch(e){}
  if(perm !== "granted"){
    await notice("Alerts were not allowed. You can still use the app. Turn notifications on later in Help → Phone alerts, or in this phone’s Settings.");
    return false;
  }
  await enablePush();
  return true;
}

async function afterSignIn(opts){
  opts = opts || {};
  closeAllModals();
  updateUIForSession();
  await consumePendingInvite();
  if(opts.created) await runSignupPermissions();
  else {
    await ensureAlertPermission();
    resumeOrOfferTracking();
  }
}

async function runSignupPermissions(){
  if(!currentSession()) return;
  const ok = await showPopup({
    kind: "confirm",
    wide: true,
    title: "Turn on location, alerts, and camera",
    kicker: "New account",
    message: "GPS FAMILIA needs this phone’s location (family pins), lock-screen alerts (messages and SOS), and camera/mic (calls and profile photos). Browsers cannot turn these on silently — you will see the system Allow prompts next. Tracking starts after you continue.",
    okText: "Continue",
    cancelText: "Not now"
  });
  if(!ok){
    resumeOrOfferTracking();
    return;
  }
  try{
    if(navigator.mediaDevices && navigator.mediaDevices.getUserMedia){
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      (stream.getTracks() || []).forEach((tr) => { try{ tr.stop(); }catch(e){} });
    }
  }catch(e){}
  await ensureAlertPermission({ quiet: true });
  setGpsConsent();
  persistTrack(true);
  startTracking();
}

async function consumePendingInvite(){
  let qrPending = "";
  try{ qrPending = sessionStorage.getItem("f360_pending_qr") || ""; }catch(e){}
  if(qrPending && currentSession() && window.f360 && typeof window.f360.routeQr === "function"){
    try{ sessionStorage.removeItem("f360_pending_qr"); }catch(e){}
    await window.f360.routeQr(qrPending);
  }
  const token = extractInviteToken(pendingInviteToken());
  if(!token || !currentSession()) return false;
  const j = await previewInvite(token);
  if(!j || !j.ok){
    const net = !!(j && /failed|network|fetch|request failed/i.test(String(j.error || "")));
    if(!net) clearPendingInvite();
    await notice((j && j.error) || "That invite is no longer valid. You can still create or join a family from the menu.");
    return false;
  }
  await showInvitePreview(j);
  return true;
}

function showInvitePreview(j){
  return new Promise((resolve) => {
    const wrap = make("div");
    wrap.appendChild(make("div",{className:"help-kicker"}, j.alreadyMember ? "Your family" : "Family invite"));
    wrap.appendChild(make("h3",{}, (j.family && j.family.name) || "Family"));
    if(j.invitedBy && j.invitedBy.name){
      wrap.appendChild(make("p",{}, j.alreadyMember
        ? ("You already belong. " + j.invitedBy.name + " invited you to this family.")
        : (j.invitedBy.name + " invited you. Review the members, roles, and rules, then Accept or Decline.")));
    } else {
      wrap.appendChild(make("p",{}, j.alreadyMember
        ? "You already belong to this family."
        : "Review who is in this family, their roles, and the rules before you accept."));
    }
    if(j.members && j.members.length){
      wrap.appendChild(make("h4",{}, "Members"));
      const ul = make("ul");
      j.members.forEach((m) => {
        ul.appendChild(make("li",{}, (m.name || "Member") + " — " + (m.roleLabel || m.role || "Member") + (m.isHead ? " (Head)" : "")));
      });
      wrap.appendChild(ul);
    }
    const b = j.briefing || {};
    if(b.youCan && b.youCan.length){
      wrap.appendChild(make("h4",{}, j.alreadyMember ? "Your privileges" : "If you join as Member"));
      const ul = make("ul");
      b.youCan.forEach((line) => ul.appendChild(make("li",{}, line)));
      wrap.appendChild(ul);
    }
    if(b.theyCan && b.theyCan.length){
      wrap.appendChild(make("h4",{}, "Family rules"));
      const ul = make("ul");
      b.theyCan.forEach((line) => ul.appendChild(make("li",{}, line)));
      wrap.appendChild(ul);
    }
    if((j.roles || b.roles || []).length){
      wrap.appendChild(make("h4",{}, "Roles in this family"));
      const ul = make("ul");
      (j.roles || b.roles).forEach((r) => {
        const n = Object.keys(r.privileges || {}).filter((k) => r.privileges[k]).length;
        ul.appendChild(make("li",{}, (r.label || r.key) + " — " + n + " privileges"));
      });
      wrap.appendChild(ul);
    }
    if(b.note) wrap.appendChild(make("div",{className:"help-callout"}, b.note));
    const row = make("div",{className:"row", style:"margin-top:12px;justify-content:flex-end;gap:8px;flex-wrap:wrap"});
    function done(){
      closeModal();
      resolve(true);
    }
    if(j.alreadyMember){
      const ok = make("button",{className:"btn", type:"button"}, "I understand");
      ok.onclick = () => { clearPendingInvite(); done(); };
      row.appendChild(ok);
    } else {
      const no = make("button",{className:"btn secondary", type:"button"}, "Decline");
      no.onclick = async () => {
        clearPendingInvite();
        await notice("Invite declined. You did not join this family.");
        done();
      };
      const yes = make("button",{className:"btn", type:"button"}, "Accept");
      yes.onclick = async () => {
        yes.disabled = true;
        const tok = extractInviteToken(j.token || pendingInviteToken());
        const joined = await apiCatch("/api/families/join", { method:"POST", body: { token: tok } });
        clearPendingInvite();
        if(joined && joined.family){
          cacheFamily(joined.family);
          updateFamilyMarkers();
          closeModal();
          if(joined.briefing) showFamilyBriefing(joined.briefing);
          resolve(true);
          return;
        }
        await notice((joined && joined.error) || "Could not join. The invite may have expired.");
        done();
      };
      row.append(no, yes);
    }
    wrap.appendChild(row);
    showModal(wrap, { variant: "form" });
  });
}

function resumeOrOfferTracking(){
  if(!currentSession()) return;
  if(isTrackPersisted()) startTracking({ resume: true });
  else if(!hasGpsConsent()) renderDisclaimer(() => startTracking());
}

function persistTrack(on){
  try{ localStorage.setItem(TRACK_KEY, on ? "1" : "0"); }catch(e){}
}
function isTrackPersisted(){
  try{ return localStorage.getItem(TRACK_KEY) === "1"; }catch(e){ return false; }
}
function hasGpsConsent(){
  try{ return localStorage.getItem(GPS_OK_KEY) === "1"; }catch(e){ return false; }
}
function setGpsConsent(){
  try{ localStorage.setItem(GPS_OK_KEY, "1"); }catch(e){}
}

async function showLocalNotification(n){
  if(!("Notification" in window) || Notification.permission !== "granted") return;
  try{
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(n.title, {
      body: n.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: n.tag || "familia",
      renotify: true,
      vibrate: n.kind === "sos" ? [200,80,200,80,400] : n.kind === "call" ? [400,160,400,160,400,160,800] : [140,70,140],
      data: { url: n.url || "/" },
      requireInteraction: n.kind === "sos" || n.kind === "call"
    });
  }catch(e){
    try{ new Notification(n.title, { body: n.body, icon: "/icon-192.png", tag: n.tag }); }catch(e2){}
  }
}

function maybeNotifyIncoming(m){
  if(!m) return;
  const s = currentSession();
  if(!s || m.from === s.userId) return;
  const viewing =
    (openChatUserId && !m.familyId && !m.roomId && (m.from === openChatUserId || m.to === openChatUserId)) ||
    (openChatFamilyId && m.familyId === openChatFamilyId) ||
    (openChatRoomId && m.roomId === openChatRoomId);
  if(viewing && !document.hidden) return;
  const from = getUserById(m.from);
  const title = m.kind === "sos" ? ("SOS · " + ((from && from.name) || "Family")) : ((from && from.name) || "GPS FAMILIA");
  const body = m.kind === "sos" ? (m.text || "Emergency alert") : (m.enc ? "New encrypted message" : (m.text || "New message"));
  const url = m.roomId ? ("/?room=" + m.roomId) : (m.familyId ? ("/?family=" + m.familyId) : ("/?chat=" + m.from));
  const tag = m.roomId ? ("room-" + m.roomId) : (m.familyId ? ("fam-" + m.familyId) : ("chat-" + m.from));
  showLocalNotification({ title, body, tag, url, kind: m.kind || "chat" });
}

function openFromNotificationUrl(raw){
  try{
    const u = new URL(raw, location.origin);
    const chat = u.searchParams.get("chat");
    const fam = u.searchParams.get("family");
    const room = u.searchParams.get("room");
    const post = u.searchParams.get("post");
    const call = u.searchParams.get("call");
    if(chat){ closeModal(); renderMessagesForUser(chat); }
    else if(fam){ closeModal(); renderFamilyChat(fam); }
    else if(room){ closeModal(); renderRoomChat(room); }
    else if(post){ closeModal(); openFeedPanel({ postId: post }); }
    else if(call){
      apiTry("/api/calls/" + encodeURIComponent(call)).then(j => {
        if(j && j.call && j.call.status !== "ended"){
          handleCallEvent({ type:"call", event:"m.call.invite", callId: j.call.id, call: j.call, fromId: j.call.fromId, kind: j.call.kind, fromName: j.call.fromName });
        }
      });
    }
  }catch(e){}
}

function connectRealtime(){
  const s = currentSession();
  if(!s || !s.sessionToken) return;
  try{
    if(socket && (socket.readyState === 0 || socket.readyState === 1)) return;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/ws?token=${encodeURIComponent(s.sessionToken)}`);
    socket = ws;
    ws.onopen = () => { serverOk = true; updateLivePill(); };
    ws.onmessage = (ev) => {
      let msg; try{ msg = JSON.parse(ev.data); }catch(e){ return; }
      handleRealtime(msg);
    };
    ws.onclose = () => {
      socket = null;
      updateLivePill();
      clearTimeout(socketTimer);
      socketTimer = setTimeout(connectRealtime, 2500);
    };
    ws.onerror = () => { try{ ws.close(); }catch(e){} };
  }catch(e){ console.warn("ws", e); }
}

function wsSend(obj){
  if(socket && socket.readyState === 1){
    try{ socket.send(JSON.stringify(obj)); }catch(e){}
  }
}

function handleRealtime(msg){
  if(!msg || !msg.type) return;
  if(msg.type === "location"){
    applyRemoteLocation(msg.userId, msg.lat, msg.lng, msg.ts);
    } else if(msg.type === "message" && msg.message){
    upsertServerMessage(msg.message);
    updateInboxBadge();
    if(typeof window.__refreshInbox === "function") window.__refreshInbox();
    const mm = msg.message;
    const inOpen =
      (openChatUserId && !mm.familyId && !mm.roomId && (mm.from === openChatUserId || mm.to === openChatUserId)) ||
      (openChatFamilyId && mm.familyId === openChatFamilyId) ||
      (openChatRoomId && mm.roomId === openChatRoomId);
    if(inOpen && typeof window.__refreshOpenChat === "function") window.__refreshOpenChat();
    maybeNotifyIncoming(msg.message);
  } else if(msg.type === "sos" && msg.message){
    upsertServerMessage(msg.message);
    updateInboxBadge();
    if(openChatFamilyId && msg.message.familyId === openChatFamilyId && typeof window.__refreshOpenChat === "function"){
      window.__refreshOpenChat();
    }
    maybeNotifyIncoming(msg.message);
  } else if(msg.type === "family"){
    syncFromServer();
  } else if(msg.type === "typing"){
    const typingHere =
      (openChatUserId && msg.from === openChatUserId && !msg.familyId && !msg.roomId) ||
      (openChatFamilyId && msg.familyId === openChatFamilyId) ||
      (openChatRoomId && msg.roomId === openChatRoomId);
    if(typingHere && typeof window.__showTyping === "function") window.__showTyping();
  } else if(msg.type === "room"){
    if(msg.room) cacheRoom(msg.room);
    if(typeof window.__refreshInbox === "function") window.__refreshInbox();
    syncFromServer();
  } else if(msg.type === "presence"){
    const u = getUserById(msg.userId);
    if(u){ u.online = msg.online; saveUser(u); updateFamilyMarkers(); }
  } else if(msg.type === "call"){
    handleCallEvent(msg);
  } else if(msg.type === "join_request"){
    updateInboxBadge();
  } else if(msg.type === "friend"){
    updateInboxBadge();
    if(typeof window.__refreshPeople === "function") window.__refreshPeople();
    if(msg.action === "request"){
      showLocalNotification({ title: "Friend request", body: (msg.name || "Someone") + " wants to be friends", url: "/?people=friends", tag: "friend-" + (msg.id || "") });
    }
  } else if(msg.type === "notification"){
    updateInboxBadge();
    const n = msg.notification || {};
    showLocalNotification({ title: n.title || "Notification", body: n.body || "", url: n.url || "/", tag: n.id || ("nt-" + Date.now()) });
  } else if(msg.type === "message_request"){
    updateInboxBadge();
    showLocalNotification({ title: "Message request", body: (msg.name || "Someone") + " sent a message request", url: "/?inbox=1", tag: "mr-" + (msg.id || "") });
  } else if(msg.type === "market"){
    if(typeof window.__refreshMarket === "function") window.__refreshMarket(msg);
    if(msg.action === "offer"){
      showLocalNotification({ title: "Marketplace offer", body: "Someone offered on your listing", url: "/?market=1", tag: "mkt-" + (msg.listingId || "") });
    }
  } else if(msg.type === "message_deleted" && msg.id){
    removeLocalMessage(msg.id);
    if(typeof window.__refreshOpenChat === "function") window.__refreshOpenChat();
    updateInboxBadge();
  } else if(msg.type === "profile"){
    syncFromServer();
  } else if(msg.type === "feed"){
    if(typeof window.__refreshFeed === "function") window.__refreshFeed(msg);
    const s = currentSession();
    if(msg.action === "new" && msg.post && s && msg.post.authorId !== s.userId){
      const panel = qs("#feed-panel");
      const viewing = panel && panel.classList.contains("open") && !document.hidden;
      if(!viewing){
        showLocalNotification({
          title: (msg.post.authorName || "Family") + " posted",
          body: msg.post.text || "New photo or video in the feed",
          url: "/?post=" + msg.post.id,
          tag: "feed-" + msg.post.id,
          kind: "feed"
        });
      }
    }
  }
}

function isFamilyWith(userId){
  const s = currentSession();
  if(!s) return false;
  if(s.userId === userId) return true;
  const families = storage.get(DB.familiesKey) || [];
  return families.some(f => Array.isArray(f.members) && f.members.includes(s.userId) && f.members.includes(userId));
}

function myFamilies(){
  const s = currentSession();
  if(!s) return [];
  return (storage.get(DB.familiesKey) || []).filter(f => Array.isArray(f.members) && f.members.includes(s.userId));
}

function applyRemoteLocation(userId, lat, lng, ts){
  const s = currentSession();
  if(!s) return;
  if(userId !== s.userId && !isFamilyWith(userId)) return;
  let u = getUserById(userId);
  if(!u){
    u = { id: userId, name: "Family member", locationHistory: [] };
  }
  u.lastLocation = { lat, lng, ts: ts || now() };
  saveUser(u);
  updateFamilyMarkers();
}

function removeLocalMessage(id){
  if(!id) return;
  const drop = (key) => {
    const list = storage.get(key) || [];
    const next = list.filter(x => x.id !== id);
    if(next.length !== list.length) storage.set(key, next);
  };
  drop(DB.serverMsgsKey);
  drop(MSG_KEY);
}

function upsertServerMessage(m){
  if(!m || !m.id) return;
  const list = storage.get(DB.serverMsgsKey) || [];
  if(!list.find(x => x.id === m.id)){
    list.push(m);
    storage.set(DB.serverMsgsKey, list);
  }
  if(m.enc){
    const local = storage.get(MSG_KEY) || [];
    if(!local.find(x => x.id === m.id)){
      local.push({ id: m.id, from: m.from, to: m.to, familyId: m.familyId, roomId: m.roomId, enc: m.enc, ts: m.ts });
      storage.set(MSG_KEY, local);
    }
  }
}

function cacheUserFromServer(su){
  if(!su || !su.id) return;
  const users = storage.get(DB.usersKey) || [];
  const i = users.findIndex(x => x.id === su.id);
  const prev = i >= 0 ? users[i] : {};
  const merged = Object.assign({}, prev, {
    id: su.id,
    name: su.name || prev.name,
    email: su.email != null ? su.email : prev.email,
    phone: su.phone != null ? su.phone : prev.phone,
    online: su.online,
    inFamily: su.inFamily
  });
  if(su.lastLocation) merged.lastLocation = su.lastLocation;
  else if(!isFamilyWith(su.id) && currentSession()?.userId !== su.id){
    delete merged.lastLocation;
    delete merged.locationHistory;
  }
  if(su.appearOnMap === false && currentSession()?.userId !== su.id){
    delete merged.lastLocation;
  }
  if(su.locationHistory) merged.locationHistory = su.locationHistory;
  if(su.prefs) merged.prefs = su.prefs;
  if(su.appearOnMap != null) merged.appearOnMap = su.appearOnMap;
  if(su.profileImage){
    saveProfileImageForUser(su.id, su.profileImage);
    merged.profileImage = su.profileImage;
  }
  if(i >= 0) users[i] = merged; else users.push(merged);
  storage.set(DB.usersKey, users);
}

function cacheFamily(f){
  if(!f || !f.id) return;
  const families = storage.get(DB.familiesKey) || [];
  const i = families.findIndex(x => x.id === f.id);
  if(i >= 0) families[i] = Object.assign({}, families[i], f);
  else families.push(f);
  storage.set(DB.familiesKey, families);
}

function cacheRoom(r){
  if(!r || !r.id) return;
  const rooms = storage.get(DB.roomsKey) || [];
  const i = rooms.findIndex(x => x.id === r.id);
  if(i >= 0) rooms[i] = Object.assign({}, rooms[i], r);
  else rooms.push(r);
  storage.set(DB.roomsKey, rooms);
}

function myRooms(){
  const s = currentSession();
  if(!s) return [];
  return (storage.get(DB.roomsKey) || []).filter(r => Array.isArray(r.members) ? r.members.includes(s.userId) : r.isMember);
}

async function syncFromServer(){
  const j = await apiTry("/api/sync");
  if(!j) return;
  const s = currentSession();
  const allowed = new Set((j.users || []).map(u => u.id));
  (j.users || []).forEach(cacheUserFromServer);
  let users = storage.get(DB.usersKey) || [];
  users = users.map(u => {
    if(s && u.id === s.userId) return u;
    if(!allowed.has(u.id) && u.lastLocation){
      const copy = Object.assign({}, u);
      delete copy.lastLocation;
      delete copy.locationHistory;
      return copy;
    }
    return u;
  });
  storage.set(DB.usersKey, users);
  (j.families || []).forEach(cacheFamily);
  (j.rooms || []).forEach(cacheRoom);
  if(j.messages) storage.set(DB.serverMsgsKey, j.messages);
  if(j.places) { storage.set(DB.placesKey, j.places); renderSavedPlacesToMap(); }
  updateFamilyMarkers();
  updateInboxBadge();
  updateProfileThumb();
}

async function sendOtp(phone, email){
  try{
    const res = await fetch("/api/send-otp", { method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify({ phone, email }) });
    const j = await res.json();
    if(!res.ok) { await notice("Failed to send OTP: " + (j && j.error)); return null; }
    if(j && j.otp){
      await notice("OTP (local/dev): " + j.otp);
    } else {
      await notice("OTP sent (via configured channel). Check your phone or email.");
    }
    return j;
  }catch(e){ console.error(e); await notice("OTP send failed"); return null; }
}
async function verifyOtp(phone, code){
  try{
    const res = await fetch("/api/verify-otp", { method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify({ phone, code }) });
    const j = await res.json();
    if(!res.ok) { await notice("OTP verification failed: " + (j && j.error)); return null; }
    if(j && j.sessionToken) localStorage.setItem("f360_otpsess", j.sessionToken);
    if(j && j.user){
      cacheUserFromServer(j.user);
      setSession({ userId: j.user.id, sessionToken: j.sessionToken });
    }
    return j;
  }catch(e){ console.error(e); return null; }
}

function showModal(contentEl, opts={}){
  const backdrop = make("div",{className:"modal-backdrop", id: uid("modal")});
  const modal = make("div",{className:"modal"});
  if(opts.variant === "chat") modal.classList.add("chat-shell");
  if(opts.variant === "help") modal.classList.add("help-shell");
  if(opts.variant === "feed") modal.classList.add("feed-shell");
  if(opts.variant === "inbox") modal.classList.add("inbox-shell");
  if(opts.variant === "avatar") modal.classList.add("avatar-shell");
  if(opts.variant === "auth") modal.classList.add("auth-shell");
  if(opts.variant === "form") modal.classList.add("form-shell");

  const closeBtn = make("button",{className:"modal-close", type:"button", title:"Close"});
  closeBtn.innerHTML = "✕";
  closeBtn.onclick = () => { closeModal(); };

  modal.appendChild(closeBtn);
  modal.appendChild(contentEl);
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  setTimeout(()=>{ const firstInput = modal.querySelector("input,button,select,textarea"); if(firstInput) firstInput.focus(); }, 40);
  setTimeout(()=>{ try{ if(window.reflowMap) window.reflowMap(); }catch(e){} }, 50);
  return backdrop;
}
function closeModal(){
  const all = document.querySelectorAll(".modal-backdrop");
  const last = all[all.length - 1];
  if(last) last.remove();
  if(!document.querySelector(".modal-backdrop")){
    openChatUserId = null;
    openChatFamilyId = null;
    openChatRoomId = null;
    window.__refreshOpenChat = null;
    window.__showTyping = null;
    window.__refreshInbox = null;
  }
}
function closeAllModals(){
  while(document.querySelector(".modal-backdrop")) closeModal();
}

function loadGsi(cb){
  if(window.google && google.accounts && google.accounts.id){ cb(); return; }
  if(!document.getElementById("gsi-client")){
    const s = document.createElement("script");
    s.id = "gsi-client";
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    document.head.appendChild(s);
  }
  const started = Date.now();
  const t = setInterval(() => {
    if(window.google && google.accounts && google.accounts.id){ clearInterval(t); cb(); }
    else if(Date.now() - started > 8000){ clearInterval(t); cb(new Error("Google script did not load")); }
  }, 150);
}

async function onGoogleCredential(resp){
  try{
    const j = await api("/api/auth/google", { method:"POST", body: { credential: resp.credential } });
    cacheUserFromServer(j.user);
    if(j.user && j.user.googlePicture && !getProfileImageForUser(j.user.id)){
      saveProfileImageForUser(j.user.id, j.user.googlePicture);
    }
    setSession({ userId: j.user.id, sessionToken: j.sessionToken });
    afterSignIn({ created: !!j.created });
  }catch(e){
    notice("Google sign-in failed: " + (e.message || "unknown error"));
  }
}

async function mountGoogleButton(slot){
  if(!slot) return;
  slot.innerHTML = "";
  if(!serverConfig.googleClientId){
    const j = await apiTry("/api/config");
    if(j) applyServerConfig(j);
  }
  const cid = serverConfig.googleClientId;
  if(!cid){
    const btn = make("button",{className:"google-btn", type:"button"});
    btn.innerHTML = `<span class="gico">G</span> Continue with Google`;
    btn.onclick = async () => {
      if(serverConfig.demo){
        const r = await apiTry("/api/auth/demo-google", { method:"POST", body: {} });
        if(!r || !r.user) return notice("Google sign-in is not on yet. Use email or a sample family member.");
        cacheUserFromServer(r.user);
        setSession({ userId: r.user.id, sessionToken: r.sessionToken });
        afterSignIn({ created: !!r.created });
        return;
      }
      notice("Google sign-in is not on yet. Use email, phone, or a sample family member.");
    };
    slot.appendChild(btn);
    return;
  }
  loadGsi((err) => {
    if(err || !window.google){
      const btn = make("button",{className:"google-btn", type:"button"}, "Continue with Google");
      btn.onclick = () => notice("Google script blocked. Allow accounts.google.com and retry.");
      slot.appendChild(btn);
      return;
    }
    try{
      google.accounts.id.initialize({ client_id: cid, callback: onGoogleCredential, ux_mode: "popup" });
      google.accounts.id.renderButton(slot, { theme: "outline", size: "large", width: 336, text: "continue_with", shape: "rectangular" });
    }catch(e){
      const btn = make("button",{className:"google-btn", type:"button"}, "Continue with Google");
      btn.onclick = () => { try{ google.accounts.id.prompt(); }catch(err2){ notice(err2.message); } };
      slot.appendChild(btn);
    }
  });
}

async function sendSos(){
  const s = currentSession();
  if(!s) return notice("Sign in first");
  if(!myFamilies().length) return notice("Join or create a family first. SOS is sent to every family you belong to.");
  if(!await ask("Send an SOS alert to every family you belong to?")) return;
  const j = await apiTry("/api/sos", { method:"POST", body: {} });
  if(j && j.ok) notice("SOS sent to " + j.families + " family(ies). They will see it in chat and inbox.");
  else notice((j && j.error) || "Could not send SOS.");
}

function renderHelp(startTab){
  const wrap = make("div",{className:"help-app"});
  const nav = make("div",{className:"help-nav"});
  nav.appendChild(make("h2",{}, "FAMILIA"));
  const body = make("div",{className:"help-body"});
  const tabs = [
    { id:"welcome", label:"Welcome" },
    { id:"start", label:"Getting started" },
    { id:"profile", label:"Profile icon" },
    { id:"map", label:"The map" },
    { id:"families", label:"Families" },
    { id:"privacy", label:"Privacy" },
    { id:"messages", label:"Messages" },
    { id:"calls", label:"Calls" },
    { id:"rooms", label:"Rooms" },
    { id:"alerts", label:"Phone alerts" },
    { id:"search", label:"Find people" },
    { id:"tracking", label:"Tracking" },
    { id:"community", label:"Community" },
    { id:"roles", label:"Family roles" },
    { id:"terms", label:"Terms" },
    { id:"faq", label:"FAQ" }
  ];
  const pages = {
    welcome: () => {
      const d = make("div");
      d.append(
        make("div",{className:"help-kicker"}, "GPS FAMILIA"),
        make("h3",{}, "Family. Loyalty. Location."),
        make("p",{}, "A private family locator and messenger. Sign in, join as many families as you want, and only people who share a family with you can ever see your pin on the map."),
        make("div",{className:"help-callout"}, "People you find by name or phone can be messaged and invited — they never appear on the map until they join one of your families."),
        make("h4",{}, "The bar at the top"),
        make("ul",{},
          make("li",{}, "☰ GPS FAMILIA — account menu (profile icon, password, privacy, theme, sign in/out)"),
          make("li",{}, "Track — share or hide your live location"),
          make("li",{}, "SOS — emergency ping to every family you are in"),
          make("li",{}, "Feed — community posts"),
          make("li",{}, "🔍 — find people · ✉️ inbox · 👥 family members · ? help")
        ),
        make("p",{}, "On the map, + / − zoom, ↻ refreshes family pins, ◎ centers on you, ✕ hides a mapped trail. Tap a name or pin to zoom in. Open ☰ → Location history & trail to map the path recorded every minute while Track is On.")
      );
      return d;
    },
    profile: () => {
      const d = make("div");
      d.append(
        make("div",{className:"help-kicker"}, "Look"),
        make("h3",{}, "Profile icon"),
        make("p",{}, "Open ☰ and tap your photo, or Profile icon. High-quality 3D portraits, pets, and emblems are ready if you skip a camera photo."),
        make("ul",{},
          make("li",{}, "Tap an icon, then Use this icon."),
          make("li",{}, "Upload photo uses a picture from this device."),
          make("li",{}, "Family members see the same icon on the map, inbox, and feed.")
        )
      );
      return d;
    },
    start: () => {
      const d = make("div");
      d.append(make("div",{className:"help-kicker"}, "First hour"), make("h3",{}, "Getting started"));
      const steps = [
        ["Sign in", "Log in with email, Google, or tap a sample family member (password demo123). All login fields sit in a compact card so you can see them without scrolling."],
        ["Allow location", "A consent notice appears. Accept only if everyone being shared with has agreed."],
        ["Turn Track On", "Your pin appears for family. The footer says live when you are connected."],
        ["Allow phone alerts", "Right after you sign in, GPS FAMILIA asks you to Allow lock-screen alerts so messages, SOS, and app mail arrive like a normal text — even when the app is closed."],
        ["Create a family", "☰ or 👥 → Create / Join. Type a family name and optional password in the two small boxes, pick Private or Public, tap Create. Or paste an invite token and tap Join. You can belong to many families."],
        ["Invite", "Share the QR or link. They open the app, register or sign in, then see members, roles, and rules — Accept or Decline. Location stays off until they belong."],
        ["Message", "Drawer → 💬 next to a member, or 🔍 someone new. Yours are teal on the right; theirs are gray on the left. 📞 and 🎥 start a call."]
      ];
      steps.forEach((s,i) => {
        const row = make("div",{className:"help-step"});
        row.append(make("div",{className:"help-num"}, String(i+1)), make("div",{}, make("div",{style:"font-weight:700"}, s[0]), make("div",{className:"small-muted"}, s[1])));
        d.appendChild(row);
      });
      return d;
    },
    map: () => {
      const d = make("div");
      d.append(
        make("h3",{}, "The map"),
        make("p",{}, "Street, satellite, and terrain layers — switch them with the buttons on the right."),
        make("ul",{},
          make("li",{}, "Pins are family members who have Track On. Tap a pin for history or Map trail."),
          make("li",{}, "📌 saves a named place (home, school, work) at the current map center."),
          make("li",{}, "+ / − zoom. ↻ refreshes pins. ◎ centers on you. ✕ hides the trail line."),
          make("li",{}, "People outside your families never show, even if they exist in search.")
        )
      );
      return d;
    },
    families: () => {
      const d = make("div");
      d.append(
        make("h3",{}, "Families — you can join many"),
        make("p",{}, "A family is a consent circle. Location is shared with everyone who is in a family with you. Joining another crew never removes you from the first."),
        make("p",{}, "Open ☰ or 👥 → Create / Join Family. The card is compact: Family name and Password sit side by side as normal-sized boxes, Privacy + Create on the next row, then Join with an invite link, QR URL, or token."),
        make("p",{}, "A family link or QR always opens GPS FAMILIA. Phone camera, in-app QR, and paste all use the same invite. You register or sign in first — Create / Join is not shown until you have an account. After sign-in you see who invited you, the members of that family, their roles, and the rules. Accept to join, or Decline. If you already belong, you only see the briefing."),
        make("ul",{},
          make("li",{}, "Family name — required. Keep it short so relatives recognize it."),
          make("li",{}, "Password — optional extra lock for private families."),
          make("li",{}, "Private — join with an invite, QR, link, or that password."),
          make("li",{}, "Public — anyone can find it in search and join (still no location until they are a member)."),
          make("li",{}, "Family chat — a private room for the whole crew. 📞 / 🎥 call the group."),
          make("li",{}, "SOS — one tap alerts every family you are in.")
        ),
        make("div",{className:"help-callout"}, "The Head of a private family without a password must accept join requests before location starts flowing.")
      );
      return d;
    },
    privacy: () => {
      const d = make("div");
      d.append(
        make("h3",{}, "Privacy"),
        make("ul",{},
          make("li",{}, "Search never shows someone else's location."),
          make("li",{}, "The map only lists people who share a family with you."),
          make("li",{}, "Guests can be in the family without appearing on the map."),
          make("li",{}, "Track Off stops sharing. Sign out ends the session."),
          make("li",{}, "Record my trail — while Track is On, a pin is saved every minute. Turn this off in Privacy if you only want a live pin."),
          make("li",{}, "Allow family to view my location history — they can map your trail only if this stays on."),
          make("li",{}, "Find me by name / email / phone — hide yourself from strangers in search."),
          make("li",{}, "Notifications — friend, family, message, and payment notices live in ☰ → Notifications.")
        ),
        make("div",{className:"help-warn"}, "Only use this with informed consent. Do not track anyone who has not agreed.")
      );
      return d;
    },
    messages: () => {
      const d = make("div");
      d.append(
        make("h3",{}, "Messages"),
        make("p",{}, "Tap ✉️ for a Messenger-style inbox: profile bubbles, names, last-message previews, and unread dots. Direct chats, family rooms, and hobby groups all live there."),
        make("p",{}, "Direct chats and family rooms are sealed on your device before they are sent. A padlock badge marks a private thread."),
        make("ul",{},
          make("li",{}, "Filters: All, Unread, People, Families, Groups. Search as you type."),
          make("li",{}, "Your bubbles: right, teal. Theirs: left, gray."),
          make("li",{}, "Enter sends. Shift+Enter makes a new line. 📎 attaches a photo."),
          make("li",{}, "Right-click (or long-press on a phone) a bubble to copy or delete it."),
          make("li",{}, "📞 Voice and 🎥 Video sit in the chat header."),
          make("li",{}, "When the app is closed, new messages still ring on your phone like a text."),
          make("li",{}, "SOS alerts are readable on every family device on purpose.")
        )
      );
      return d;
    },
    calls: () => {
      const d = make("div");
      d.append(
        make("div",{className:"help-kicker"}, "Voice & video"),
        make("h3",{}, "Calling"),
        make("p",{}, "Open any chat and tap 📞 or 🎥. Direct, family, and group threads all have the same buttons. Before the first call we explain why the mic (and camera) are needed, then your phone asks Allow. If you already said Don’t Allow, tap Open settings — we’ll jump to this site’s permission page when the phone lets us — then Try again."),
        make("ul",{},
          make("li",{}, "Tap Continue, then Allow on the system prompt. That is the only way calls can connect."),
          make("li",{}, "If permission is blocked: Open settings, allow Camera / Microphone for this site, return, Try again."),
          make("li",{}, "Incoming calls ring in-app and as a phone alert. Accept still needs the same permission."),
          make("li",{}, "Mute, camera on/off, and hang up sit on the call screen.")
        ),
        make("div",{className:"help-callout"}, "Two demo logins on two devices (or two browsers) — call Sonny from Vito to try it.")
      );
      return d;
    },
    rooms: () => {
      const d = make("div");
      d.append(
        make("div",{className:"help-kicker"}, "Hobby groups"),
        make("h3",{}, "Chat rooms"),
        make("p",{}, "Create a group around cooking, cars, cards, or anything else. Rooms are chats — they do not share map pins. Only families share location."),
        make("ul",{},
          make("li",{}, "Inbox → New group — name it, pick a topic, public or private."),
          make("li",{}, "Public rooms show up in search and Browse rooms. Anyone can join."),
          make("li",{}, "Private rooms are invite-only. Members can add family from inside the chat."),
          make("li",{}, "Sample rooms: Sunday Sauce, Classic Rides, Poker Night."),
          make("li",{}, "Leave anytime. Messages stay encrypted for remaining members.")
        ),
        make("div",{className:"help-callout"}, "Rooms never put anyone on the map. Location still requires a family.")
      );
      return d;
    },
    alerts: () => {
      const d = make("div");
      d.append(
        make("div",{className:"help-kicker"}, "Lock screen"),
        make("h3",{}, "Phone alerts"),
        make("p",{}, "Right after you register or log in, GPS FAMILIA asks this phone for notification permission. Family messages, SOS, and app mail then appear in the notification shade — the same place texts live — even if the app is closed."),
        make("ul",{},
          make("li",{}, "Tap Allow alerts, then Allow on the system prompt. That is required for lock-screen delivery."),
          make("li",{}, "On iPhone, add this site to the Home Screen (Safari → Share → Add to Home Screen) so alerts keep working."),
          make("li",{}, "Tap a notification to jump straight into that chat."),
          make("li",{}, "If you are already looking at that conversation, we stay quiet so it does not double-ding.")
        ),
        make("div",{className:"help-callout"}, "If alerts stopped, open the app once while signed in and tap Turn on phone alerts below.")
      );
      const btn = make("button",{className:"btn", type:"button"}, "Turn on phone alerts");
      btn.onclick = () => { ensureAlertPermission().then((ok) => { if(ok) notice("Alerts are on. Family messages will hit this phone’s lock screen."); }); };
      d.appendChild(make("div",{className:"row", style:"margin-top:12px"}, btn));
      return d;
    },
    search: () => {
      const d = make("div");
      d.append(
        make("h3",{}, "Find people"),
        make("p",{}, "🔍 opens People & invites: search, family requests with Accept / Decline, and invite links."),
        make("p",{}, "From a result you can open their profile, send a friend request, or invite them to a family. Pins stay hidden until they belong."),
        make("ul",{},
          make("li",{}, "People — live directory by name, email, or phone. You control who can find you."),
          make("li",{}, "Friend requests — they have to Accept. We never auto-friend anyone."),
          make("li",{}, "Message requests — if you are not friends or family, the first note waits until they accept."),
          make("li",{}, "My QR — share a personal code. Scanning never joins or friends automatically."),
          make("li",{}, "Requests — Accept or Decline joins and invites."),
          make("li",{}, "Invite link — QR, copy, or social share for a family.")
        )
      );
      return d;
    },
    tracking: () => {
      const d = make("div");
      d.append(
        make("h3",{}, "Tracking"),
        make("p",{}, "Track On uses your phone's GPS and updates family devices within a second or two. The footer pill turns teal when you are live."),
        make("p",{}, "Location history keeps recording even after you leave or close the app. It only stops when you tap Track Off. Reopening GPS FAMILIA resumes tracking automatically if Track was still On."),
        make("p",{}, "While Track is On, a trail pin is saved every minute. Open ☰ → Location history & trail — or tap a family pin → History / Map trail."),
        make("ul",{},
          make("li",{}, "Closing the app does not turn tracking off — only Track Off does."),
          make("li",{}, "A quiet “tracking” notice may stay in the notification shade so GPS can keep running."),
          make("li",{}, "Map this trail — draws the path on the map with start and end markers."),
          make("li",{}, "Time range — last hour, today, 24 hours, 7 days, or all."),
          make("li",{}, "Hide trail — clears the line from the map (history stays)."),
          make("li",{}, "Save pin now — drop a point immediately."),
          make("li",{}, "Clear this range / Clear all history — erases recorded points. Cannot be undone."),
          make("li",{}, "Privacy → Record my trail — turn recording off and keep only the live pin.")
        ),
        make("p",{}, "If location is blocked, a nearby demo pin is used so the map still works on a desktop.")
      );
      return d;
    },
    community: () => {
      const d = make("div");
      d.append(
        make("div",{className:"help-kicker"}, "Feed"),
        make("h3",{}, "Community"),
        make("p",{}, "Tap Feed in the top bar. A panel slides in from the right — the map stays open beside it. Choose Everyone or a family before you post. Family posts stay inside that crew."),
        make("ul",{},
          make("li",{}, "🖼 Photo and ▶ Video — add pictures or a short clip to a post"),
          make("li",{}, "♡ Like, 💬 Comment, ↗ Share — like Facebook, inside the app"),
          make("li",{}, "Share copies a link, posts it to your own feed, or uses the phone share sheet"),
          make("li",{}, "Chips: All, Everyone, Families, Mine, Photos, Videos"),
          make("li",{}, "Search filters posts as you type; Load more pages the stream"),
          make("li",{}, "Your own posts can be deleted with ⋯")
        ),
        make("div",{className:"help-callout"}, "Videos are stored as files (not inside the database). Keep clips around 12 MB or smaller.")
      );
      return d;
    },
    friends: () => {
      const d = make("div");
      d.append(
        make("div",{className:"help-kicker"}, "Safety"),
        make("h3",{}, "Friends, block, report"),
        make("p",{}, "Find people → Friends. Add friend sends a request they must Accept. Blocking removes the friendship and stops DMs both ways. Reports go to the operator — the other person is not told."),
        make("ul",{},
          make("li",{}, "Add friend / Accept / Decline from the Friends tab."),
          make("li",{}, "Block from a person card or chat. Unblock in ☰ → Privacy after viewing Blocks via search."),
          make("li",{}, "Report reasons: spam, harassment, stalking, scam, fake listing, underage, other."),
          make("li",{}, "☰ → Privacy & security has who-can-message, who-can-call, friend-request, search visibility, and friend location switches.")
        ),
        make("div",{className:"help-callout"}, "When you join a family, a permissions briefing lists your role and every privilege. Guests stay off the map.")
      );
      return d;
    },
    market: () => {
      const d = make("div");
      d.append(
        make("div",{className:"help-kicker"}, "Buy & sell"),
        make("h3",{}, "Marketplace"),
        make("p",{}, "Tap Market in the top bar. A live panel lists items from signed-in families. Message the seller — that chat is the same end-to-end encrypted inbox. Offers notify the seller in realtime."),
        make("ul",{},
          make("li",{}, "Sell — title, price, category, photos, city. Precise GPS is never stored on a listing."),
          make("li",{}, "Message, Offer, Save, Report on each card."),
          make("li",{}, "Your listings: mark sold or delete."),
          make("li",{}, "Blocked sellers are hidden from your feed.")
        )
      );
      return d;
    },
    wallet: () => {
      const d = make("div");
      d.append(
        make("div",{className:"help-kicker"}, "Payments"),
        make("h3",{}, "Wallet"),
        make("p",{}, "☰ → Wallet & payments. Add a card or connect a bank. GPS FAMILIA never stores a full card number, CVC, or routing number — only last4 and a token."),
        make("ul",{},
          make("li",{}, "Marketplace pay is person-to-person. The seller receives 100% of the listed price."),
          make("li",{}, "The buyer pays a 6.9% service fee ($0.49 minimum, $25 cap) so the service can stay online."),
          make("li",{}, "Sales show as Available balance. Free listings have no fee.")
        )
      );
      return d;
    },
    roles: () => {
      const d = make("div");
      d.append(
        make("div",{className:"help-kicker"}, "Advanced"),
        make("h3",{}, "Family roles"),
        make("p",{}, "Only the Head of Family can appoint Admins and hand over the house. Open Your Families → Settings (or ⚙ in the drawer)."),
        make("ul",{},
          make("li",{}, "Head of Family — full control, including transfer."),
          make("li",{}, "Admin — accept joins, remove members, edit the family name."),
          make("li",{}, "Consigliere — can create custom roles."),
          make("li",{}, "Member — invite, chat, location."),
          make("li",{}, "Guest — in the family, off the map.")
        )
      );
      return d;
    },
    terms: () => {
      const d = make("div");
      d.append(
        make("div",{className:"help-kicker"}, "Legal"),
        make("h3",{}, "Terms of Use")
      );
      d.appendChild(make("p",{className:"small-muted"}, "The agreement you accepted on first launch. Hustler Anomalies Enterprises, the developer, and associated parties provide GPS FAMILIA as-is."));
      const box = make("div",{className:"legal-scroll"});
      box.innerHTML = legalTermsHtml();
      d.appendChild(box);
      return d;
    },
    faq: () => {
      const d = make("div");
      d.append(
        make("h3",{}, "FAQ"),
        make("h4",{}, "Why don't I see Continue with Google?"),
        make("p",{}, "Whoever put the app online has not turned Google sign-in on yet. Use email, a sample family member, or ask them."),
        make("h4",{}, "Why don't I see someone on the map?"),
        make("p",{}, "They are not in one of your families, they have Track Off, they are a Guest, or they have not accepted location."),
        make("h4",{}, "Can I be in two families?"),
        make("p",{}, "Yes. Unlimited. Location is visible to the combined membership."),
        make("h4",{}, "Are chats private?"),
        make("p",{}, "Yes. Messages are sealed on your device. SOS is the exception so every family phone can read an emergency."),
        make("h4",{}, "Where is my trail?"),
        make("p",{}, "Open ☰ → Location history & trail, or tap a family pin → Map trail. A point is stored every minute while Track is On — including after you close the app, until you tap Track Off. Sample family members already have a short demo path you can map."),
        make("h4",{}, "Why didn’t I get a lock-screen alert?"),
        make("p",{}, "After login, tap Allow alerts, then Allow on the phone prompt. Incoming calls keep ringing on the lock screen even if another tab is open. On iPhone, add GPS FAMILIA to the Home Screen first. You can retry from Help → Phone alerts."),
        make("h4",{}, "I am just trying it out"),
        make("p",{}, "On the compact login card, tap any sample family member (Vito, Sonny, …). Password for all of them is demo123. Phone code is 000000. Email login: vito@familia.test / demo123.")
      );
      return d;
    }
  };

  function show(id){
    nav.querySelectorAll(".help-tab").forEach(b => b.classList.toggle("active", b.dataset.id === id));
    body.innerHTML = "";
    const fn = pages[id] || pages.welcome;
    body.appendChild(fn());
  }
  tabs.forEach(t => {
    const b = make("button",{className:"help-tab", type:"button"});
    b.dataset.id = t.id;
    b.textContent = t.label;
    b.onclick = () => show(t.id);
    nav.appendChild(b);
  });
  wrap.append(nav, body);
  showModal(wrap, { variant: "help" });
  const modal = document.querySelector(".modal");
  if(modal) modal.classList.add("help-shell");
  show(startTab && pages[startTab] ? startTab : "welcome");
}

function renderAuth(opts){
  opts = opts || {};
  const container = make("div",{className:"auth-form"});
  const tabs = make("div",{className:"row auth-tabs"});
  const tabLogin = make("button",{className:"btn small secondary", type:"button"}, "Log in");
  const tabReg = make("button",{className:"btn small", type:"button"}, "Register");
  tabs.appendChild(tabLogin); tabs.appendChild(tabReg);

  const formWrap = make("div");
  container.appendChild(tabs);
  container.appendChild(formWrap);

  function renderLogin(){
    formWrap.innerHTML = "";
    const gslot = make("div",{id:"google-btn-slot"});
    formWrap.appendChild(gslot);
    formWrap.appendChild(make("div",{className:"auth-divider"}, "or use your account"));
    mountGoogleButton(gslot);
    const idInput = make("input",{className:"input", placeholder:"Email, username, or phone", id:"login-id"});
    const pass = make("input",{className:"input", type:"password", placeholder:"Password", id:"login-pass"});
    const phone = make("input",{className:"input", placeholder:"Phone (optional, for OTP)", id:"login-phone"});
    const row = make("div",{className:"auth-fields"});
    row.append(idInput, pass, phone);
    const submit = make("button",{className:"btn", type:"button"}, "Log in");
    const forgot = make("button",{className:"btn small secondary", type:"button"}, "OTP login");
    submit.onclick = async () => {
      const identifier = (idInput.value || "").trim();
      try{
        const j = await api("/api/login", { method:"POST", body: { identifier, password: pass.value } });
        cacheUserFromServer(j.user);
        setSession({ userId: j.user.id, sessionToken: j.sessionToken });
        afterSignIn();
        return;
      }catch(e){
        if(identifier && pass.value){
          const usersLocal = storage.get(DB.usersKey) || [];
          const localUser = usersLocal.find(x => (x.email && x.email.toLowerCase() === identifier.toLowerCase())
                                              || (x.name && x.name.toLowerCase() === identifier.toLowerCase())
                                              || (x.phone && (x.phone === identifier || digits(x.phone) === digits(identifier))));
          if(localUser){
            if(localUser.password !== undefined && localUser.password !== pass.value){
              notice("Login failed: bad password");
              return;
            }
            setSession({ userId: localUser.id, sessionToken: uid("tok") });
            afterSignIn();
            return;
          }
        }
        notice("Login failed: " + (e && e.message || "invalid"));
      }
    };
    forgot.onclick = async () => {
      if(!phone.value){ notice("Enter phone to receive OTP"); return; }
      await sendOtp(phone.value);
      const otp = await askText("Enter the OTP you received");
      if(otp == null || String(otp).trim() === "") return;
      const ok = await verifyOtp(phone.value, otp);
      if(!ok){ notice("Bad OTP"); return; }
      if(ok.user){ afterSignIn({ created: !!ok.created }); return; }
      const usersLocal = storage.get(DB.usersKey) || [];
      let u = usersLocal.find(x=>x.phone === phone.value);
      if(!u){
        const name = "User "+phone.value.slice(-4);
        try{
          const res = await fetch("/api/register", { method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify({ name, email: name.replace(/\s/g,"")+"@local.familia", phone: phone.value, password: "otp-"+phone.value.slice(-6) }) });
          const j = await res.json();
          if(res.ok && j.user){
            usersLocal.push({ id: j.user.id, name: j.user.name || name, email: (j.user.email||"").toLowerCase(), phone: phone.value, createdAt: now(), locationHistory: [] });
            storage.set(DB.usersKey, usersLocal);
            setSession({ userId: j.user.id, sessionToken: j.sessionToken });
            afterSignIn();
            return;
          }
        }catch(e){ console.warn("auto-register failed", e); }
        u = { id: uid("u"), name: name, email: "", phone: phone.value, password: "" };
        usersLocal.push(u); storage.set(DB.usersKey, usersLocal);
      }
      setSession({ userId: u.id });
      afterSignIn();
    };

    formWrap.appendChild(row);
    formWrap.appendChild(make("div",{className:"row", style:"gap:6px;margin-top:4px"}, submit, forgot));
    mountDemoPanel(uiBag(), formWrap).catch(()=>{});
  }

  function renderRegister(){
    formWrap.innerHTML = "";
    const gslot = make("div",{id:"google-btn-slot-reg"});
    formWrap.appendChild(gslot);
    formWrap.appendChild(make("div",{className:"auth-divider"}, "or create an account"));
    mountGoogleButton(gslot);
    const name = make("input",{className:"input", placeholder:"Full name", id:"reg-name"});
    const email = make("input",{className:"input", placeholder:"Email", id:"reg-email"});
    const phone = make("input",{className:"input", placeholder:"Phone number", id:"reg-phone"});
    const pass = make("input",{className:"input", type:"password", placeholder:"Password (min 6 chars)", id:"reg-pass"});
    const pass2 = make("input",{className:"input", type:"password", placeholder:"Verify password", id:"reg-pass2"});
    const row = make("div",{className:"auth-fields"});
    row.append(name, email, phone, pass, pass2);

    const feedback = make("div",{className:"small-muted", style:"min-height:18px;margin-top:6px;"},"");

    const sendOtpBtn = make("button",{className:"btn small secondary", type:"button"}, "Send OTP to phone");
    sendOtpBtn.onclick = async () => {
      if(!phone.value) return notice("Enter phone");
      const ok = await sendOtp(phone.value, email.value);
      if(!ok) return;
      const code = await askText("Enter OTP");
      if(code == null || String(code).trim() === "") return;
      const verified = await verifyOtp(phone.value, code);
      if(!verified) return notice("Bad OTP");
      notice("Phone verified");
      feedback.textContent = "Phone verified ✔️";
    };

    const submit = make("button",{className:"btn", type:"button"}, "Register");
    submit.onclick = async () => {
      feedback.textContent = "";
      if(!name.value.trim()) return feedback.textContent = "Please enter your full name.";
      const em = (email.value || "").trim();
      if(!em || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return feedback.textContent = "Please enter a valid email address.";
      if((pass.value || "").length < 6) return feedback.textContent = "Password must be at least 6 characters.";
      if(pass.value !== pass2.value) return feedback.textContent = "Passwords do not match.";

      submit.disabled = true;
      submit.textContent = "Registering...";

      const nameTxt = name.value.trim();
      const phoneTxt = (phone.value || "").trim();

      try{
        const j = await api("/api/register", { method:"POST", body: { name: nameTxt, email: em, phone: phoneTxt, password: pass.value } });
        const localUser = { id: j.user.id, name: j.user.name || nameTxt, email: em, phone: phoneTxt, createdAt: now(), locationHistory: [] };
        let usersLocal = storage.get(DB.usersKey) || [];
        if(!usersLocal.find(u => u.id === localUser.id)) usersLocal.push(localUser);
        storage.set(DB.usersKey, usersLocal);
        setSession({ userId: localUser.id, sessionToken: j.sessionToken });
        await afterSignIn({ created: true });
        notice("Registration complete — welcome " + (localUser.name || localUser.email));
        submit.disabled = false;
        submit.textContent = "Register";
        return;
      }catch(e){
        if(e.status === 409){
          feedback.textContent = e.message === "email used" ? "An account with that email already exists. Log in instead." :
            e.message === "username taken" ? "That username is already taken." : e.message;
          submit.disabled = false; submit.textContent = "Register"; return;
        }
      }

      let usersLocal = storage.get(DB.usersKey) || [];
      if(usersLocal.find(u => u.email && u.email.toLowerCase() === em.toLowerCase())) {
        feedback.textContent = "An account with that email already exists. Log in instead.";
        submit.disabled = false; submit.textContent = "Register"; return;
      }
      if(usersLocal.find(u => u.name && u.name.toLowerCase() === nameTxt.toLowerCase())) {
        feedback.textContent = "That username is already taken.";
        submit.disabled = false; submit.textContent = "Register"; return;
      }

      const localUser = { id: uid("u"), name: nameTxt, email: em, phone: phoneTxt, password: pass.value, createdAt: now(), locationHistory: [] };
      usersLocal.push(localUser);
      storage.set(DB.usersKey, usersLocal);
      setSession({ userId: localUser.id, sessionToken: uid("tok") });
      await afterSignIn({ created: true });
      notice("Registration complete — welcome " + (localUser.name || localUser.email));
      submit.disabled = false;
      submit.textContent = "Register";
    };

    formWrap.appendChild(row);
    formWrap.appendChild(feedback);
    formWrap.appendChild(make("div",{className:"row", style:"gap:6px;margin-top:4px"}, sendOtpBtn, submit));
  }

  tabLogin.onclick = () => { tabLogin.classList.remove("secondary"); tabReg.classList.add("secondary"); renderLogin(); };
  tabReg.onclick = () => { tabReg.classList.remove("secondary"); tabLogin.classList.add("secondary"); renderRegister(); };

  if(opts.registerFirst || pendingInviteToken()){
    const banner = make("div",{className:"privacy-note"}, "Create an account or log in first. Then you will see who is in this family, their roles, and the rules — Accept or Decline.");
    container.insertBefore(banner, formWrap);
    tabReg.click();
  } else {
    tabLogin.click();
  }

  return showModal(container, { variant: "auth" });
}

async function renderDisclaimer(onAccept){
  const ok = await showPopup({
    kind: "confirm",
    wide: true,
    title: "Enable location sharing",
    kicker: "GPS consent",
    message: "GPS FAMILIA will use this device’s location (GPS, Wi-Fi, and network) while Track is On. Your pin and history are visible to every family you belong to. This is not 911. Only continue if every person whose location will be viewed has given informed consent. You can turn Track Off at any time. Full terms: Help → Terms.",
    okText: "Enable GPS",
    cancelText: "Not now"
  });
  if(ok){
    setGpsConsent();
    if(onAccept) onAccept();
  }
}

function renderCreateJoin(prefillInvite){
  const wrap = make("div",{className:"fam-create"});
  wrap.appendChild(make("h3",{}, "Create or Join a Family"));
  wrap.appendChild(make("p",{className:"fam-create-note"}, "Join as many families as you want. Pins stay private until you share a family."));
  const name = make("input",{className:"input", placeholder:"e.g. Corleone"});
  name.setAttribute("aria-label","Family name");
  const pass = make("input",{className:"input", type:"password", placeholder:"Optional"});
  pass.setAttribute("aria-label","Family password");
  const privacy = make("select",{className:"input"}, make("option",{value:"private"},"Private — invite only"), make("option",{value:"public"},"Public — searchable"));
  privacy.setAttribute("aria-label","Privacy");
  const createBtn = make("button",{className:"btn small", type:"button"}, "Create");

  createBtn.onclick = async () => {
    const s = currentSession(); if(!s){ notice("Sign in first"); return; }
    const payload = { name: name.value, password: pass.value, privacy: privacy.value };
    const j = await apiTry("/api/families", { method:"POST", body: payload });
    if(j && j.family){
      cacheFamily(j.family);
      closeModal();
      openShareModal(j.family);
      updateFamilyMarkers();
      if(j.briefing) setTimeout(() => showFamilyBriefing(j.briefing), 400);
      return;
    }
    notice((j && j.error) || "Could not create the family. Check your connection and try again.");
  };

  const invite = make("input",{className:"input", placeholder:"Paste invite link or token"});
  invite.setAttribute("aria-label","Invite link or token");
  if(prefillInvite) invite.value = prefillInvite;

  const scanJoin = make("button",{className:"btn small secondary", type:"button"}, "Scan QR");
  scanJoin.onclick = async () => {
    const tok = await scanInviteFromCamera();
    if(!tok) return;
    invite.value = tok;
    await openInviteFromRaw(tok);
  };
  const joinBtn = make("button",{className:"btn small secondary", type:"button"}, "Join");
  joinBtn.onclick = async () => {
    const s = currentSession(); if(!s){ notice("Sign in first"); return; }
    await openInviteFromRaw(invite.value);
  };

  const grid = make("div",{className:"fam-create-grid"});
  grid.append(make("label",{}, "Family name"), make("label",{}, "Password"), name, pass);
  wrap.appendChild(grid);
  const createRow = make("div",{className:"fam-create-actions"});
  createRow.append(privacy, createBtn);
  wrap.appendChild(createRow);
  wrap.appendChild(make("div",{className:"fam-create-or"}, "or join with an invite"));
  const joinRow = make("div",{className:"fam-create-actions"});
  joinRow.append(invite, joinBtn, scanJoin);
  wrap.appendChild(joinRow);

  return showModal(wrap, { variant: "form" });
}

async function familyInvite(f){
  const j = await apiTry("/api/families/" + encodeURIComponent(f.id) + "/invite", { method:"POST", body: {} });
  if(j && j.token){
    const families = storage.get(DB.familiesKey) || [];
    const ff = families.find(x=>x.id===f.id);
    if(ff){
      ff.invites = ff.invites || [];
      if(!ff.invites.includes(j.token)) ff.invites.unshift(j.token);
      storage.set(DB.familiesKey, families);
    }
    const url = j.qrUrl || j.url || (window.location.origin + "/invite/" + j.token);
    return { token: j.token, url };
  }
  await notice("Could not mint an invite. Check your connection and try again.");
  return { token: "", url: "" };
}

function downloadDataUrl(dataUrl, filename){
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(()=>{ a.remove(); }, 100);
}

async function qrDataUrl(text){
  try{
    const mod = await import("qrcode");
    const QR = mod.default || mod;
    return await QR.toDataURL(text, { width: 480, margin: 2, color:{ dark:"#042022", light:"#ffffff" } });
  }catch(e){
    console.error("QR generation failed", e);
    return null;
  }
}

async function openShareModal(f){
  const { token, url } = await familyInvite(f);
  if(!token || !url) return;
  const wrap = make("div",{style:"min-width:320px;max-width:560px;display:flex;flex-direction:column;gap:12px"});
  wrap.appendChild(make("h3",{}, `Share "${f.name}"`));
  wrap.appendChild(make("div",{className:"small-muted"}, "Phone camera, in-app QR, and a pasted link all use this same invite. After they sign in they Accept to join."));

  const qrImg = make("img",{alt:"Family invite QR", style:"width:200px;height:200px;border-radius:10px;background:#fff;border:1px solid rgba(255,255,255,0.06);display:block;margin:0 auto"});
  qrImg.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
  qrDataUrl(url).then(d => { if(d) qrImg.src = d; });

  const linkInput = make("input",{className:"input", value: url, readOnly:true, style:"font-family:monospace;font-size:12px"});
  const tokenInput = make("input",{className:"input", value: token, readOnly:true, style:"font-family:monospace;font-size:12px"});

  const copyLink = make("button",{className:"btn small secondary"}, "Copy Link");
  copyLink.onclick = async () => {
    try{ await navigator.clipboard.writeText(url); copyLink.textContent = "Copied!"; setTimeout(()=>copyLink.textContent="Copy Link",1500); }
    catch(e){ notice(url); }
  };
  const copyToken = make("button",{className:"btn small secondary"}, "Copy Token");
  copyToken.onclick = async () => {
    try{ await navigator.clipboard.writeText(token); copyToken.textContent = "Copied!"; setTimeout(()=>copyToken.textContent="Copy Token",1500); }
    catch(e){ notice(token); }
  };

  const dlQr = make("button",{className:"btn small"}, "⬇ Download QR");
  dlQr.onclick = async () => {
    const d = await qrDataUrl(url);
    if(d) downloadDataUrl(d, `family-${f.name.replace(/\W+/g,"-")}-invite.png`);
    else notice("Could not generate QR.");
  };
  const dlLink = make("button",{className:"btn small secondary"}, "⬇ Download Link (.txt)");
  dlLink.onclick = () => {
    const blob = new Blob([`Join ${f.name} on GPS-FAMILIA:\n${url}`], {type:"text/plain"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `family-${f.name.replace(/\W+/g,"-")}-invite.txt`;
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
  };

  const text = `Join my family "${f.name}" on GPS-FAMILIA`;
  const shareTargets = [
    { key:"whatsapp", label:"WhatsApp", url:`https://wa.me/?text=${encodeURIComponent(text+" "+url)}` },
    { key:"telegram", label:"Telegram", url:`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}` },
    { key:"facebook", label:"Facebook", url:`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}` },
    { key:"x", label:"X", url:`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}` },
    { key:"instagram", label:"Instagram", url:`https://www.instagram.com/` },
    { key:"snapchat", label:"Snapchat", url:`https://www.snapchat.com/` },
    { key:"email", label:"Email", url:`mailto:?subject=${encodeURIComponent(text)}&body=${encodeURIComponent(text+" "+url)}` },
    { key:"sms", label:"SMS", url:`sms:?&body=${encodeURIComponent(text+" "+url)}` }
  ];

  const shareGrid = make("div",{className:"share-grid"});
  shareTargets.forEach(t=> shareGrid.appendChild(socialBtn(make, t)));

  const nativeShare = make("button",{className:"btn small secondary"}, "📤 Share…");
  nativeShare.onclick = async () => {
    if(navigator.share){
      try{
        const d = await qrDataUrl(url);
        const files = d ? [new File([await (await fetch(d)).blob()], "invite.png", {type:"image/png"})] : [];
        await navigator.share({ title: text, text: text+" "+url, url, files });
      }catch(e){ if(e.name !== "AbortError") notice("Share failed: " + e.message); }
    } else {
      notice("Sharing not supported on this device. Use the buttons below.");
    }
  };

  wrap.appendChild(qrImg);
  wrap.appendChild(make("div",{className:"row", style:"gap:8px"}, copyLink, dlQr, nativeShare));
  wrap.appendChild(make("label",{}, "Invite link"));
  wrap.appendChild(make("div",{className:"row", style:"gap:8px"}, linkInput, dlLink));
  wrap.appendChild(make("label",{}, "Invite token"));
  wrap.appendChild(make("div",{className:"row", style:"gap:8px"}, tokenInput, copyToken));
  wrap.appendChild(make("div",{className:"small-muted", style:"text-align:center"}, "Share via:"));
  wrap.appendChild(shareGrid);

  return showModal(wrap);
}

function openDrawer(){
  closeAccountDrawer();
  const drawer = qs("#drawer"), scrim = qs("#drawer-scrim");
  if(drawer){ drawer.classList.add("open"); drawer.setAttribute("aria-hidden","false"); }
  if(scrim) scrim.classList.add("open");
  document.body.classList.add("fam-open");
  updateFamilyMarkers();
}
function closeDrawer(){
  const drawer = qs("#drawer"), scrim = qs("#drawer-scrim");
  if(drawer){ drawer.classList.remove("open"); drawer.setAttribute("aria-hidden","true"); }
  if(scrim) scrim.classList.remove("open");
  document.body.classList.remove("fam-open");
}
function closeAccountDrawer(){
  const d = qs("#account-drawer"), s = qs("#account-scrim");
  if(d){ d.classList.remove("open"); d.setAttribute("aria-hidden","true"); }
  if(s) s.classList.remove("open");
  document.body.classList.remove("acct-open");
  const hit = qs("#btn-account");
  if(hit) hit.setAttribute("aria-expanded","false");
}
function openAccountDrawer(){
  closeDrawer();
  paintAccountDrawer();
  const d = qs("#account-drawer"), s = qs("#account-scrim");
  if(d){ d.classList.add("open"); d.setAttribute("aria-hidden","false"); }
  if(s) s.classList.add("open");
  document.body.classList.add("acct-open");
  const hit = qs("#btn-account");
  if(hit) hit.setAttribute("aria-expanded","true");
}
function acctItem(ico, label, fn, cls){
  const b = make("button",{className:"acct-item" + (cls ? " " + cls : ""), type:"button"});
  b.appendChild(make("span",{className:"ico"}, ico));
  b.appendChild(make("span",{}, label));
  b.onclick = fn;
  return b;
}
function paintAccountDrawer(){
  const s = currentSession();
  const u = s ? getUserById(s.userId) : null;
  const nameEl = qs("#acct-name");
  const emailEl = qs("#acct-email");
  const phoneEl = qs("#acct-phone");
  const av = qs("#acct-avatar");
  if(nameEl) nameEl.textContent = u ? (u.name || "Member") : "Not signed in";
  if(emailEl) emailEl.textContent = u ? (u.email || "") : "Sign in to manage your account";
  if(phoneEl) phoneEl.textContent = u && u.phone ? u.phone : "";
  if(av){
    if(u){
      const dataUrl = getProfileImageForUser(u.id);
      if(dataUrl) av.src = dataUrl;
      else {
        const initials = (u.name || "U").split(" ").map(x=>x[0]).slice(0,2).join("").toUpperCase();
        const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='88' height='88'><rect width='100%' height='100%' fill='#233b3a'/><text x='50%' y='54%' font-size='32' fill='#fff' text-anchor='middle' font-family='Arial'>${initials}</text></svg>`;
        av.src = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
      }
    } else av.src = "";
  }
  const nav = qs("#acct-nav");
  if(!nav) return;
  nav.innerHTML = "";
  const go = (fn) => () => { closeAccountDrawer(); fn(); };
  nav.appendChild(make("div",{className:"acct-sec"}, "Navigate"));
  nav.appendChild(acctItem("◎", "Center map on me", go(() => centerOnMe())));
  if(s) nav.appendChild(acctItem("🕘", "Location history & trail", go(() => renderHistoryForUser(s.userId))));
  nav.appendChild(acctItem("👥", "Family members", () => { closeAccountDrawer(); openDrawer(); }));
  nav.appendChild(acctItem("＋", "Create / Join family", go(() => renderCreateJoin())));
  nav.appendChild(acctItem("🔍", "Find people", go(() => renderFamilyList())));
  nav.appendChild(acctItem("▢", "My QR", go(() => window.f360 && window.f360.openMyQr && window.f360.openMyQr({ type: "profile" }))));
  nav.appendChild(acctItem("📷", "Scan QR", go(() => window.f360 && window.f360.openQrScan && window.f360.openQrScan())));
  nav.appendChild(acctItem("🔔", "Notifications", go(() => window.f360 && window.f360.openNotifications && window.f360.openNotifications())));
  nav.appendChild(acctItem("✉️", "Inbox", go(() => renderInbox())));
  nav.appendChild(acctItem("💬", "Chat rooms", go(() => renderInbox({ filter: "groups" }))));
  nav.appendChild(acctItem("◈", "Community", go(() => renderCommunityFeed(uiBag()))));
  nav.appendChild(acctItem("🏷", "Marketplace", go(() => openMarketPanel())));
  nav.appendChild(acctItem("☺", "Friends", go(() => renderFamilyList("", { tab: "friends" }))));
  nav.appendChild(acctItem("📌", "Save a place", go(() => openAddPlace())));
  nav.appendChild(acctItem("?", "Help", go(() => renderHelp("welcome"))));
  nav.appendChild(make("div",{className:"acct-sec"}, "Account"));
  if(!s){
    nav.appendChild(acctItem("→", "Sign in / Register", go(() => renderAuth()), "primary"));
  } else {
    nav.appendChild(acctItem("☺", "Profile icon", go(() => renderAvatarPicker())));
    nav.appendChild(acctItem("✎", "Display name & contact", go(() => renderAccountEdit())));
    nav.appendChild(acctItem("🔒", "Change password", go(() => renderPasswordChange())));
    nav.appendChild(acctItem("🛡", "Privacy & security", go(() => renderPrivacySettings())));
    nav.appendChild(acctItem("🔔", "Phone alerts", go(() => renderHelp("alerts"))));
    nav.appendChild(acctItem("🎨", "Theme & appearance", go(() => renderThemePicker())));
    nav.appendChild(acctItem("⎋", "Sign out", async () => {
      closeAccountDrawer();
      if(!await ask("Sign out?")) return;
      apiTry("/api/logout", { method:"POST", body: {} });
      try{ if(socket) socket.close(); }catch(e){}
      stopTracking();
      clearTrail();
      setSession(null);
      closeModal();
      hidePinSheet();
      renderAuth();
    }));
    nav.appendChild(acctItem("🗑", "Delete account", go(() => renderDeleteAccount()), "danger"));
  }
  nav.appendChild(make("div",{className:"acct-sec"}, t("acct.language")));
  const langRow = make("div", { className: "lang-switch" });
  [["en", t("lang.en")], ["es", t("lang.es")]].forEach(([code, label]) => {
    const b = make("button", { className: "tb-btn" + (getLang() === code ? " on" : ""), type: "button" }, label);
    b.setAttribute("aria-pressed", getLang() === code ? "true" : "false");
    b.onclick = () => { setLang(code); paintAccountDrawer(); updateUIForSession(); };
    langRow.appendChild(b);
  });
  nav.appendChild(langRow);
  nav.appendChild(make("div",{className:"acct-sec"}, "About"));
  nav.appendChild(acctItem("ⓘ", "About the developer", go(() => renderAboutDeveloper())));
}
function bindDrawer(){
  const famBtn = qs("#btn-family"), closeBtn = qs("#drawer-close"), scrim = qs("#drawer-scrim");
  if(famBtn) famBtn.onclick = () => {
    const d = qs("#drawer");
    if(d && d.classList.contains("open")) closeDrawer(); else openDrawer();
  };
  if(closeBtn) closeBtn.onclick = closeDrawer;
  if(scrim) scrim.onclick = closeDrawer;
  const createDrawer = qs("#btn-create-family-drawer");
  if(createDrawer) createDrawer.onclick = () => { closeDrawer(); renderCreateJoin(); };
  const find = qs("#drawer-find");
  if(find){
    find.addEventListener("keydown", (e) => {
      if(e.key === "Enter"){
        e.preventDefault();
        const q = find.value.trim();
        closeDrawer();
        renderFamilyList(q);
      }
    });
  }
  const acctBtn = qs("#btn-account");
  const acctClose = qs("#account-close");
  const acctScrim = qs("#account-scrim");
  if(acctBtn) acctBtn.onclick = () => {
    const d = qs("#account-drawer");
    if(d && d.classList.contains("open")) closeAccountDrawer(); else openAccountDrawer();
  };
  if(acctClose) acctClose.onclick = closeAccountDrawer;
  if(acctScrim) acctScrim.onclick = closeAccountDrawer;
  const avBtn = qs("#acct-avatar-btn");
  if(avBtn) avBtn.onclick = () => {
    const sess = currentSession();
    if(!sess) { closeAccountDrawer(); renderAuth(); return; }
    closeAccountDrawer();
    renderAvatarPicker();
  };
}

function openAddPlace(){
  if(!map) return notice("Map is still loading.");
  const center = map.getCenter();
  const wrap = make("div",{style:"display:flex;flex-direction:column;gap:8px;min-width:280px"});
  wrap.appendChild(make("h3",{}, "Add Named Place"));
  const name = make("input",{className:"input", placeholder:"Name (e.g. Home)"});
  const desc = make("input",{className:"input", placeholder:"Optional description"});
  const save = make("button",{className:"btn", type:"button"}, "Save Place at map center");
  save.onclick = () => {
    const p = { id: uid("p"), name: name.value || "Place", desc: desc.value || "", lat: center.lat, lng: center.lng, createdAt: now() };
    savePlace(p);
    notice("Place saved: " + p.name);
    closeModal();
  };
  wrap.append(name, desc, make("div",{className:"row", style:"justify-content:flex-end"}, save));
  showModal(wrap, { variant: "form" });
}

function renderAccountEdit(){
  const s = currentSession(); if(!s) return renderAuth();
  const u = getUserById(s.userId) || {};
  const wrap = make("div");
  wrap.appendChild(make("h3",{}, "Display name & contact"));
  const name = make("input",{className:"input", value: u.name || ""});
  const email = make("input",{className:"input", value: u.email || ""});
  const phone = make("input",{className:"input", value: u.phone || ""});
  const save = make("button",{className:"btn", type:"button"}, "Save");
  save.onclick = async () => {
    try{
      const j = await api("/api/me", { method:"PUT", body: { name: name.value.trim(), email: email.value.trim(), phone: phone.value.trim() } });
      if(j && j.user) cacheUserFromServer(j.user);
      paintAccountDrawer();
      updateUIForSession();
      notice("Profile updated.");
      closeModal();
    }catch(e){ notice(e.message || "Could not save"); }
  };
  wrap.append(
    make("label",{}, "Display name"), name,
    make("label",{}, "Email"), email,
    make("label",{}, "Phone"), phone,
    make("div",{className:"row", style:"margin-top:12px;justify-content:flex-end"}, save)
  );
  showModal(wrap, { variant: "form" });
}

function renderPasswordChange(){
  const s = currentSession(); if(!s) return renderAuth();
  const wrap = make("div");
  wrap.appendChild(make("h3",{}, "Change password"));
  wrap.appendChild(make("p",{className:"small-muted"}, "If you signed in with Google or a demo account and never set a password, leave Current blank."));
  const cur = make("input",{className:"input", type:"password", placeholder:"Current password"});
  const n1 = make("input",{className:"input", type:"password", placeholder:"New password (min 6)"});
  const n2 = make("input",{className:"input", type:"password", placeholder:"Verify new password"});
  const save = make("button",{className:"btn", type:"button"}, "Update password");
  save.onclick = async () => {
    if((n1.value || "").length < 6) return notice("New password must be at least 6 characters.");
    if(n1.value !== n2.value) return notice("New passwords do not match.");
    try{
      await api("/api/me/password", { method:"POST", body: { current: cur.value, next: n1.value } });
      notice("Password updated.");
      closeModal();
    }catch(e){ notice(e.message || "Could not change password"); }
  };
  wrap.append(make("label",{}, "Current"), cur, make("label",{}, "New"), n1, n2, make("div",{className:"row", style:"margin-top:12px;justify-content:flex-end"}, save));
  showModal(wrap, { variant: "form" });
}

function renderPrivacySettings(){
  const s = currentSession(); if(!s) return renderAuth();
  const u = getUserById(s.userId) || {};
  const prefs = memberPrefs(u);
  const wrap = make("div");
  wrap.appendChild(make("h3",{}, "Privacy & security"));
  wrap.appendChild(make("p",{className:"small-muted"}, "These controls decide what family, friends, and search can see. Search never shows your coordinates. Blocked people cannot DM you."));
  const rows = [
    ["appearOnMap", "Show my pin on the family map"],
    ["preciseLocation", "Share precise GPS (off = city-block approximate)"],
    ["showLastSeen", "Show last-seen time on my pin"],
    ["shareEmailWithFamily", "Share email with family"],
    ["sharePhoneWithFamily", "Share phone with family"],
    ["allowHistory", "Allow family to view my location history"],
    ["recordHistory", "Record my trail every minute while Track is On"],
    ["shareLocationWithFriends", "Share map pin with accepted friends"],
    ["shareEmailWithFriends", "Share email with friends"],
    ["sharePhoneWithFriends", "Share phone with friends"],
    ["allowFriendRequests", "Allow friend requests"],
    ["appearInSearch", "Appear in directory search"],
    ["showOnlineStatus", "Show when I am online"],
    ["allowMarketplaceContact", "Allow marketplace buyers to message me"],
    ["readReceipts", "Send read receipts"],
    ["typingIndicators", "Send typing indicators"],
    ["hideBlockedInSearch", "Hide people I blocked from my search"]
  ];
  const state = Object.assign({}, prefs);
  rows.forEach(([key, label]) => {
    const row = make("div",{className:"pref-row"});
    row.appendChild(make("label",{}, label));
    const sw = make("input",{className:"switch", type:"checkbox"});
    sw.checked = state[key] !== false;
    sw.onchange = () => { state[key] = sw.checked; };
    row.appendChild(sw);
    wrap.appendChild(row);
  });
  function enumRow(key, label, options){
    const row = make("div",{className:"pref-row"});
    row.appendChild(make("label",{}, label));
    const sel = make("select",{className:"input", style:"width:auto;min-width:140px"});
    options.forEach(([v,l]) => sel.appendChild(make("option",{value:v}, l)));
    sel.value = state[key] || options[0][0];
    sel.onchange = () => { state[key] = sel.value; };
    row.appendChild(sel);
    wrap.appendChild(row);
  }
  enumRow("allowMessagesFrom", "Who can message me", [["anyone","Anyone"],["friends","Friends & family"],["family","Family only"],["nobody","Nobody"]]);
  enumRow("allowCallsFrom", "Who can call me", [["anyone","Anyone"],["friends","Friends & family"],["family","Family only"]]);
  enumRow("showProfileTo", "Who sees my photo", [["everyone","Everyone"],["friends","Friends & family"],["family","Family only"]]);
  enumRow("findByName", "Find me by name", [["everyone","Anyone"],["friends","Friends only"],["nobody","Nobody"]]);
  enumRow("findByEmail", "Find me by email", [["everyone","Anyone"],["nobody","Nobody"]]);
  enumRow("findByPhone", "Find me by phone", [["everyone","Anyone"],["nobody","Nobody"]]);
  const save = make("button",{className:"btn", type:"button"}, "Save privacy");
  save.onclick = async () => {
    try{
      const j = await api("/api/me", { method:"PUT", body: { prefs: state } });
      if(j && j.user) cacheUserFromServer(j.user);
      notice("Privacy settings saved. Family pins will refresh.");
      closeModal();
      refreshMapPins();
    }catch(e){ notice(e.message || "Could not save"); }
  };
  wrap.appendChild(make("div",{className:"row", style:"margin-top:14px;justify-content:flex-end"}, save));
  showModal(wrap, { variant: "form" });
}

function renderThemePicker(){
  const wrap = make("div");
  wrap.appendChild(make("h3",{}, "Theme & appearance"));
  wrap.appendChild(make("p",{className:"small-muted"}, "Personalize GPS FAMILIA. Your choice stays on this device."));
  const grid = make("div",{className:"theme-grid"});
  const cur = localStorage.getItem(THEME_KEY) || "dark";
  const themes = [
    ["dark", "Midnight"],
    ["gold", "Godfather gold"],
    ["noir", "Noir"],
    ["light", "Daylight"]
  ];
  themes.forEach(([id, label]) => {
    const b = make("button",{className:"theme-swatch" + (cur===id ? " on" : ""), type:"button"}, label);
    b.onclick = () => {
      applyTheme(id);
      grid.querySelectorAll(".theme-swatch").forEach(x => x.classList.remove("on"));
      b.classList.add("on");
    };
    grid.appendChild(b);
  });
  wrap.appendChild(grid);
  showModal(wrap, { variant: "form" });
}

function renderDeleteAccount(){
  const s = currentSession(); if(!s) return renderAuth();
  const wrap = make("div");
  wrap.appendChild(make("h3",{}, "Delete account"));
  wrap.appendChild(make("p",{className:"privacy-note"}, "This permanently removes your login, pins, and messages you sent. Demo sample members cannot be deleted."));
  const pw = make("input",{className:"input", type:"password", placeholder:"Password to confirm"});
  const go = make("button",{className:"btn", type:"button", style:"background:var(--danger);color:#fff"}, "Delete my account");
  go.onclick = async () => {
    if(!await ask("Delete your GPS FAMILIA account? This cannot be undone.")) return;
    try{
      await api("/api/me", { method:"DELETE", body: { password: pw.value } });
      try{ if(socket) socket.close(); }catch(e){}
      setSession(null);
      closeModal();
      notice("Account deleted.");
      renderAuth();
    }catch(e){ notice(e.message || "Could not delete account"); }
  };
  wrap.append(pw, make("div",{className:"row", style:"margin-top:12px;justify-content:flex-end"}, go));
  showModal(wrap, { variant: "form" });
}

function renderAboutDeveloper(){
  const wrap = make("div");
  wrap.appendChild(make("div",{className:"help-kicker"}, "Hustler Anomalies Enterprises"));
  wrap.appendChild(make("h3",{}, "About GPS FAMILIA"));
  wrap.appendChild(make("p",{}, "GPS FAMILIA is a private family locator and encrypted messenger. It is a consumer convenience tool — not 911, not a surveillance product."));
  wrap.appendChild(make("p",{className:"small-muted"}, "Operator: Hustler Anomalies Enterprises, together with the developer(s) and associated parties. The Service is provided as-is. Full legal terms live in Help → Terms."));
  wrap.appendChild(make("p",{}, "Family. Loyalty. Location."));
  const terms = make("button",{className:"btn small", type:"button"}, "Open Terms");
  terms.onclick = () => { closeModal(); renderHelp("terms"); };
  wrap.appendChild(make("div",{className:"row", style:"margin-top:12px"}, terms));
  showModal(wrap, { variant: "form" });
}

function userCard(u, opts={}){
  const inFam = u.inFamily || isFamilyWith(u.id);
  const row = make("div",{className:"user-hit"});
  const av = make("div",{className:"chat-avatar", style:"width:36px;height:36px;flex:0 0 36px;font-size:12px"});
  av.innerHTML = getAvatarFor(u);
  const info = make("div",{style:"flex:1;min-width:0"});
  const title = make("div",{style:"font-weight:700;display:flex;align-items:center;gap:6px"}, u.name || u.email || ("User "+String(u.id).slice(-4)));
  if(inFam) title.appendChild(make("span",{className:"fam-pill"}, "Family"));
  if(u.relationship && u.relationship.label){
    title.appendChild(make("span",{className:"rel-chip"}, u.relationship.label));
  }
  info.appendChild(title);
  const metaBits = [];
  if(u.phone) metaBits.push(u.phone);
  if(u.email) metaBits.push(u.email);
  info.appendChild(make("div",{className:"small-muted"}, metaBits.join(" • ") || "No contact on file"));
  if(!inFam){
    info.appendChild(make("div",{className:"small-muted"}, "Location hidden — not in your family"));
  }
  const actions = make("div",{className:"row", style:"flex:0 0 auto;flex-wrap:wrap;justify-content:flex-end"});
  const viewBtn = make("button",{className:"btn small secondary", type:"button"}, "Profile");
  viewBtn.onclick = () => { if(window.f360 && window.f360.openPeopleProfile) window.f360.openPeopleProfile(u.id); };
  actions.appendChild(viewBtn);
  const msgBtn = make("button",{className:"btn small", type:"button"}, (u.relationship && (u.relationship.state === "NONE" || u.relationship.state === "PENDING_OUTGOING")) ? "Request" : "Message");
  msgBtn.onclick = () => { closeModal(); renderMessagesForUser(u.id); };
  actions.appendChild(msgBtn);
  if(inFam && u.lastLocation && map){
    const mapBtn = make("button",{className:"btn small secondary", type:"button"}, "On map");
    mapBtn.onclick = () => { map.flyTo([u.lastLocation.lat, u.lastLocation.lng], 14); closeModal(); };
    actions.appendChild(mapBtn);
  }
  const fams = myFamilies();
  if(fams.length > 1){
    const sel = make("select",{className:"input", style:"width:auto;min-width:110px;padding:8px"});
    fams.forEach(f => sel.appendChild(make("option",{value:f.id}, f.name)));
    actions.appendChild(sel);
    const inviteBtn = make("button",{className:"btn small secondary", type:"button"}, "Invite");
    inviteBtn.onclick = () => renderInvitePerson(u);
    actions.appendChild(inviteBtn);
  } else {
    const inviteBtn = make("button",{className:"btn small secondary", type:"button"}, "Invite");
    inviteBtn.onclick = () => renderInvitePerson(u);
    actions.appendChild(inviteBtn);
  }
  if(!u.friend && !u.blocked){
    const fr = make("button",{className:"btn small secondary", type:"button"}, "Add friend");
    fr.onclick = async () => {
      const j = await apiTry("/api/friends/request", { method:"POST", body: { userId: u.id } });
      if(j && (j.ok || j.requested || j.accepted || j.already)) notice(j.accepted ? "You are now friends." : "Friend request sent.");
      else notice((j && j.error) || "Could not send request.");
    };
    actions.appendChild(fr);
  }
  const block = make("button",{className:"btn small secondary", type:"button"}, u.blocked ? "Blocked" : "Block");
  block.onclick = () => renderBlockUser(u);
  actions.appendChild(block);
  const rpt = make("button",{className:"btn small secondary", type:"button"}, "Report");
  rpt.onclick = () => renderReportUser(u.id);
  actions.appendChild(rpt);
  row.append(av, info, actions);
  return row;
}

async function renderBlockUser(u){
  const name = (u && u.name) || "this person";
  if(!await ask("Block " + name + "? They will not be able to message you. Existing friend request is removed.")) return;
  const j = await apiTry("/api/blocks", { method:"POST", body: { userId: u.id } });
  if(j && j.ok) notice("Blocked " + name + ".");
  else notice((j && j.error) || "Could not block.");
}

async function renderReportUser(userId, extra){
  extra = extra || {};
  const wrap = make("div");
  wrap.appendChild(make("h3",{}, "Report"));
  wrap.appendChild(make("p",{className:"small-muted"}, "Reports go to the operator. We do not notify the other person. False reports may lead to account limits."));
  const reason = make("select",{className:"input"});
  [["spam","Spam"],["harassment","Harassment"],["stalking","Stalking / unwanted tracking"],["impersonation","Impersonation"],["scam","Scam"],["fake_listing","Fake marketplace listing"],["inappropriate","Inappropriate"],["underage","Underage user"],["other","Other"]].forEach(([v,l]) => reason.appendChild(make("option",{value:v}, l)));
  const details = make("textarea",{className:"input", placeholder:"Optional details", style:"min-height:72px"});
  const go = make("button",{className:"btn", type:"button"}, "Submit report");
  go.onclick = async () => {
    const j = await apiTry("/api/reports", { method:"POST", body: { userId, reason: reason.value, details: details.value, listingId: extra.listingId || undefined } });
    if(j && j.ok){ notice("Report submitted."); closeModal(); }
    else notice((j && j.error) || "Could not report.");
  };
  wrap.append(reason, details, make("div",{className:"row", style:"margin-top:10px;justify-content:flex-end"}, go));
  showModal(wrap, { variant: "form" });
}

function showFamilyBriefing(b){
  if(!b) return;
  const wrap = make("div");
  wrap.appendChild(make("div",{className:"help-kicker"}, "Family permissions"));
  wrap.appendChild(make("h3",{}, b.familyName || "Family"));
  wrap.appendChild(make("p",{}, "You joined as " + (b.roleLabel || b.role || "Member") + ". Read this before you share location."));
  if(b.youCan && b.youCan.length){
    wrap.appendChild(make("h4",{}, "What you can do"));
    const ul = make("ul");
    b.youCan.forEach((line) => ul.appendChild(make("li",{}, line)));
    wrap.appendChild(ul);
  }
  if(b.theyCan && b.theyCan.length){
    wrap.appendChild(make("h4",{}, "What this family can see"));
    const ul = make("ul");
    b.theyCan.forEach((line) => ul.appendChild(make("li",{}, line)));
    wrap.appendChild(ul);
  }
  if(b.roles && b.roles.length){
    wrap.appendChild(make("h4",{}, "Roles in this family"));
    const ul = make("ul");
    b.roles.forEach((r) => {
      const n = Object.keys(r.privileges || {}).filter((k) => r.privileges[k]).length;
      ul.appendChild(make("li",{}, (r.label || r.key) + " — " + n + " privileges"));
    });
    wrap.appendChild(ul);
  }
  if(b.note) wrap.appendChild(make("div",{className:"help-callout"}, b.note));
  const ok = make("button",{className:"btn", type:"button"}, "I understand");
  ok.onclick = () => closeModal();
  wrap.appendChild(make("div",{className:"row", style:"margin-top:12px;justify-content:flex-end"}, ok));
  showModal(wrap, { variant: "form" });
}

function renderFamilyList(prefillQ, opts){
  opts = opts || {};
  let tab = opts.tab || "people";
  const wrap = make("div",{className:"people-app"});
  wrap.appendChild(make("div",{className:"help-kicker"}, "Directory"));
  wrap.appendChild(make("h3",{}, "People & invites"));
  const tabs = make("div",{className:"people-tabs"});
  const tabMap = {};
  [["people","People"],["friends","Friends"],["families","Families"],["requests","Requests"],["invite","Invite link"]].forEach(([id,label]) => {
    const b = make("button",{className:"inbox-chip", type:"button"}, label);
    b.dataset.id = id;
    b.onclick = () => { tab = id; syncTabs(); paintTab(); };
    tabMap[id] = b;
    tabs.appendChild(b);
  });
  wrap.appendChild(tabs);
  const reqBox = make("div");
  wrap.appendChild(reqBox);
  function syncTabs(){
    Object.keys(tabMap).forEach(id => tabMap[id].classList.toggle("on", tab === id));
    hero.style.display = (tab === "people" || tab === "families" || tab === "friends") ? "" : "none";
    resultsWrap.style.display = (tab === "people" || tab === "families" || tab === "friends") ? "" : "none";
    myWrap.style.display = (tab === "families" || tab === "invite") ? "" : "none";
    reqBox.style.display = tab === "requests" ? "" : "none";
  }
  function paintTab(){
    syncTabs();
    if(tab === "people" || tab === "families" || tab === "friends") renderResults(searchInput.value);
    if(tab === "requests") paintRequests();
  }
  async function paintRequests(){
    reqBox.innerHTML = "";
    reqBox.appendChild(make("div",{className:"small-muted"}, "Loading requests…"));
    const hub = await apiTry("/api/people/hub");
    reqBox.innerHTML = "";
    const incoming = [...((hub && hub.incomingJoins) || []), ...((hub && hub.incomingInvites) || [])];
    const outgoing = (hub && hub.outgoing) || [];
    if(tabMap.requests){
      const n = incoming.length;
      tabMap.requests.textContent = n ? ("Requests · " + n) : "Requests";
    }
    if(!incoming.length && !outgoing.length){
      reqBox.appendChild(make("div",{className:"privacy-note"}, "No pending invites. Search for someone and tap Invite, or share a family link."));
      return;
    }
    function reqRow(r, mineIncoming){
      const card = make("div",{className:"req-card"});
      const av = make("div",{className:"chat-avatar"});
      av.innerHTML = getAvatarFor(getUserById(r.userId) || { id: r.userId, name: r.name });
      const info = make("div",{style:"flex:1;min-width:0"});
      info.appendChild(make("div",{style:"font-weight:800"}, r.name || "Member"));
      const line = r.kind === "invite"
        ? ((r.fromName || "Family") + " invited you to " + (r.familyName || "a family"))
        : ((r.name || "Someone") + " wants to join " + (r.familyName || "your family"));
      info.appendChild(make("div",{className:"small-muted"}, line));
      const actions = make("div",{className:"req-actions"});
      if(mineIncoming){
        const yes = make("button",{className:"btn small", type:"button"}, "Accept");
        const no = make("button",{className:"btn small secondary", type:"button"}, "Decline");
        yes.onclick = async () => {
          const j = await apiTry("/api/people/requests/" + encodeURIComponent(r.id) + "/accept", { method:"POST", body: {} });
          if(j && j.ok) { await notice("Accepted."); paintRequests(); syncFromServer(); updateFamilyMarkers(); if(j.briefing) showFamilyBriefing(j.briefing); }
          else notice("Could not accept.");
        };
        no.onclick = async () => {
          await apiTry("/api/people/requests/" + encodeURIComponent(r.id) + "/decline", { method:"POST", body: {} });
          paintRequests();
        };
        actions.append(yes, no);
      } else {
        actions.appendChild(make("div",{className:"small-muted"}, "Waiting"));
      }
      card.append(av, info, actions);
      return card;
    }
    if(incoming.length){
      reqBox.appendChild(make("div",{className:"small-muted"}, "Needs a decision"));
      incoming.forEach(r => reqBox.appendChild(reqRow(r, true)));
    }
    if(outgoing.length){
      reqBox.appendChild(make("div",{className:"small-muted", style:"margin-top:10px"}, "Waiting on them"));
      outgoing.forEach(r => reqBox.appendChild(reqRow(r, false)));
    }
    const suggested = (hub && hub.suggested) || [];
    if(suggested.length){
      reqBox.appendChild(make("div",{className:"small-muted", style:"margin-top:12px"}, "People you may know"));
      const row = make("div",{className:"people-suggest"});
      suggested.forEach(u => {
        const b = make("button",{className:"people-chip", type:"button"});
        const av = make("div",{className:"chat-avatar"});
        av.innerHTML = getAvatarFor(u);
        b.append(av, make("span",{className:"small-muted"}, (u.name||"User").split(" ")[0]));
        b.onclick = () => renderInvitePerson(u);
        row.appendChild(b);
      });
      reqBox.appendChild(row);
    }
  }


  const hero = make("div",{className:"search-hero"});
  const searchInput = make("input",{className:"input", type:"search", placeholder:"Search by name, phone, or email…", autocomplete:"off"});
  if(prefillQ) searchInput.value = prefillQ;
  hero.appendChild(make("label",{}, "Directory search"));
  hero.appendChild(searchInput);
  hero.appendChild(make("div",{className:"privacy-note"}, "Search the live database by name or phone. Other users’ locations are never shown unless they belong to one of your families."));
  wrap.appendChild(hero);

  const resultsWrap = make("div",{style:"max-height:360px;overflow:auto;display:flex;flex-direction:column;gap:8px"});
  wrap.appendChild(resultsWrap);

  async function renderResults(q){
    resultsWrap.innerHTML = "";
    const query = (q || "").trim();
    const families = storage.get(DB.familiesKey) || [];
    const users = storage.get(DB.usersKey) || [];
    const qLower = query.toLowerCase();
    const qDigits = digits(query);

    let remote = await apiTry("/api/search" + (query.length >= 1 ? ("?q=" + encodeURIComponent(query)) : ""));

    let famMatches = remote && remote.families
      ? remote.families.filter(f => !f.isMember)
      : families.filter(f => (f.privacy === "public") && (!qLower || (f.name||"").toLowerCase().includes(qLower) || (f.id && f.id.includes(qLower))));

    let qUsers = remote && remote.users
      ? remote.users
      : users.filter(u => {
          const s = currentSession();
          if(s && u.id === s.userId) return false;
          if(!qLower) return false;
          const name = (u.name || "").toLowerCase();
          const email = (u.email || "").toLowerCase();
          const phone = (u.phone || "").toLowerCase();
          const phD = digits(u.phone);
          return name.includes(qLower) || email.includes(qLower) || phone.includes(qLower) || (qDigits.length >= 3 && phD.includes(qDigits));
        }).map(u => Object.assign({}, u, { inFamily: isFamilyWith(u.id), lastLocation: isFamilyWith(u.id) ? u.lastLocation : undefined }));

    if(tab === "people") famMatches = [];
    if(tab === "families") qUsers = [];
    if(tab === "friends"){
      famMatches = [];
      qUsers = qUsers.filter(u => u.friend);
    }

    if(!query && tab === "people" && !qUsers.length){
      const hub = await apiTry("/api/people/hub");
      if(hub && Array.isArray(hub.suggested) && hub.suggested.length) qUsers = hub.suggested;
    }

    if(!query){
      const emptyMsg = tab === "families"
        ? "Public families you can join — tap one to join."
        : tab === "friends"
          ? "Friends appear here. Search People and tap Add friend."
          : "People in the directory. Search a name, phone, or email, or tap Invite / Add friend.";
      resultsWrap.appendChild(make("div",{className:"small-muted"}, emptyMsg));
    }

    if(qUsers.length){
      resultsWrap.appendChild(make("div",{className:"small-muted", style:"margin:4px 0"}, "People"));
      qUsers.forEach(u => resultsWrap.appendChild(userCard(u)));
    }

    if(famMatches.length){
      resultsWrap.appendChild(make("div",{className:"small-muted", style:"margin:8px 0 4px"}, "Public families you can join"));
      famMatches.forEach(f=>{
        const card = make("div",{className:"family-card"});
        const count = f.memberCount != null ? f.memberCount : (f.members||[]).length;
        const info = make("div",{}, make("div",{}, f.name), make("div",{className:"small-muted"}, `${count} members • you can join in addition to families you already have`));
        const actions = make("div",{className:"row"});
        const joinBtn = make("button",{className:"btn small"}, "Join");
        joinBtn.onclick = async () => {
          if(!currentSession()){ notice("Sign in first"); return; }
          const j = await apiTry(`/api/families/${f.id}/join`, { method:"POST", body: {} });
          if(j && j.family){
            cacheFamily(j.family);
            notice("Joined " + f.name + ". Location will be shared with that family only.");
            closeModal();
            updateFamilyMarkers();
            if(j.briefing) showFamilyBriefing(j.briefing);
            return;
          }
          if(j && j.requested){
            notice("Request sent to the family owner. They must accept you before location is shared.");
            return;
          }
          notice("Request sent to family admins. They must accept you before location is shared.");
        };
        actions.append(joinBtn);
        card.append(info, actions);
        resultsWrap.appendChild(card);
      });
    }

    const roomHits = (remote && remote.rooms) || [];
    if(roomHits.length){
      resultsWrap.appendChild(make("div",{className:"small-muted", style:"margin:8px 0 4px"}, "Chat rooms"));
      roomHits.forEach(r => {
        const card = make("div",{className:"family-card"});
        const info = make("div",{}, make("div",{}, r.name || "Room"), make("div",{className:"small-muted"}, (r.topic || "Group") + " • " + (r.memberCount || 0) + " members • " + (r.privacy || "private")));
        const actions = make("div",{className:"row"});
        if(r.isMember){
          const open = make("button",{className:"btn small"}, "Open chat");
          open.onclick = () => { closeModal(); renderRoomChat(r.id); };
          actions.appendChild(open);
        } else {
          const join = make("button",{className:"btn small"}, "Join");
          join.onclick = async () => {
            const j = await apiTry("/api/rooms/" + encodeURIComponent(r.id) + "/join", { method:"POST", body: {} });
            if(j && j.room){
              cacheRoom(j.room);
              notice("Joined " + (j.room.name || r.name));
              closeModal();
              renderRoomChat(r.id);
            } else notice((j && j.error) || "Could not join this room.");
          };
          actions.appendChild(join);
        }
        card.append(info, actions);
        resultsWrap.appendChild(card);
      });
    }

    const postHits = (remote && remote.posts) || [];
    if(postHits.length){
      resultsWrap.appendChild(make("div",{className:"small-muted", style:"margin:8px 0 4px"}, "Community posts"));
      postHits.forEach(p => {
        const card = make("div",{className:"family-card"});
        const info = make("div",{}, make("div",{}, (p.authorName || "User") + " · " + (p.audience === "public" ? "Everyone" : "Family")), make("div",{className:"small-muted"}, p.text || ""));
        const open = make("button",{className:"btn small"}, "Open feed");
        open.onclick = () => { closeModal(); openFeedPanel({ postId: p.id }); };
        card.append(info, open);
        resultsWrap.appendChild(card);
      });
    }

    if(query && famMatches.length===0 && qUsers.length===0 && postHits.length===0 && roomHits.length===0){
      resultsWrap.appendChild(make("div",{className:"small-muted"}, "No people, rooms, posts, or public families matched that name or number."));
    }
  }

  searchInput.addEventListener("input", debounce(() => renderResults(searchInput.value), 220));
  searchInput.addEventListener("keydown", (e) => { if(e.key === "Enter"){ e.preventDefault(); renderResults(searchInput.value); } });

  const myWrap = make("div",{style:"margin-top:12px"});
  myWrap.appendChild(make("h3",{}, "Your Families"));
  const list = make("div",{className:"family-list"});
  const s = currentSession();
  if(!s) { list.appendChild(make("div",{}, "Sign in to see families.")); }
  else {
    const mine = myFamilies();
    if(mine.length===0) list.appendChild(make("div",{}, "No families yet — you can join several once you create or accept invites."));
    mine.forEach(f=>{
      const card = make("div",{className:"family-card"});
      const info = make("div",{}, make("div",{}, f.name), make("div",{className:"small-muted"}, (f.privacy || "private") + " • " + (f.members||[]).length + " members"));
      const actions = make("div",{className:"row"});
      const centerBtn = make("button",{className:"btn small secondary"}, "Center Map");
      centerBtn.onclick = () => { centerOnFamily(f.id); closeModal(); };
      const chatBtn = make("button",{className:"btn small"}, "Family chat");
      chatBtn.onclick = () => { closeModal(); renderFamilyChat(f.id); };
      const inviteBtn = make("button",{className:"btn small secondary"}, "Invite / QR");
      inviteBtn.onclick = () => { openShareModal(f); };
      const setBtn = make("button",{className:"btn small secondary"}, "Settings");
      setBtn.onclick = () => { closeModal(); renderFamilyAdmin(uiBag(), f.id); };
      actions.append(centerBtn, chatBtn, inviteBtn, setBtn);
      card.append(info, actions);
      list.appendChild(card);
    });
  }
  myWrap.appendChild(list);

  const pasteBox = make("div",{style:"margin-top:12px"});
  pasteBox.appendChild(make("h3",{}, "Have an invite?"));
  pasteBox.appendChild(make("div",{className:"small-muted"}, "Paste a link or token, scan in-app, or use your phone camera on the QR. After sign-in, Accept to join."));
  const pasteIn = make("input",{className:"input", placeholder:"Paste invite link or token"});
  pasteIn.setAttribute("aria-label","Invite link or token");
  const pasteBtn = make("button",{className:"btn small", type:"button"}, "Preview & join");
  pasteBtn.onclick = () => openInviteFromRaw(pasteIn.value);
  const scanBtn = make("button",{className:"btn small secondary", type:"button"}, "Scan QR");
  scanBtn.onclick = async () => {
    const tok = await scanInviteFromCamera();
    if(!tok) return;
    pasteIn.value = tok;
    if(window.f360 && typeof window.f360.routeQr === "function") await window.f360.routeQr(tok);
    else await openInviteFromRaw(tok);
  };
  pasteBox.append(pasteIn, pasteBtn, scanBtn);
  myWrap.appendChild(pasteBox);
  wrap.appendChild(myWrap);
  wrap.appendChild(make("div",{className:"row", style:"justify-content:flex-end;margin-top:10px"}, make("button",{className:"btn small secondary", onclick:()=>{ closeModal(); renderCreateJoin(); }}, "Create/Join")));
  showModal(wrap);

  renderResults(searchInput.value || "");
  paintRequests();
  syncTabs();
  if(tab === "requests") paintTab();
  setTimeout(()=> searchInput.focus(), 50);
}

let markers = {}, userMarker = null, watchId = null, trackingEnabled = false;
let historyTimer = null, lastFix = null, trailGroup = null;
let map = null;
let baseLayers = { street: null, satellite: null, terrain: null };
let currentBase = "street";
let placeMarkers = {};

function initMap(){
  try{ if(map && map.remove) map.remove(); }catch(e){ console.warn("Previous map remove failed", e); }
  map = null;

  if(typeof window.L === "undefined"){
    setTimeout(initMap, 100);
    return;
  }

  map = L.map("map", {
    center: [39.7392, -104.9903],
    zoom: 12.5,
    zoomControl: false,
    attributionControl: true,
    preferCanvas: true,
    trackResize: true
  });

  baseLayers.street = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: '© OpenStreetMap contributors', crossOrigin:true, reuseTiles:true, detectRetina:true
  });
  baseLayers.satellite = L.tileLayer("https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 19, attribution: 'Esri', crossOrigin:true, reuseTiles:true, detectRetina:true
  });
  baseLayers.terrain = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
    maxZoom: 17, attribution: '© OpenTopoMap (CC-BY-SA)', crossOrigin:true, reuseTiles:true, detectRetina:true
  });

  baseLayers.street.addTo(map);

  const layerCtl = qs("#layer-control");
  if(layerCtl){
    layerCtl.querySelectorAll(".layer-btn").forEach(btn=>{
      btn.onclick = () => switchBase(btn.dataset.layer);
    });
  }

  function switchBase(kind){
    if(kind === currentBase) return;
    if(currentBase && baseLayers[currentBase]) map.removeLayer(baseLayers[currentBase]);
    if(baseLayers[kind]) baseLayers[kind].addTo(map);
    currentBase = kind;
    const parent = qs("#layer-control");
    if(parent){
      parent.querySelectorAll(".layer-btn").forEach(b=> b.classList.toggle("active", b.dataset.layer === kind));
    }
  }

  bindMapTools();

  if(!qs(".map-legend")){
    const legend = make("div",{className:"map-legend"}, "Markers show family members who have shared location. People outside your families never appear on the map.");
    document.body.appendChild(legend);
  }

  map.on("moveend", ()=>{
    const c = map.getCenter();
    localStorage.setItem("f360_view", JSON.stringify({center:[c.lat,c.lng], zoom: map.getZoom(), base: currentBase}));
  });

  const last = JSON.parse(localStorage.getItem("f360_view") || "null");
  if(last && last.center && last.center.length === 2){
    map.setView([ last.center[0], last.center[1] ], last.zoom || 12);
    if(last.base && baseLayers[last.base]){ baseLayers[last.base].addTo(map); currentBase = last.base; }
  } else {
    map.setView([39.7392, -104.9903], 12.5);
  }

  const layerCtl2 = qs("#layer-control");
  if(layerCtl2){
    layerCtl2.querySelectorAll(".layer-btn").forEach(b=> b.classList.toggle("active", b.dataset.layer === currentBase));
  }

  window.reflowMap = () => { try{ map.invalidateSize(true); }catch(e){} };
  window.addEventListener("resize", ()=>{ try{ map.invalidateSize(true); }catch(e){} });

  setTimeout(()=>{ try{ map.invalidateSize(true); }catch(e){} }, 150);

  renderSavedPlacesToMap();
  setInterval(updateFamilyMarkers, 3000);
}

function getSavedPlaces(){ return storage.get(DB.placesKey) || []; }
function savePlace(place){
  const places = getSavedPlaces();
  places.push(place);
  storage.set(DB.placesKey, places);
  renderSavedPlacesToMap();
  apiTry("/api/places", { method:"POST", body: place });
}
function renderSavedPlacesToMap(){
  if(!map) return;
  Object.values(placeMarkers).forEach(pm=>{ try{ map.removeLayer(pm); }catch(e){} });
  placeMarkers = {};
  const places = getSavedPlaces();
  places.forEach(p=>{
    const icon = L.divIcon({
      html: `<div style="display:flex;align-items:center;gap:8px;"><div style="width:36px;height:36px;border-radius:8px;background:rgba(45,212,191,0.15);display:flex;align-items:center;justify-content:center;border:2px solid rgba(45,212,191,0.25)">${(p.name||"P")[0] || "P"}</div><div style="background:rgba(2,6,23,0.85);color:#e6eef0;padding:6px 8px;border-radius:8px;font-weight:700;font-size:13px">${p.name}</div></div>`,
      className:"",
      iconSize: [160,48],
      iconAnchor: [18,18]
    });
    const m = L.marker([p.lat,p.lng],{icon}).addTo(map);
    m.on('click',()=>{ L.popup({offset:[0,-8]}).setContent(`<div style="padding:8px"><strong>${p.name}</strong><div class="small-muted" style="margin-top:6px">${p.desc||''}</div></div>`).setLatLng([p.lat,p.lng]).openOn(map); });
    placeMarkers[p.id] = m;
  });
}

function centerOnFamily(fid){
  const families = storage.get(DB.familiesKey) || [];
  const f = families.find(x=>x.id===fid); if(!f) return;
  const points = (f.members || []).map(mId => {
    const u = getUserById(mId);
    return u && u.lastLocation ? [u.lastLocation.lat, u.lastLocation.lng] : null;
  }).filter(Boolean);
  if(points.length===0) { notice("No shared locations available."); return; }
  if(points.length === 1){ map.flyTo(points[0], 14); return; }
  try{
    map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 15 });
  }catch(e){
    map.flyTo(points[0], 13);
  }
}

function memberPrefs(u){
  return Object.assign({
    appearOnMap: true, preciseLocation: true, showLastSeen: true,
    shareEmailWithFamily: true, sharePhoneWithFamily: true, allowHistory: true, recordHistory: true
  }, (u && u.prefs) || {});
}

function bindMapTools(){
  const zi = qs("#btn-zoom-in");
  const zo = qs("#btn-zoom-out");
  const rf = qs("#btn-map-refresh");
  const me = qs("#btn-map-me");
  if(zi) zi.onclick = () => { if(map) map.setZoom(Math.min((map.getZoom() || 12) + 1, 19)); };
  if(zo) zo.onclick = () => { if(map) map.setZoom(Math.max((map.getZoom() || 12) - 1, 2)); };
  if(rf) rf.onclick = () => refreshMapPins();
  if(me) me.onclick = () => centerOnMe();
  const ht = qs("#btn-map-trail");
  if(ht) ht.onclick = () => {
    if(trailGroup){ clearTrail(); return; }
    const s = currentSession();
    if(!s) return notice("Sign in to map your trail.");
    drawUserTrail(s.userId);
  };
}

async function refreshMapPins(){
  const btn = qs("#btn-map-refresh");
  if(btn){ btn.classList.remove("spin"); void btn.offsetWidth; btn.classList.add("spin"); }
  const s = currentSession();
  if(!s){ notice("Sign in to refresh family pins."); return; }
  await syncFromServer();
  const locs = await apiTry("/api/locations");
  if(locs && Array.isArray(locs.locations)){
    locs.locations.forEach(l => {
      if(!l || !l.userId) return;
      applyRemoteLocation(l.userId, l.lat, l.lng, l.ts || now());
    });
  }
  updateFamilyMarkers();
  if(map) try{ map.invalidateSize(true); }catch(e){}
}

function hidePinSheet(){
  const el = qs("#pin-sheet");
  if(el){ el.hidden = true; el.innerHTML = ""; }
}

function showPinSheet(u, opts={}){
  const el = qs("#pin-sheet");
  if(!el || !u) return;
  const s = currentSession();
  const self = !!(s && s.userId === u.id);
  const inFam = self || isFamilyWith(u.id);
  const prefs = memberPrefs(u);
  const loc = opts.loc || (inFam && prefs.appearOnMap !== false ? u.lastLocation : null);
  el.hidden = false;
  el.innerHTML = "";
  const close = make("button",{className:"pin-close", type:"button", title:"Close"}, "✕");
  close.onclick = hidePinSheet;
  const head = make("div",{className:"pin-sheet-head"});
  const av = make("div",{className:"pin-sheet-av"});
  av.innerHTML = getAvatarFor(u);
  const info = make("div",{style:"min-width:0;flex:1"});
  info.appendChild(make("div",{style:"font-weight:800;font-size:16px"}, u.name || "User"));
  const bits = [];
  if(self) bits.push("You");
  else if(inFam) bits.push("Family");
  else bits.push("Not in your family");
  if(u.online) bits.push("Live");
  info.appendChild(make("div",{className:"small-muted"}, bits.join(" · ")));
  head.append(av, info);
  el.append(close, head);

  const body = make("div",{style:"margin-top:10px"});
  if(!inFam){
    body.appendChild(make("div",{className:"privacy-note"}, "Location, last seen, and contact details stay hidden until you share a family."));
  } else {
    if(loc){
      const approx = loc.approx ? "Approximate (privacy)" : "Precise";
      const ts = loc.ts ? new Date(loc.ts).toLocaleString() : (prefs.showLastSeen === false && !self ? "Last seen hidden" : "Time unknown");
      body.appendChild(make("div",{}, approx + " pin"));
      body.appendChild(make("div",{className:"small-muted"}, Number(loc.lat).toFixed(loc.approx ? 2 : 5) + ", " + Number(loc.lng).toFixed(loc.approx ? 2 : 5)));
      body.appendChild(make("div",{className:"small-muted"}, ts));
    } else {
      body.appendChild(make("div",{className:"privacy-note"}, self ? "Turn Track On to drop your pin." : "This member is not sharing a map pin (Track Off, Guest role, or their privacy settings)."));
    }
    if(inFam && prefs.shareEmailWithFamily !== false && u.email) body.appendChild(make("div",{className:"small-muted", style:"margin-top:6px"}, u.email));
    if(inFam && prefs.sharePhoneWithFamily !== false && u.phone) body.appendChild(make("div",{className:"small-muted"}, u.phone));
  }
  el.appendChild(body);

  const actions = make("div",{className:"pin-sheet-actions"});
  const msg = make("button",{className:"btn small", type:"button"}, "Message");
  msg.onclick = () => { hidePinSheet(); renderMessagesForUser(u.id); };
  actions.appendChild(msg);
  if(inFam && loc && map){
    const zoom = make("button",{className:"btn small secondary", type:"button"}, "Zoom in");
    zoom.onclick = () => { map.flyTo([loc.lat, loc.lng], 17); };
    actions.appendChild(zoom);
  }
  if(inFam && (self || prefs.allowHistory !== false)){
    const hist = make("button",{className:"btn small secondary", type:"button"}, "History");
    hist.onclick = () => { hidePinSheet(); renderHistoryForUser(u.id); };
    actions.appendChild(hist);
    const trail = make("button",{className:"btn small secondary", type:"button"}, "Map trail");
    trail.onclick = () => { hidePinSheet(); drawUserTrail(u.id); };
    actions.appendChild(trail);
  }
  el.appendChild(actions);
}

function focusMember(userId){
  const u = getUserById(userId);
  if(!u){ notice("Person not found."); return; }
  closeDrawer();
  closeAccountDrawer();
  const s = currentSession();
  const self = !!(s && s.userId === u.id);
  const inFam = self || isFamilyWith(u.id);
  const prefs = memberPrefs(u);
  const canSeePin = inFam && prefs.appearOnMap !== false && u.lastLocation;
  if(canSeePin && map){
    map.flyTo([u.lastLocation.lat, u.lastLocation.lng], 16, { duration: 0.75 });
    const rec = markers[u.id];
    if(rec && rec.marker){
      try{ rec.marker.setZIndexOffset(800); }catch(e){}
    }
  } else if(!inFam){
    notice("You can message " + (u.name || "them") + ", but their pin stays private until you share a family.");
  } else if(!u.lastLocation){
    /* sheet explains */
  }
  showPinSheet(u, { loc: canSeePin ? u.lastLocation : null });
}

function getUserById(id){ const users = storage.get(DB.usersKey)||[]; return users.find(u=>u.id===id); }
function saveUser(u){ let users = storage.get(DB.usersKey)||[]; const idx = users.findIndex(x=>x.id===u.id); if(idx>=0) users[idx]=u; else users.push(u); storage.set(DB.usersKey, users); }

const MSG_KEY = "f360_messages_v1";
if(!storage.get(MSG_KEY)) storage.set(MSG_KEY, []);
const enc = new TextEncoder();
const dec = new TextDecoder();
let msgKeyCache = {};

async function deriveConvKey(a,b){
  const pair = [a,b].sort().join("|");
  if(msgKeyCache[pair]) return msgKeyCache[pair];
  const hash = await crypto.subtle.digest("SHA-256", enc.encode("GPS-FAMILIA-E2E::" + pair));
  const key = await crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["encrypt","decrypt"]);
  msgKeyCache[pair] = key;
  return key;
}
async function aesEncrypt(key, obj){
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({name:"AES-GCM", iv}, key, enc.encode(JSON.stringify(obj)));
  const b64 = b => btoa(String.fromCharCode.apply(null, new Uint8Array(b)));
  return { iv: b64(iv), ct: b64(ct) };
}
async function aesDecrypt(key, box){
  try{
    const iv = Uint8Array.from(atob(box.iv), c=>c.charCodeAt(0));
    const ct = Uint8Array.from(atob(box.ct), c=>c.charCodeAt(0));
    const pt = await crypto.subtle.decrypt({name:"AES-GCM", iv}, key, ct);
    return JSON.parse(dec.decode(pt));
  }catch(e){ return null; }
}

async function sendEncryptedFamilyMessage(familyId, payload){
  const s = currentSession();
  if(!s) return;
  const key = await deriveConvKey("fam", familyId);
  const box = await aesEncrypt(key, payload);
  const msgs = storage.get(MSG_KEY) || [];
  const m = { id: uid("m"), from: s.userId, familyId, enc: box, ts: now() };
  msgs.push(m);
  storage.set(MSG_KEY, msgs);
  const posted = await apiTry("/api/messages", { method:"POST", body: { familyId, enc: box } });
  if(posted && posted.message) upsertServerMessage(posted.message);
  updateInboxBadge();
  return m;
}

function currentUserId(){ const s = currentSession(); return s && s.userId; }
function isDeletedForMe(m){
  const uid = currentUserId();
  return !!(m && Array.isArray(m.deletedFor) && uid && m.deletedFor.includes(uid));
}

async function deleteMessageById(id, mine){
  if(!id) return false;
  const ok = await ask(mine ? "Delete this message for everyone in the chat?" : "Remove this message from your view?");
  if(!ok) return false;
  const j = await apiTry("/api/messages/" + encodeURIComponent(id), { method: "DELETE" });
  removeLocalMessage(id);
  if(!j){
    /* still hide locally */
  }
  if(typeof window.__refreshOpenChat === "function") window.__refreshOpenChat();
  updateInboxBadge();
  return true;
}

function hideMsgMenu(){
  document.querySelectorAll(".msg-menu").forEach(n => n.remove());
}

function showMsgMenu(ev, m, mine, payload){
  hideMsgMenu();
  const menu = make("div",{className:"msg-menu"});
  const copy = make("button",{type:"button"}, "Copy");
  copy.onclick = async () => {
    hideMsgMenu();
    const t = (payload && payload.text) || "";
    try{ await navigator.clipboard.writeText(t); }catch(e){ notice(t || "Nothing to copy"); }
  };
  const del = make("button",{type:"button", className:"danger"}, mine ? "Delete for everyone" : "Delete for me");
  del.onclick = () => { hideMsgMenu(); deleteMessageById(m.id, mine); };
  menu.append(copy, del);
  document.body.appendChild(menu);
  const x = Math.min(window.innerWidth - 200, Math.max(8, (ev.clientX || 80)));
  const y = Math.min(window.innerHeight - 120, Math.max(8, (ev.clientY || 80)));
  menu.style.left = x + "px";
  menu.style.top = y + "px";
  const off = (e) => { if(!menu.contains(e.target)){ hideMsgMenu(); document.removeEventListener("mousedown", off); } };
  setTimeout(() => document.addEventListener("mousedown", off), 0);
}

function bindMessageGestures(row, m, mine, payload){
  row.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    showMsgMenu(e, m, mine, payload);
  });
  let t = null;
  row.addEventListener("touchstart", (e) => {
    const touch = e.touches && e.touches[0];
    t = setTimeout(() => {
      row.classList.add("held");
      showMsgMenu({ clientX: touch ? touch.clientX : 80, clientY: touch ? touch.clientY : 80 }, m, mine, payload);
    }, 520);
  }, { passive: true });
  const cancel = () => { clearTimeout(t); row.classList.remove("held"); };
  row.addEventListener("touchend", cancel);
  row.addEventListener("touchmove", cancel);
}

async function getDecryptedFamily(familyId){
  const key = await deriveConvKey("fam", familyId);
  const local = storage.get(MSG_KEY) || [];
  const remote = storage.get(DB.serverMsgsKey) || [];
  const map = new Map();
  [...remote, ...local].forEach(m => {
    if(m.familyId === familyId && !isDeletedForMe(m)) map.set(m.id, m);
  });
  const raw = Array.from(map.values()).sort((x,y)=>x.ts-y.ts);
  const out = [];
  for(const m of raw){
    if(m.enc){
      const payload = await aesDecrypt(key, m.enc) || { text: m.text || "🔒 [Unable to decrypt message]" };
      out.push({ ...m, payload });
    } else {
      out.push({ ...m, payload: { text: m.text || "", image: m.image, sos: m.kind === "sos" } });
    }
  }
  return out;
}

async function sendEncryptedMessage(fromId, toId, payload){
  const key = await deriveConvKey(fromId, toId);
  const box = await aesEncrypt(key, payload);
  const msgs = storage.get(MSG_KEY) || [];
  const m = { id: uid("m"), from: fromId, to: toId, enc: box, ts: now() };
  msgs.push(m);
  storage.set(MSG_KEY, msgs);
  const posted = await apiTry("/api/messages", { method:"POST", body: { to: toId, enc: box } });
  if(posted && posted.requested){
    notice("Message request sent. They'll see it after they accept.");
    return m;
  }
  if(posted && posted.message) upsertServerMessage(posted.message);
  updateInboxBadge();
  return m;
}

async function getDecryptedBetween(a,b){
  const key = await deriveConvKey(a,b);
  const local = storage.get(MSG_KEY) || [];
  const remote = storage.get(DB.serverMsgsKey) || [];
  const map = new Map();
  [...remote, ...local].forEach(m => {
    if(isDeletedForMe(m)) return;
    if((m.from===a && m.to===b) || (m.from===b && m.to===a)) map.set(m.id, m);
  });
  const raw = Array.from(map.values()).sort((x,y)=>x.ts-y.ts);
  const out = [];
  for(const m of raw){
    if(m.enc){
      const payload = await aesDecrypt(key, m.enc) || { text:"🔒 [Unable to decrypt message]" };
      out.push({ ...m, payload });
    } else {
      out.push({ ...m, payload: { text: m.text || "", image: m.image } });
    }
  }
  return out;
}

function fileToCompressedBlob(file){
  return fileToCompressedDataUrl(file).then((dataUrl) => {
    const parts = String(dataUrl).split(",");
    const head = parts[0] || "";
    const body = parts[1] || "";
    const mime = (head.match(/data:([^;]+)/) || [])[1] || "image/jpeg";
    const bin = atob(body);
    const arr = new Uint8Array(bin.length);
    for(let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  });
}

function fileToCompressedDataUrl(file){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const MAX = 1000;
        let { width, height } = img;
        const scale = Math.min(1, MAX / Math.max(width, height));
        width = Math.round(width * scale); height = Math.round(height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function sameDay(a, b){
  const da = new Date(a), db = new Date(b);
  return da.getFullYear()===db.getFullYear() && da.getMonth()===db.getMonth() && da.getDate()===db.getDate();
}

function chatBackBtn(){
  const b = make("button",{className:"chat-back", type:"button", title:"Chats"});
  b.setAttribute("aria-label", "Back to chats");
  b.textContent = "‹";
  b.onclick = () => { closeAllModals(); renderInbox(); };
  return b;
}
function messageWasSeen(m){
  const me = currentUserId();
  if(!m || !me) return false;
  if(m.readAt) return true;
  if(Array.isArray(m.readBy) && m.readBy.some(id => id && id !== me)) return true;
  return false;
}
function appendReceipt(inner, m, mine){
  if(!mine || !inner) return;
  inner.appendChild(make("div",{className:"chat-receipt"}, messageWasSeen(m) ? "Seen" : "Sent"));
}

async function renderMessagesForUser(targetUserId){
  const s = currentSession();
  if(!s || !s.userId) return notice("Sign in first to message");
  const target = getUserById(targetUserId) || { id: targetUserId, name: "User" };
  const remoteUser = await apiTry("/api/users/" + encodeURIComponent(targetUserId));
  if(remoteUser && remoteUser.user){
    cacheUserFromServer(remoteUser.user);
  }
  const liveTarget = getUserById(targetUserId) || target;
  const targetAvatar = getAvatarFor(liveTarget);

  const wrap = make("div",{className:"chat-modal"});
  const header = make("div",{className:"chat-header"});
  header.appendChild(chatBackBtn());
  const ava = make("div",{className:"chat-avatar"});
  ava.innerHTML = targetAvatar;
  header.appendChild(ava);
  const sub = make("div",{className:"small-muted", style:"display:flex;align-items:center;gap:6px"});
  sub.append("🔒", make("span",{className:"enc-badge"}, "End-to-end encrypted"));
  if(isFamilyWith(targetUserId)) sub.appendChild(make("span",{className:"fam-pill"}, "Family"));
  else sub.appendChild(make("span",{className:"small-muted"}, " · location hidden"));
  const headInfo = make("div",{style:"flex:1;min-width:0"},
    make("div",{style:"font-weight:700"}, liveTarget.name || liveTarget.email || "User"),
    sub
  );
  header.appendChild(headInfo);
  header.appendChild(chatCallBtns({ toUserId: targetUserId }));
  wrap.appendChild(header);

  const convoWrap = make("div",{className:"chat-convo"});
  wrap.appendChild(convoWrap);
  const typingEl = make("div",{className:"chat-typing", style:"display:none"}, (liveTarget.name || "They") + " is typing…");

  async function refreshConvo(){
    convoWrap.innerHTML = "";
    const remote = await apiTry("/api/messages?with=" + encodeURIComponent(targetUserId));
    if(remote && remote.messages){
      remote.messages.forEach(upsertServerMessage);
    }
    const msgs = await getDecryptedBetween(s.userId, targetUserId);
    let lastTs = 0;
    msgs.forEach(m=>{
      if(!lastTs || !sameDay(lastTs, m.ts)){
        convoWrap.appendChild(make("div",{className:"chat-day"}, new Date(m.ts).toLocaleDateString(undefined, { weekday:"short", month:"short", day:"numeric" })));
      }
      lastTs = m.ts;
      const mine = m.from === s.userId;
      const row = make("div",{className:"chat-msg " + (mine ? "mine" : "theirs")});
      if(!mine){
        const av = make("div",{className:"chat-avatar", style:"width:28px;height:28px;flex:0 0 28px;font-size:11px"});
        av.innerHTML = targetAvatar;
        row.appendChild(av);
      }
      const inner = make("div",{style:"display:flex;flex-direction:column;gap:3px"});
      const p = m.payload || {};
      if(p.image){
        const img = make("img",{className:"chat-img", src:p.image, alt:"Shared image"});
        img.onclick = () => openImagePreview(p.image);
        inner.appendChild(img);
      }
      if(p.text){
        const bub = make("div",{className:"chat-bubble"}, p.text);
        bub.appendChild(make("span",{className:"chat-time"}, new Date(m.ts).toLocaleTimeString([], {hour:"numeric", minute:"2-digit"})));
        inner.appendChild(bub);
      } else {
        inner.appendChild(make("div",{className:"chat-meta", style:"text-align:"+(mine?"right":"left")}, new Date(m.ts).toLocaleTimeString([], {hour:"numeric", minute:"2-digit"})));
      }
      appendReceipt(inner, m, mine);
      row.appendChild(inner);
      bindMessageGestures(row, m, mine, p);
      convoWrap.appendChild(row);
    });
    convoWrap.appendChild(typingEl);
    setTimeout(()=>{ convoWrap.scrollTop = convoWrap.scrollHeight; }, 30);
  }

  const fileInput = make("input",{type:"file", accept:"image/*", style:"display:none"});
  fileInput.onchange = async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    if(!file) return;
    try{
      const dataUrl = await loadToDataUrlSafely(file);
      await sendEncryptedMessage(s.userId, targetUserId, { image: dataUrl });
      refreshConvo();
    }catch(e){ console.error(e); notice("Could not attach image."); }
    fileInput.value = "";
  };
  const attachBtn = make("button",{className:"chat-attach", title:"Attach image", type:"button"}, "📎");
  attachBtn.onclick = () => fileInput.click();

  const txt = make("textarea",{className:"input chat-input", placeholder:"Message", rows:1});
  txt.setAttribute("aria-label","Message input");
  txt.addEventListener("input", () => {
    autoGrow(txt);
    wsSend({ type:"typing", to: targetUserId });
  });
  const send = make("button",{className:"btn small chat-send", type:"button", title:"Send"}, "➤");
  const doSend = async () => {
    if(!txt.value.trim()) return;
    await sendEncryptedMessage(s.userId, targetUserId, { text: txt.value.trim() });
    txt.value = "";
    autoGrow(txt);
    refreshConvo();
    txt.focus();
  };
  send.onclick = doSend;
  txt.addEventListener("keydown", (e) => {
    if(e.key === "Enter" && !e.shiftKey){ e.preventDefault(); doSend(); }
    if(e.key === "Enter" && (e.ctrlKey || e.metaKey)){ e.preventDefault(); doSend(); }
  });

  const inputRow = make("div",{className:"chat-composer"});
  inputRow.appendChild(attachBtn);
  inputRow.appendChild(txt);
  inputRow.appendChild(send);
  wrap.appendChild(inputRow);
  wrap.appendChild(fileInput);

  openChatUserId = targetUserId;
  openChatFamilyId = null;
  openChatRoomId = null;
  window.__refreshOpenChat = refreshConvo;
  window.__showTyping = () => {
    typingEl.style.display = "block";
    convoWrap.scrollTop = convoWrap.scrollHeight;
    clearTimeout(typingEl._t);
    typingEl._t = setTimeout(()=>{ typingEl.style.display = "none"; }, 1800);
  };

  apiTry("/api/messages/read", { method:"POST", body: { with: targetUserId } });
  refreshConvo();
  const backdrop = showModal(wrap, { variant: "chat" });
  backdrop.dataset.chatWith = targetUserId;
  setTimeout(()=> txt.focus(), 80);
  return backdrop;
}

async function renderFamilyChat(familyId){
  const s = currentSession();
  if(!s || !s.userId) return notice("Sign in first to message");
  const fam = myFamilies().find(f => f.id === familyId) || (storage.get(DB.familiesKey)||[]).find(f => f.id === familyId);
  if(!fam) return notice("Family not found");

  const wrap = make("div",{className:"chat-modal"});
  const header = make("div",{className:"chat-header"});
  header.appendChild(chatBackBtn());
  const ava = make("div",{className:"chat-avatar"}, "👨‍👩‍👧‍👦");
  header.appendChild(ava);
  const sub = make("div",{className:"small-muted", style:"display:flex;align-items:center;gap:6px"});
  sub.append("🔒", make("span",{className:"enc-badge"}, "Family room · AES-GCM"), make("span",{className:"fam-pill"}, (fam.members||[]).length + " members"));
  header.appendChild(make("div",{style:"flex:1;min-width:0"}, make("div",{style:"font-weight:700"}, fam.name), sub));
  header.appendChild(chatCallBtns({ familyId }));
  wrap.appendChild(header);

  const convoWrap = make("div",{className:"chat-convo"});
  wrap.appendChild(convoWrap);
  const typingEl = make("div",{className:"chat-typing", style:"display:none"}, "Someone is typing…");

  async function refreshConvo(){
    convoWrap.innerHTML = "";
    const remote = await apiTry("/api/messages?family=" + encodeURIComponent(familyId));
    if(remote && remote.messages) remote.messages.forEach(upsertServerMessage);
    const msgs = await getDecryptedFamily(familyId);
    let lastTs = 0;
    msgs.forEach(m => {
      if(!lastTs || !sameDay(lastTs, m.ts)){
        convoWrap.appendChild(make("div",{className:"chat-day"}, new Date(m.ts).toLocaleDateString(undefined, { weekday:"short", month:"short", day:"numeric" })));
      }
      lastTs = m.ts;
      const p = m.payload || {};
      if(m.kind === "sos" || p.sos){
        convoWrap.appendChild(make("div",{className:"sos-banner"}, p.text || m.text || "SOS"));
        return;
      }
      const mine = m.from === s.userId;
      const sender = getUserById(m.from) || { name: "Member" };
      const row = make("div",{className:"chat-msg " + (mine ? "mine" : "theirs")});
      if(!mine){
        const av = make("div",{className:"chat-avatar", style:"width:28px;height:28px;flex:0 0 28px;font-size:11px"});
        av.innerHTML = getAvatarFor(sender);
        row.appendChild(av);
      }
      const inner = make("div",{style:"display:flex;flex-direction:column;gap:3px"});
      if(!mine) inner.appendChild(make("div",{className:"chat-meta"}, sender.name || "Member"));
      if(p.image){
        const img = make("img",{className:"chat-img", src:p.image, alt:"Shared image"});
        img.onclick = () => openImagePreview(p.image);
        inner.appendChild(img);
      }
      if(p.text){
        const bub = make("div",{className:"chat-bubble"}, p.text);
        bub.appendChild(make("span",{className:"chat-time"}, new Date(m.ts).toLocaleTimeString([], {hour:"numeric", minute:"2-digit"})));
        inner.appendChild(bub);
      } else {
        inner.appendChild(make("div",{className:"chat-meta", style:"text-align:"+(mine?"right":"left")}, new Date(m.ts).toLocaleTimeString([], {hour:"numeric", minute:"2-digit"})));
      }
      appendReceipt(inner, m, mine);
      row.appendChild(inner);
      bindMessageGestures(row, m, mine, p);
      convoWrap.appendChild(row);
    });
    convoWrap.appendChild(typingEl);
    setTimeout(()=>{ convoWrap.scrollTop = convoWrap.scrollHeight; }, 30);
  }

  const fileInput = make("input",{type:"file", accept:"image/*", style:"display:none"});
  fileInput.onchange = async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    if(!file) return;
    try{
      const dataUrl = await loadToDataUrlSafely(file);
      await sendEncryptedFamilyMessage(familyId, { image: dataUrl });
      refreshConvo();
    }catch(e){ notice("Could not attach image."); }
    fileInput.value = "";
  };
  const attachBtn = make("button",{className:"chat-attach", title:"Attach image", type:"button"}, "📎");
  attachBtn.onclick = () => fileInput.click();
  const txt = make("textarea",{className:"input chat-input", placeholder:"Message the family", rows:1});
  txt.addEventListener("input", () => { autoGrow(txt); wsSend({ type:"typing", familyId }); });
  const send = make("button",{className:"btn small chat-send", type:"button", title:"Send"}, "➤");
  const doSend = async () => {
    if(!txt.value.trim()) return;
    await sendEncryptedFamilyMessage(familyId, { text: txt.value.trim() });
    txt.value = ""; autoGrow(txt); refreshConvo(); txt.focus();
  };
  send.onclick = doSend;
  txt.addEventListener("keydown", (e) => {
    if(e.key === "Enter" && !e.shiftKey){ e.preventDefault(); doSend(); }
  });
  const inputRow = make("div",{className:"chat-composer"});
  inputRow.append(attachBtn, txt, send);
  wrap.append(inputRow, fileInput);

  openChatUserId = null;
  openChatFamilyId = familyId;
  openChatRoomId = null;
  window.__refreshOpenChat = refreshConvo;
  window.__showTyping = () => {
    typingEl.style.display = "block";
    convoWrap.scrollTop = convoWrap.scrollHeight;
    clearTimeout(typingEl._t);
    typingEl._t = setTimeout(()=>{ typingEl.style.display = "none"; }, 1800);
  };
  apiTry("/api/messages/read", { method:"POST", body: { familyId } });
  refreshConvo();
  const backdrop = showModal(wrap, { variant: "chat" });
  setTimeout(()=> txt.focus(), 80);
  return backdrop;
}

function letterAvatar(label, kind){
  const ch = String(label || (kind === "family" ? "F" : "G")).trim().charAt(0).toUpperCase() || "G";
  return `<span class="inbox-av-letter ${kind || "room"}">${ch}</span>`;
}

async function sendEncryptedRoomMessage(roomId, payload){
  const s = currentSession();
  if(!s) return;
  const key = await deriveConvKey("room", roomId);
  const box = await aesEncrypt(key, payload);
  const msgs = storage.get(MSG_KEY) || [];
  const m = { id: uid("m"), from: s.userId, roomId, enc: box, ts: now() };
  msgs.push(m);
  storage.set(MSG_KEY, msgs);
  const posted = await apiTry("/api/messages", { method:"POST", body: { roomId, enc: box } });
  if(posted && posted.message) upsertServerMessage(posted.message);
  updateInboxBadge();
  return m;
}

async function getDecryptedRoom(roomId){
  const key = await deriveConvKey("room", roomId);
  const local = storage.get(MSG_KEY) || [];
  const remote = storage.get(DB.serverMsgsKey) || [];
  const map = new Map();
  [...remote, ...local].forEach(m => {
    if(m.roomId === roomId && !isDeletedForMe(m)) map.set(m.id, m);
  });
  const raw = Array.from(map.values()).sort((x,y)=>x.ts-y.ts);
  const out = [];
  for(const m of raw){
    if(m.enc){
      const payload = await aesDecrypt(key, m.enc) || { text: m.text || "🔒 [Unable to decrypt message]" };
      out.push({ ...m, payload });
    } else {
      out.push({ ...m, payload: { text: m.text || "", image: m.image } });
    }
  }
  return out;
}

async function renderRoomChat(roomId){
  const s = currentSession();
  if(!s || !s.userId) return notice("Sign in first to message");
  let room = (storage.get(DB.roomsKey) || []).find(r => r.id === roomId);
  const remote = await apiTry("/api/rooms/" + encodeURIComponent(roomId));
  if(remote && remote.room){
    cacheRoom(remote.room);
    room = remote.room;
  }
  if(!room) return notice("Room not found");
  if(room.isMember === false){
    const join = await ask("Join \"" + (room.name || "this room") + "\" to chat?");
    if(!join) return;
    const j = await apiTry("/api/rooms/" + encodeURIComponent(roomId) + "/join", { method:"POST", body: {} });
    if(!j || !j.room) return notice("Could not join this room.");
    cacheRoom(j.room);
    room = j.room;
  }

  const wrap = make("div",{className:"chat-modal"});
  const header = make("div",{className:"chat-header"});
  header.appendChild(chatBackBtn());
  const ava = make("div",{className:"chat-avatar"});
  ava.innerHTML = letterAvatar(room.name, "room");
  header.appendChild(ava);
  const sub = make("div",{className:"small-muted", style:"display:flex;align-items:center;gap:6px;flex-wrap:wrap"});
  sub.append("🔒", make("span",{className:"enc-badge"}, "Group · AES-GCM"));
  if(room.topic) sub.appendChild(make("span",{className:"fam-pill"}, room.topic));
  const count = room.memberCount != null ? room.memberCount : ((room.members && room.members.length) || 0);
  sub.appendChild(make("span",{className:"small-muted"}, count + " members"));
  header.appendChild(make("div",{style:"flex:1;min-width:0"}, make("div",{style:"font-weight:700"}, room.name || "Group"), sub));
  header.appendChild(chatCallBtns({ roomId }));
  const more = make("button",{className:"btn small secondary", type:"button", style:"width:auto;flex:0 0 auto"}, "•••");
  more.title = "Room options";
  more.onclick = () => renderRoomOptions(roomId);
  header.appendChild(more);
  wrap.appendChild(header);

  const convoWrap = make("div",{className:"chat-convo"});
  wrap.appendChild(convoWrap);
  const typingEl = make("div",{className:"chat-typing", style:"display:none"}, "Someone is typing…");

  async function refreshConvo(){
    convoWrap.innerHTML = "";
    const rem = await apiTry("/api/messages?room=" + encodeURIComponent(roomId));
    if(rem && rem.messages) rem.messages.forEach(upsertServerMessage);
    const msgs = await getDecryptedRoom(roomId);
    let lastTs = 0;
    msgs.forEach(m => {
      if(!lastTs || !sameDay(lastTs, m.ts)){
        convoWrap.appendChild(make("div",{className:"chat-day"}, new Date(m.ts).toLocaleDateString(undefined, { weekday:"short", month:"short", day: "numeric" })));
      }
      lastTs = m.ts;
      const p = m.payload || {};
      const mine = m.from === s.userId;
      const sender = getUserById(m.from) || { name: "Member" };
      const row = make("div",{className:"chat-msg " + (mine ? "mine" : "theirs")});
      if(!mine){
        const av = make("div",{className:"chat-avatar", style:"width:28px;height:28px;flex:0 0 28px;font-size:11px"});
        av.innerHTML = getAvatarFor(sender);
        row.appendChild(av);
      }
      const inner = make("div",{style:"display:flex;flex-direction:column;gap:3px"});
      if(!mine) inner.appendChild(make("div",{className:"chat-meta"}, sender.name || "Member"));
      if(p.image){
        const img = make("img",{className:"chat-img", src:p.image, alt:"Shared image"});
        img.onclick = () => openImagePreview(p.image);
        inner.appendChild(img);
      }
      if(p.text){
        const bub = make("div",{className:"chat-bubble"}, p.text);
        bub.appendChild(make("span",{className:"chat-time"}, new Date(m.ts).toLocaleTimeString([], {hour:"numeric", minute:"2-digit"})));
        inner.appendChild(bub);
      } else {
        inner.appendChild(make("div",{className:"chat-meta", style:"text-align:"+(mine?"right":"left")}, new Date(m.ts).toLocaleTimeString([], {hour:"numeric", minute:"2-digit"})));
      }
      appendReceipt(inner, m, mine);
      row.appendChild(inner);
      bindMessageGestures(row, m, mine, p);
      convoWrap.appendChild(row);
    });
    convoWrap.appendChild(typingEl);
    setTimeout(()=>{ convoWrap.scrollTop = convoWrap.scrollHeight; }, 30);
  }

  const fileInput = make("input",{type:"file", accept:"image/*", style:"display:none"});
  fileInput.onchange = async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    if(!file) return;
    try{
      const dataUrl = await loadToDataUrlSafely(file);
      await sendEncryptedRoomMessage(roomId, { image: dataUrl });
      refreshConvo();
    }catch(e){ notice("Could not attach image."); }
    fileInput.value = "";
  };
  const attachBtn = make("button",{className:"chat-attach", title:"Attach image", type:"button"}, "📎");
  attachBtn.onclick = () => fileInput.click();
  const txt = make("textarea",{className:"input chat-input", placeholder:"Message the group", rows:1});
  txt.addEventListener("input", () => { autoGrow(txt); wsSend({ type:"typing", roomId }); });
  const send = make("button",{className:"btn small chat-send", type:"button", title:"Send"}, "➤");
  const doSend = async () => {
    if(!txt.value.trim()) return;
    await sendEncryptedRoomMessage(roomId, { text: txt.value.trim() });
    txt.value = ""; autoGrow(txt); refreshConvo(); txt.focus();
  };
  send.onclick = doSend;
  txt.addEventListener("keydown", (e) => {
    if(e.key === "Enter" && !e.shiftKey){ e.preventDefault(); doSend(); }
  });
  const inputRow = make("div",{className:"chat-composer"});
  inputRow.append(attachBtn, txt, send);
  wrap.append(inputRow, fileInput);

  openChatUserId = null;
  openChatFamilyId = null;
  openChatRoomId = roomId;
  window.__refreshOpenChat = refreshConvo;
  window.__showTyping = () => {
    typingEl.style.display = "block";
    convoWrap.scrollTop = convoWrap.scrollHeight;
    clearTimeout(typingEl._t);
    typingEl._t = setTimeout(()=>{ typingEl.style.display = "none"; }, 1800);
  };
  apiTry("/api/messages/read", { method:"POST", body: { roomId } });
  refreshConvo();
  const backdrop = showModal(wrap, { variant: "chat" });
  setTimeout(()=> txt.focus(), 80);
  return backdrop;
}

async function renderRoomOptions(roomId){
  const rem = await apiTry("/api/rooms/" + encodeURIComponent(roomId));
  const room = (rem && rem.room) || (storage.get(DB.roomsKey) || []).find(r => r.id === roomId);
  if(!room) return notice("Room not found");
  const wrap = make("div",{style:"min-width:280px;display:flex;flex-direction:column;gap:10px"});
  wrap.appendChild(make("h3",{}, room.name || "Group"));
  wrap.appendChild(make("p",{className:"small-muted"}, (room.topic || "Group") + " • " + (room.privacy || "private") + (room.desc ? " — " + room.desc : "")));
  const people = Array.isArray(room.members) ? room.members : [];
  if(people.length){
    wrap.appendChild(make("div",{className:"small-muted"}, "Members"));
    people.forEach(p => {
      const id = typeof p === "string" ? p : p.id;
      const name = typeof p === "string" ? ((getUserById(p) || {}).name || "Member") : (p.name || "Member");
      wrap.appendChild(make("div",{className:"family-card"}, make("div",{}, name)));
    });
  }
  const fams = myFamilies();
  const memberIds = new Set(people.map(p => typeof p === "string" ? p : p.id));
  const inviteable = [];
  const me = currentSession() && currentSession().userId;
  fams.forEach(f => (f.members || []).forEach(id => {
    if(id !== me && !memberIds.has(id) && !inviteable.find(x => x.id === id)){
      const u = getUserById(id);
      if(u) inviteable.push(u);
    }
  }));
  if(inviteable.length){
    wrap.appendChild(make("label",{}, "Invite family"));
    const sel = make("select",{className:"input"});
    inviteable.forEach(u => sel.appendChild(make("option",{value:u.id}, u.name || "Member")));
    const inv = make("button",{className:"btn small", type:"button"}, "Invite");
    inv.onclick = async () => {
      const j = await apiTry("/api/rooms/" + encodeURIComponent(roomId) + "/invite", { method:"POST", body: { userId: sel.value } });
      if(j && j.room){ cacheRoom(j.room); notice("Invited."); }
      else notice("Could not invite.");
    };
    wrap.append(sel, inv);
  }
  const leave = make("button",{className:"btn small secondary", type:"button"}, "Leave room");
  leave.onclick = async () => {
    if(!await ask("Leave this group?")) return;
    await apiTry("/api/rooms/" + encodeURIComponent(roomId) + "/leave", { method:"POST", body: {} });
    const rooms = (storage.get(DB.roomsKey) || []).filter(r => r.id !== roomId);
    storage.set(DB.roomsKey, rooms);
    closeModal();
    closeModal();
    renderInbox({ filter: "groups" });
  };
  wrap.appendChild(leave);
  showModal(wrap);
}

function autoGrow(el){
  el.style.height = "auto";
  el.style.height = Math.min(Math.max(el.scrollHeight, 48), 120) + "px";
}

async function loadToDataUrlSafely(file){
  try{ return await fileToCompressedDataUrl(file); }
  catch(e){ return await new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(file); }); }
}

async function uploadMedia(file, filename){
  const s = currentSession();
  const token = (s && s.sessionToken) || localStorage.getItem("f360_otpsess") || "";
  const headers = {};
  if(token) headers["authorization"] = "Bearer " + token;
  const blob = file instanceof Blob ? file : new Blob([file]);
  headers["content-type"] = blob.type || "application/octet-stream";
  if(filename) headers["x-file-name"] = encodeURIComponent(filename);
  const res = await fetch("/api/media", { method: "POST", headers, body: blob });
  const j = await res.json().catch(() => ({}));
  if(!res.ok) throw new Error((j && j.error) || "upload failed");
  return j;
}

function safeAvatarSrc(s){
  const v = String(s || "");
  if(v.startsWith("data:image/")) return v;
  if(/^\/avatars\/[A-Za-z0-9._-]+\.(png|jpg|jpeg|svg|webp)$/.test(v)) return v;
  if(/^\/uploads\/[A-Za-z0-9._-]+$/.test(v)) return v;
  return "";
}
function getAvatarFor(u){
  if(!u) return "U";
  const src = safeAvatarSrc(getProfileImageForUser(u.id) || u.profileImage || u.avatarUrl || "");
  if(src) return `<img src="${src}" alt=""/>`;
  const initials = ((u.name||"U").split(" ").map(x=>x[0]).slice(0,2).join("")).toUpperCase();
  return initials || "U";
}

async function renderAvatarPicker(){
  const s = currentSession();
  if(!s) return renderAuth();
  const wrap = make("div",{className:"avpick"});
  const head = make("div",{className:"avpick-head"});
  head.append(make("div",{className:"help-kicker"}, "Profile"), make("h3",{}, "Choose an icon"));
  head.appendChild(make("p",{className:"small-muted"}, "Pick a portrait or emblem, or upload your own photo. Icons stay on this device and with family."));
  wrap.appendChild(head);
  const now = make("div",{className:"avpick-now"});
  const nowFace = make("div",{className:"avpick-now-face"});
  const nowImg = make("img",{alt:""});
  const nowEmoji = make("span",{className:"avpick-emoji lg"}, "");
  nowFace.append(nowImg, nowEmoji);
  const nowMeta = make("div",{className:"avpick-now-meta"});
  const nowName = make("div",{className:"avpick-now-name"}, "Tap a circle");
  const nowHint = make("div",{className:"small-muted"}, "Gold ring = selected. Then tap Use.");
  nowMeta.append(nowName, nowHint);
  now.append(nowFace, nowMeta);
  wrap.appendChild(now);
  const tabs = make("div",{className:"avpick-tabs"});
  let cat = "all";
  let query = "";
  [["all","All"],["people","People"],["pets","Pets"],["symbols","Emoji"],["upload","Upload"]].forEach(([id,label]) => {
    const b = make("button",{className:"inbox-chip"+(id==="all"?" on":""), type:"button"}, label);
    b.dataset.id = id;
    b.onclick = () => { cat = id; tabs.querySelectorAll(".inbox-chip").forEach(x => x.classList.toggle("on", x.dataset.id===id)); paint(); };
    tabs.appendChild(b);
  });
  wrap.appendChild(tabs);
  const search = make("input",{className:"input inbox-search-input", type:"search", placeholder:"Search icons…", enterKeyHint:"search"});
  wrap.appendChild(make("div",{className:"inbox-search"}, search));
  const grid = make("div",{className:"avpick-grid"});
  wrap.appendChild(grid);
  const foot = make("div",{className:"avpick-foot"});
  const useBtn = make("button",{className:"btn avpick-use", type:"button"}, "Use this icon");
  const upBtn = make("button",{className:"btn secondary", type:"button"}, "Upload photo");
  useBtn.disabled = true;
  foot.append(upBtn, useBtn);
  wrap.appendChild(foot);

  let list = [];
  let selected = null;
  const cur = safeAvatarSrc(getProfileImageForUser(s.userId) || ((getUserById(s.userId)||{}).profileImage) || "");

  function showNow(a){
    if(!a){
      nowName.textContent = "Tap a circle";
      nowHint.textContent = "Gold ring = selected. Then tap Use.";
      nowImg.hidden = true;
      nowEmoji.hidden = true;
      useBtn.disabled = true;
      useBtn.classList.remove("ready");
      return;
    }
    nowName.textContent = a.label || a.id;
    nowHint.textContent = "Selected — tap Use this icon";
    if(a.emoji){
      nowEmoji.hidden = false;
      nowEmoji.textContent = a.emoji;
      nowImg.hidden = true;
    } else {
      nowImg.hidden = false;
      nowImg.src = a.file;
      nowEmoji.hidden = true;
    }
    useBtn.disabled = false;
    useBtn.classList.add("ready");
  }

  function faceFor(a){
    const face = make("span",{className:"avpick-face"});
    if(a.emoji){
      face.appendChild(make("span",{className:"avpick-emoji"}, a.emoji));
      return face;
    }
    const img = document.createElement("img");
    img.src = a.file;
    img.alt = a.label || "";
    img.draggable = false;
    img.style.cssText = "width:100%;height:100%;max-width:36px;max-height:36px;object-fit:cover;object-position:center 18%;border-radius:50%;display:block;";
    face.appendChild(img);
    return face;
  }

  function paint(){
    grid.innerHTML = "";
    if(cat === "upload"){
      grid.appendChild(make("div",{className:"small-muted", style:"grid-column:1/-1;padding:18px"}, "Tap Upload photo to use a picture from this device."));
      return;
    }
    const q = query.trim().toLowerCase();
    const rows = list.filter(a => {
      if(cat !== "all" && a.cat !== cat) return false;
      const blob = ((a.label||"")+" "+(a.id||"")+" "+(a.emoji||"")).toLowerCase();
      if(q && !blob.includes(q)) return false;
      return true;
    });
    if(!rows.length){
      grid.appendChild(make("div",{className:"small-muted", style:"grid-column:1/-1"}, "No icons match."));
      return;
    }
    rows.forEach(a => {
      const on = !!(selected && selected.id===a.id);
      const cell = make("button",{className:"avpick-cell" + (on ? " on" : ""), type:"button", title:a.label||a.id});
      cell.setAttribute("aria-pressed", on ? "true" : "false");
      cell.appendChild(faceFor(a));
      cell.onclick = () => {
        if(selected && selected.id === a.id){ useBtn.click(); return; }
        selected = a;
        showNow(a);
        grid.querySelectorAll(".avpick-cell").forEach(x => { x.classList.remove("on"); x.setAttribute("aria-pressed","false"); });
        cell.classList.add("on");
        cell.setAttribute("aria-pressed","true");
      };
      grid.appendChild(cell);
    });
    showNow(selected);
  }

  async function applySelected(){
    if(!selected) return notice("Tap a circle first.");
    saveProfileImageForUser(s.userId, selected.file);
    const u = getUserById(s.userId);
    if(u){ u.profileImage = selected.file; saveUser(u); }
    await apiTry("/api/me/profile", { method:"POST", body: { avatarId: selected.id, image: selected.file } });
    updateProfileThumb();
    updateFamilyMarkers();
    paintAccountDrawer();
    closeModal();
    notice("Profile icon updated.");
  }
  upBtn.onclick = () => {
    const input = qs("#profile-input");
    if(input) input.click();
  };
  useBtn.onclick = () => applySelected();
  search.addEventListener("input", debounce(() => { query = search.value; paint(); }, 120));

  showModal(wrap, { variant: "avatar" });
  const modal = document.querySelector(".modal");
  if(modal) modal.classList.add("avatar-shell");
  const j = await apiTry("/api/avatars");
  list = (j && j.avatars) || [];
  selected = list.find(a => a.file === cur) || null;
  paint();
}

async function renderInvitePerson(user){
  const s = currentSession(); if(!s) return renderAuth();
  const fams = myFamilies();
  const wrap = make("div",{style:"min-width:min(92vw,360px);display:flex;flex-direction:column;gap:10px"});
  wrap.appendChild(make("div",{className:"help-kicker"}, "Invite"));
  wrap.appendChild(make("h3",{}, "Invite " + (user.name || "them")));
  wrap.appendChild(make("p",{className:"small-muted"}, "They join the family you pick. Location stays hidden until they accept and belong."));
  if(!fams.length){
    wrap.appendChild(make("div",{className:"privacy-note"}, "Create a family first."));
    const go = make("button",{className:"btn", type:"button"}, "Create family");
    go.onclick = () => { closeModal(); renderCreateJoin(); };
    wrap.appendChild(go);
    return showModal(wrap);
  }
  const sel = make("select",{className:"input"});
  fams.forEach(f => sel.appendChild(make("option",{value:f.id}, f.name + " · " + (f.privacy||"private"))));
  const send = make("button",{className:"btn", type:"button"}, "Send invite");
  send.onclick = async () => {
    try{
      const j = await api("/api/people/invite", { method:"POST", body: { userId: user.id, familyId: sel.value } });
      if(j && j.already) await notice("They are already in that family.");
      else await notice("Invite sent. They can Accept from Find people → Requests.");
      closeModal();
    }catch(e){ notice(e.message || "Could not invite"); }
  };
  const msg = make("button",{className:"btn secondary", type:"button"}, "Message instead");
  msg.onclick = () => { closeAllModals(); renderMessagesForUser(user.id); };
  wrap.append(make("label",{}, "Family"), sel, make("div",{className:"row", style:"margin-top:8px"}, send, msg));
  showModal(wrap);
}


function openImagePreview(src){
  const wrap = make("div",{className:"centered", style:"flex-direction:column;gap:12px"});
  const img = make("img",{src, style:"max-width:92vw;max-height:70vh;border-radius:10px"});
  const dl = make("button",{className:"btn small secondary"}, "⬇ Download");
  dl.onclick = () => downloadDataUrl(src, "image.jpg");
  const close = make("button",{className:"btn small"}, "Close");
  close.onclick = closeModal;
  wrap.appendChild(img);
  wrap.appendChild(make("div",{className:"row", style:"gap:8px"}, dl, close));
  showModal(wrap);
}

function inboxWhen(ts){
  if(!ts) return "";
  const d = new Date(ts);
  const n = Date.now();
  if(sameDay(ts, n)) return d.toLocaleTimeString([], {hour:"numeric", minute:"2-digit"});
  const y = new Date(); y.setDate(y.getDate() - 1);
  if(sameDay(ts, y.getTime())) return "Yesterday";
  return d.toLocaleDateString(undefined, { month:"short", day:"numeric" });
}

function lastPreviewOf(m){
  if(!m) return "No messages yet";
  if(m.kind === "sos") return m.text || "SOS";
  if(m.enc) return "Encrypted message";
  if(m.image && !m.text) return "Sent a photo";
  const t = String(m.text || "").replace(/\s+/g, " ").trim();
  if(t) return t.slice(0, 90);
  if(m.image) return "Sent a photo";
  return "New message";
}

function isLocalUnread(m, userId){
  if(!m || m.from === userId) return false;
  if(Array.isArray(m.deletedFor) && m.deletedFor.includes(userId)) return false;
  if(Array.isArray(m.readBy) && m.readBy.includes(userId)) return false;
  if(m.to === userId) return !m.readAt;
  if(m.familyId || m.roomId) return true;
  return false;
}

function renderInbox(opts){
  const s = currentSession(); if(!s || !s.userId) return notice("Sign in first");
  opts = opts || {};
  let filter = opts.filter || "all";
  let query = "";

  const wrap = make("div",{className:"inbox-app"});
  const head = make("div",{className:"inbox-head"});
  head.appendChild(make("h3",{}, "Chats"));
  const newBtn = make("button",{className:"btn small", type:"button"}, "New group");
  newBtn.onclick = () => renderCreateRoom();
  head.appendChild(newBtn);
  wrap.appendChild(head);

  const search = make("input",{className:"input inbox-search-input", type:"search", placeholder:"Search chats…", autocomplete:"off"});
  wrap.appendChild(make("div",{className:"inbox-search"}, search));

  const filters = make("div",{className:"inbox-filters"});
  const chips = [
    ["all", "All"],
    ["unread", "Unread"],
    ["people", "People"],
    ["families", "Families"],
    ["groups", "Groups"]
  ];
  chips.forEach(([id, label]) => {
    const b = make("button",{className:"inbox-chip" + (filter === id ? " on" : ""), type:"button"}, label);
    b.dataset.id = id;
    b.onclick = () => { filter = id; paint(); };
    filters.appendChild(b);
  });
  wrap.appendChild(filters);

  const list = make("div",{className:"inbox-list"});
  wrap.appendChild(list);

  const foot = make("div",{className:"inbox-foot"});
  const findBtn = make("button",{className:"btn small secondary", type:"button"}, "Find people");
  findBtn.onclick = () => { closeModal(); renderFamilyList(); };
  const browseBtn = make("button",{className:"btn small secondary", type:"button"}, "Browse rooms");
  browseBtn.onclick = () => renderBrowseRooms();
  foot.append(findBtn, browseBtn);
  wrap.appendChild(foot);

  let serverThreads = null;

  function localThreads(){
    const msgs = storage.get(MSG_KEY) || [];
    const remote = storage.get(DB.serverMsgsKey) || [];
    const all = [...msgs, ...remote];
    const threads = {};
    all.forEach(m => {
      if(isDeletedForMe(m)) return;
      if(m.roomId){
        const key = "room:" + m.roomId;
        threads[key] = threads[key] || { kind:"room", roomId: m.roomId, unread:0, last:null, count:0 };
        threads[key].count += 1;
        if(isLocalUnread(m, s.userId)) threads[key].unread += 1;
        if(!threads[key].last || threads[key].last.ts < m.ts) threads[key].last = m;
        return;
      }
      if(m.familyId){
        const key = "fam:" + m.familyId;
        threads[key] = threads[key] || { kind:"family", familyId: m.familyId, unread:0, last:null, count:0 };
        threads[key].count += 1;
        if(isLocalUnread(m, s.userId)) threads[key].unread += 1;
        if(!threads[key].last || threads[key].last.ts < m.ts) threads[key].last = m;
        return;
      }
      const other = m.from === s.userId ? m.to : m.from;
      if(!other) return;
      threads[other] = threads[other] || { kind:"direct", otherId: other, unread:0, last:null, count:0 };
      threads[other].count += 1;
      if(isLocalUnread(m, s.userId)) threads[other].unread += 1;
      if(!threads[other].last || threads[other].last.ts < m.ts) threads[other].last = m;
    });
    (storage.get(DB.roomsKey) || []).forEach(r => {
      const member = Array.isArray(r.members) ? r.members.includes(s.userId) : r.isMember;
      if(!member && r.isMember !== true) return;
      const key = "room:" + r.id;
      if(!threads[key]) threads[key] = { kind:"room", roomId: r.id, unread:0, last:null, count:0, name: r.name, topic: r.topic };
    });
    myFamilies().forEach(f => {
      const key = "fam:" + f.id;
      if(!threads[key]) threads[key] = { kind:"family", familyId: f.id, unread:0, last:null, count:0, name: f.name };
    });
    return Object.values(threads).map(t => {
      if(t.kind === "room"){
        const r = (storage.get(DB.roomsKey) || []).find(x => x.id === t.roomId);
        return {
          kind: "room",
          roomId: t.roomId,
          name: t.name || (r && r.name) || "Group",
          topic: t.topic || (r && r.topic) || "",
          unread: t.unread,
          count: t.count,
          lastTs: t.last ? t.last.ts : 0,
          lastPreview: lastPreviewOf(t.last),
          lastFromName: t.last && t.last.from === s.userId ? "You" : ((getUserById(t.last && t.last.from) || {}).name || "")
        };
      }
      if(t.kind === "family"){
        const f = (storage.get(DB.familiesKey) || []).find(x => x.id === t.familyId);
        return {
          kind: "family",
          familyId: t.familyId,
          name: t.name || (f && f.name) || "Family",
          unread: t.unread,
          count: t.count,
          lastTs: t.last ? t.last.ts : 0,
          lastPreview: lastPreviewOf(t.last),
          lastFromName: t.last && t.last.from === s.userId ? "You" : ((getUserById(t.last && t.last.from) || {}).name || "")
        };
      }
      const u = getUserById(t.otherId) || { id: t.otherId, name: "User" };
      return {
        kind: "direct",
        otherId: t.otherId,
        name: u.name || u.email || "User",
        online: !!u.online,
        inFamily: isFamilyWith(t.otherId),
        unread: t.unread,
        count: t.count,
        lastTs: t.last ? t.last.ts : 0,
        lastPreview: lastPreviewOf(t.last)
      };
    }).sort((a,b) => (b.lastTs || 0) - (a.lastTs || 0));
  }

  function paint(){
    filters.querySelectorAll(".inbox-chip").forEach(b => b.classList.toggle("on", b.dataset.id === filter));
    const q = query.trim().toLowerCase();
    const src = serverThreads || localThreads();
    const rows = src.filter(t => {
      if(filter === "unread" && !(t.unread > 0)) return false;
      if(filter === "people" && t.kind !== "direct") return false;
      if(filter === "families" && t.kind !== "family") return false;
      if(filter === "groups" && t.kind !== "room") return false;
      if(q){
        const blob = `${t.name || ""} ${t.lastPreview || ""} ${t.topic || ""} ${t.lastFromName || ""}`.toLowerCase();
        if(!blob.includes(q)) return false;
      }
      return true;
    });
    list.innerHTML = "";
    if(!rows.length){
      const empty = make("div",{className:"inbox-empty"});
      empty.appendChild(make("div",{}, filter === "groups" ? "No hobby groups yet." : "No chats match."));
      empty.appendChild(make("div",{className:"small-muted"}, filter === "groups" ? "Tap New group or Browse rooms." : "Find someone by name, or start a family chat."));
      list.appendChild(empty);
      return;
    }
    rows.forEach(t => {
      const row = make("button",{className:"inbox-row" + (t.unread > 0 ? " unread" : ""), type:"button"});
      const av = make("div",{className:"inbox-av"});
      if(t.kind === "direct"){
        const u = getUserById(t.otherId) || { id: t.otherId, name: t.name };
        av.innerHTML = getAvatarFor(u);
        if(t.online) av.appendChild(make("span",{className:"inbox-online", title:"Online"}));
      } else {
        av.innerHTML = letterAvatar(t.name, t.kind === "family" ? "family" : "room");
      }
      const mid = make("div",{className:"inbox-mid"});
      const name = make("div",{className:"inbox-name"}, t.name || "Chat");
      if(t.kind === "family") name.appendChild(make("span",{className:"inbox-tag"}, "Family"));
      if(t.kind === "room") name.appendChild(make("span",{className:"inbox-tag dim"}, t.topic || "Group"));
      mid.appendChild(name);
      const who = t.lastFromName && t.kind !== "direct" ? (t.lastFromName + ": ") : "";
      mid.appendChild(make("div",{className:"inbox-preview"}, who + (t.lastPreview || "No messages yet")));
      const meta = make("div",{className:"inbox-meta"});
      meta.appendChild(make("div",{className:"inbox-time"}, inboxWhen(t.lastTs)));
      if(t.unread > 0) meta.appendChild(make("div",{className:"inbox-unread"}, t.unread > 99 ? "99+" : String(t.unread)));
      row.append(av, mid, meta);
      row.onclick = () => {
        closeAllModals();
        if(t.kind === "family") renderFamilyChat(t.familyId);
        else if(t.kind === "room") renderRoomChat(t.roomId);
        else renderMessagesForUser(t.otherId);
      };
      list.appendChild(row);
    });
  }

  window.__refreshInbox = () => {
    apiTry("/api/inbox").then(j => {
      if(j && j.threads){
        serverThreads = j.threads;
        j.threads.forEach(t => {
          if(t.otherId && !getUserById(t.otherId)) cacheUserFromServer({ id: t.otherId, name: t.name, inFamily: t.inFamily, online: t.online });
        });
      }
      paint();
      updateInboxBadge();
    });
  };

  search.addEventListener("input", debounce(() => { query = search.value; paint(); }, 140));
  paint();
  showModal(wrap, { variant: "inbox" });
  window.__refreshInbox();
}

async function renderCreateRoom(){
  const s = currentSession(); if(!s) return notice("Sign in first");
  const topicsJ = await apiTry("/api/rooms/topics");
  const topics = (topicsJ && topicsJ.topics) || ["Cooking","Cars","Sports","Music","Other"];
  const wrap = make("div",{className:"room-create"});
  wrap.appendChild(make("h3",{}, "New group"));
  wrap.appendChild(make("p",{className:"small-muted"}, "A hobby chat. Groups never share map pins — only families do."));
  const name = make("input",{className:"input", placeholder:"Group name (e.g. Sunday Sauce)"});
  const topic = make("select",{className:"input"});
  topics.forEach(t => topic.appendChild(make("option",{value:t}, t)));
  const desc = make("input",{className:"input", placeholder:"What's this group about?"});
  const privacy = make("select",{className:"input"}, make("option",{value:"public"}, "Public — anyone can join"), make("option",{value:"private"}, "Private — invite only"));
  const go = make("button",{className:"btn", type:"button"}, "Create group");
  go.onclick = async () => {
    const title = name.value.trim();
    if(!title) return notice("Give the group a name.");
    try{
      const j = await api("/api/rooms", { method:"POST", body: { name: title, topic: topic.value, desc: desc.value, privacy: privacy.value } });
      if(j && j.room){
        cacheRoom(j.room);
        closeAllModals();
        renderRoomChat(j.room.id);
      }
    }catch(e){ notice(e.message || "Could not create group"); }
  };
  wrap.append(
    make("label",{}, "Name"), name,
    make("label",{}, "Topic"), topic,
    make("label",{}, "Description"), desc,
    make("label",{}, "Privacy"), privacy,
    make("div",{className:"row", style:"margin-top:12px;justify-content:flex-end"}, go)
  );
  showModal(wrap);
}

async function renderBrowseRooms(){
  const j = await apiTry("/api/rooms");
  const wrap = make("div",{style:"min-width:min(92vw,420px);display:flex;flex-direction:column;gap:10px"});
  wrap.appendChild(make("h3",{}, "Browse rooms"));
  wrap.appendChild(make("p",{className:"small-muted"}, "Public hobby groups. Joining a room does not share your location."));
  const q = make("input",{className:"input", type:"search", placeholder:"Search rooms…"});
  wrap.appendChild(q);
  const list = make("div",{style:"display:flex;flex-direction:column;gap:8px;max-height:420px;overflow:auto"});
  wrap.appendChild(list);

  function paint(data){
    list.innerHTML = "";
    const query = (q.value || "").trim().toLowerCase();
    const mine = (data && data.rooms) || [];
    const disc = (data && data.discover) || [];
    const hit = (r) => {
      if(!query) return true;
      return `${r.name||""} ${r.topic||""} ${r.desc||""}`.toLowerCase().includes(query);
    };
    const section = (title, rows, member) => {
      const shown = rows.filter(hit);
      if(!shown.length) return;
      list.appendChild(make("div",{className:"small-muted", style:"margin-top:6px"}, title));
      shown.forEach(r => {
        const card = make("div",{className:"family-card"});
        const info = make("div",{}, make("div",{}, r.name), make("div",{className:"small-muted"}, (r.topic || "Group") + " • " + (r.memberCount || 0) + " members" + (r.desc ? " — " + r.desc : "")));
        const btn = make("button",{className:"btn small"}, member ? "Open" : "Join");
        btn.onclick = async () => {
          if(!member){
            const jr = await apiTry("/api/rooms/" + encodeURIComponent(r.id) + "/join", { method:"POST", body: {} });
            if(!jr || !jr.room) return notice("Could not join.");
            cacheRoom(jr.room);
          } else cacheRoom(r);
          closeAllModals();
          renderRoomChat(r.id);
        };
        card.append(info, btn);
        list.appendChild(card);
      });
    };
    section("Your groups", mine, true);
    section("Discover", disc, false);
    if(!list.children.length) list.appendChild(make("div",{className:"small-muted"}, "No rooms match. Create one from the inbox."));
  }

  paint(j);
  q.addEventListener("input", debounce(async () => {
    const data = await apiTry("/api/rooms?q=" + encodeURIComponent(q.value.trim()));
    paint(data || j);
  }, 180));
  showModal(wrap);
}

async function updateInboxBadge(){
  const badge = qs("#inbox-badge");
  if(!badge) return;
  const s = currentSession(); if(!s || !s.userId){ badge.style.display = "none"; return; }
  const j = await apiTry("/api/inbox");
  let unread = 0;
  if(j && typeof j.unread === "number") unread = j.unread;
  else {
    const msgs = storage.get(MSG_KEY) || [];
    unread = msgs.filter(m => m.to === s.userId && !m.readAt).length;
  }
  if(unread > 0){ badge.style.display = "inline-flex"; badge.textContent = unread > 99 ? "99+" : String(unread); }
  else { badge.style.display = "none"; }
}

function profileKeyForUser(uid){ return `f360_profile_${uid}`; }
function saveProfileImageForUser(uid, dataUrl){ try{ localStorage.setItem(profileKeyForUser(uid), dataUrl); }catch(e){ console.warn("profile save failed", e); } }
function getProfileImageForUser(uid){ return localStorage.getItem(profileKeyForUser(uid)) || ""; }

function updateProfileThumb(){
  const img = qs("#acct-avatar");
  const s = currentSession();
  if(!img) return;
  if(!s || !s.userId){ img.src = ""; return; }
  const uSelf = getUserById(s.userId);
  const dataUrl = safeAvatarSrc(getProfileImageForUser(s.userId) || (uSelf && uSelf.profileImage) || "");
  if(dataUrl){ img.src = dataUrl; }
  else {
    const u = getUserById(s.userId);
    const initials = (u?.name || "U").split(" ").map(x=>x[0]).slice(0,2).join("").toUpperCase();
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='88' height='88'><rect width='100%' height='100%' fill='#233b3a'/><text x='50%' y='54%' font-size='32' fill='#fff' text-anchor='middle' font-family='Arial'>${initials}</text></svg>`;
    img.src = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }
}

function initProfileInput(){
  const input = qs("#profile-input");
  if(!input) return;
  input.onchange = (ev) => {
    const file = input.files && input.files[0];
    if(!file) return;
    const s = currentSession(); if(!s || !s.userId) return notice("Sign in first");
    const reader = new FileReader();
    reader.onload = async () => {
      let dataUrl = reader.result;
      try{ dataUrl = await fileToCompressedDataUrl(file); }catch(e){}
      saveProfileImageForUser(s.userId, dataUrl);
      updateProfileThumb();
      updateFamilyMarkers();
      paintAccountDrawer();
      apiTry("/api/me/profile", { method:"POST", body: { image: dataUrl } });
    };
    reader.readAsDataURL(file);
  };
}

function pushLocationToHistory(userId, lat, lng, type, ts){
  const users = storage.get(DB.usersKey) || [];
  const u = users.find(x=>x.id===userId);
  if(!u) return;
  if(!u.locationHistory) u.locationHistory = [];
  const t = ts || now();
  const last = u.locationHistory[u.locationHistory.length-1];
  if(last && Math.abs((last.ts||0) - t) < 5000 && Math.abs(last.lat-lat) < 1e-6 && Math.abs(last.lng-lng) < 1e-6) return;
  u.locationHistory.push({lat,lng,ts: t, type: type || "minute"});
  if(u.locationHistory.length > 2000) u.locationHistory = u.locationHistory.slice(-2000);
  storage.set(DB.usersKey, users);
}

function haversineKm(a, b){
  const R = 6371;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat/2)**2 + Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function clearTrail(){
  if(!map || !trailGroup) return;
  try{ map.removeLayer(trailGroup); }catch(e){}
  trailGroup = null;
}

function drawTrailOnMap(hist, name){
  if(!map) return notice("Map is still loading.");
  const pts = (hist || []).filter(h => Number.isFinite(h.lat) && Number.isFinite(h.lng)).slice().sort((a,b)=>(a.ts||0)-(b.ts||0));
  if(pts.length < 1) return notice("No trail points to map yet. Keep Track On — a pin is saved every minute.");
  clearTrail();
  trailGroup = L.layerGroup();
  const latlngs = pts.map(h => [h.lat, h.lng]);
  if(latlngs.length >= 2){
    L.polyline(latlngs, { color: "#2dd4bf", weight: 4, opacity: 0.9 }).addTo(trailGroup);
  }
  const start = pts[0], end = pts[pts.length-1];
  L.circleMarker([start.lat, start.lng], { radius: 7, color: "#efe7dc", fillColor: "#c9a227", fillOpacity: 1, weight: 2 }).bindPopup("Start · " + new Date(start.ts).toLocaleString()).addTo(trailGroup);
  L.circleMarker([end.lat, end.lng], { radius: 8, color: "#042022", fillColor: "#2dd4bf", fillOpacity: 1, weight: 2 }).bindPopup((name || "Now") + " · " + new Date(end.ts).toLocaleString()).addTo(trailGroup);
  trailGroup.addTo(map);
  try{
    if(latlngs.length === 1) map.flyTo(latlngs[0], 16);
    else map.fitBounds(L.latLngBounds(latlngs), { padding: [36, 36], maxZoom: 16 });
  }catch(e){}
}

async function drawUserTrail(userId, fromTs){
  const u = getUserById(userId);
  if(!u) return;
  let hist = u.locationHistory || [];
  const j = await apiTry("/api/users/" + encodeURIComponent(userId) + "/history" + (fromTs ? ("?from=" + fromTs) : ""));
  if(j && j.history){ hist = j.history; u.locationHistory = j.history; saveUser(u); }
  if(fromTs) hist = hist.filter(h => (h.ts||0) >= fromTs);
  drawTrailOnMap(hist, u.name);
}

function recordHistoryPoint(lat, lng, type){
  const s = currentSession(); if(!s) return;
  const u = getUserById(s.userId);
  if(u && memberPrefs(u).recordHistory === false) return;
  const ts = now();
  pushLocationToHistory(s.userId, lat, lng, type || "minute", ts);
  apiTry("/api/location", { method:"POST", body: { lat, lng, type: type || "minute", record: true } });
}

let historyPrimed = false;
function startHistoryRecorder(){
  stopHistoryRecorder();
  historyPrimed = false;
  const snap = () => {
    if(!trackingEnabled) return;
    const s = currentSession(); if(!s) return;
    const u = getUserById(s.userId);
    const loc = lastFix || (u && u.lastLocation);
    if(!loc) return;
    historyPrimed = true;
    recordHistoryPoint(loc.lat, loc.lng, "minute");
  };
  historyTimer = setInterval(snap, 60 * 1000);
}

function stopHistoryRecorder(){
  if(historyTimer){ clearInterval(historyTimer); historyTimer = null; }
}

async function renderHistoryForUser(userId){
  if(!isFamilyWith(userId)) return notice("Location history is only visible for people in your family.");
  const u = getUserById(userId);
  if(!u) return notice("User not found");
  const s = currentSession();
  const self = !!(s && s.userId === userId);
  if(!self && memberPrefs(u).allowHistory === false){
    return notice("This member does not share location history.");
  }
  const wrap = make("div",{className:"hist-app"});
  wrap.appendChild(make("div",{className:"help-kicker"}, self ? "Your trail" : "Family trail"));
  wrap.appendChild(make("h3",{}, u.name || u.email || "User"));
  wrap.appendChild(make("p",{className:"small-muted"}, "While Track is On, a pin is saved every minute. Map the path, filter by time, or clear it."));

  const range = make("select",{className:"input"});
  [["60","Last hour"],["today","Today"],["1440","Last 24 hours"],["10080","Last 7 days"],["all","All recorded"]].forEach(([v,l]) => range.appendChild(make("option",{value:v}, l)));
  range.value = "1440";
  wrap.appendChild(make("label",{}, "Time range"));
  wrap.appendChild(range);

  const stats = make("div",{className:"privacy-note"});
  wrap.appendChild(stats);
  const list = make("div",{className:"hist-list"});
  wrap.appendChild(list);

  function fromTs(){
    const v = range.value;
    const t = now();
    if(v === "all") return 0;
    if(v === "today"){ const d = new Date(); d.setHours(0,0,0,0); return d.getTime(); }
    return t - Number(v) * 60 * 1000;
  }
  function filtered(src){
    const f = fromTs();
    return (src || []).filter(h => Number.isFinite(h.lat) && Number.isFinite(h.lng) && (!f || (h.ts||0) >= f));
  }
  function paint(src){
    const hist = filtered(src).slice().sort((a,b)=>(a.ts||0)-(b.ts||0));
    list.innerHTML = "";
    if(!hist.length){
      stats.textContent = "No points in this range. Turn Track On and wait a minute — or pick a wider range.";
      list.appendChild(make("div",{className:"small-muted"}, "Nothing recorded yet."));
      return hist;
    }
    let km = 0;
    for(let i=1;i<hist.length;i++) km += haversineKm(hist[i-1], hist[i]);
    stats.textContent = hist.length + " points · " + new Date(hist[0].ts).toLocaleString() + " → " + new Date(hist[hist.length-1].ts).toLocaleString() + " · ~" + (km < 1 ? (km*1000).toFixed(0)+" m" : km.toFixed(2)+" km");
    hist.slice().reverse().forEach(h => {
      const row = make("div",{className:"family-card hist-row"});
      const left = make("div",{}, make("div",{}, new Date(h.ts).toLocaleString()), make("div",{className:"small-muted"}, (h.type || "pin") + " · " + Number(h.lat).toFixed(5) + ", " + Number(h.lng).toFixed(5)));
      const goto = make("button",{className:"btn small secondary", type:"button"}, "Go");
      goto.onclick = () => { if(map) map.flyTo([h.lat,h.lng], 16); closeModal(); };
      row.append(left, goto);
      list.appendChild(row);
    });
    return hist;
  }

  let cache = u.locationHistory || [];
  paint(cache);

  const actions = make("div",{className:"row", style:"flex-wrap:wrap;gap:8px;margin-top:8px"});
  const mapBtn = make("button",{className:"btn", type:"button"}, "Map this trail");
  mapBtn.onclick = () => {
    const hist = paint(cache);
    closeModal();
    drawTrailOnMap(hist, u.name);
  };
  const hideBtn = make("button",{className:"btn small secondary", type:"button"}, "Hide trail");
  hideBtn.onclick = () => { clearTrail(); notice("Trail hidden."); };
  actions.append(mapBtn, hideBtn);
  if(self){
    const recNow = make("button",{className:"btn small secondary", type:"button"}, "Save pin now");
    recNow.onclick = () => {
      const loc = lastFix || u.lastLocation;
      if(!loc) return notice("No GPS yet. Turn Track On first.");
      recordHistoryPoint(loc.lat, loc.lng, "manual");
      cache = (getUserById(userId).locationHistory || cache);
      paint(cache);
    };
    const clearRange = make("button",{className:"btn small secondary", type:"button"}, "Clear this range");
    clearRange.onclick = async () => {
      if(!await ask("Delete the points in this time range from your history?")) return;
      const from = fromTs();
      const to = now();
      const wipeAll = !from;
      const j = await apiTry("/api/me/history", { method:"DELETE", body: wipeAll ? {} : { from, to } });
      if(wipeAll) u.locationHistory = [];
      else u.locationHistory = (u.locationHistory || []).filter(h => (h.ts||0) < from || (h.ts||0) > to);
      saveUser(u);
      cache = u.locationHistory;
      paint(cache);
      clearTrail();
      notice(j ? "History updated." : "Cleared on this device.");
    };
    const clearAll = make("button",{className:"btn small", type:"button", style:"background:var(--danger);color:#fff"}, "Clear all history");
    clearAll.onclick = async () => {
      if(!await ask("Erase your entire location history? This cannot be undone.")) return;
      await apiTry("/api/me/history", { method:"DELETE", body: {} });
      u.locationHistory = [];
      saveUser(u);
      cache = [];
      paint(cache);
      clearTrail();
    };
    actions.append(recNow, clearRange, clearAll);
  }
  wrap.appendChild(actions);

  range.onchange = () => paint(cache);
  showModal(wrap);
  apiTry("/api/users/" + encodeURIComponent(userId) + "/history").then(j => {
    if(j && j.history){
      u.locationHistory = j.history;
      saveUser(u);
      cache = j.history;
      paint(cache);
    }
  });
}

function updateFamilyMarkers(){
  const s = currentSession(); if(!s) return;
  const families = storage.get(DB.familiesKey) || [];
  const myFams = families.filter(f => Array.isArray(f.members) && f.members.includes(s.userId));
  const memberIds = new Set(myFams.flatMap(f=>f.members));

  markers = markers || {};

  if(map){
    memberIds.forEach(id=>{
      const u = getUserById(id);
      if(!u) return;
      const prefs = memberPrefs(u);
      if(s.userId !== id && prefs.appearOnMap === false){
        if(markers[id]){ try{ map.removeLayer(markers[id].marker); }catch(e){} delete markers[id]; }
        return;
      }
      if(u.lastLocation){
        const lng = u.lastLocation.lng, lat = u.lastLocation.lat;

        if(!markers[id]){
          const wrapper = document.createElement("div");
          wrapper.className = "member-marker-wrap";

          const imgWrap = document.createElement("div");
          imgWrap.style.width = "44px";
          imgWrap.style.height = "44px";
          imgWrap.style.borderRadius = "50%";
          imgWrap.style.overflow = "hidden";
          imgWrap.style.boxShadow = "0 6px 14px rgba(0,0,0,0.45)";
          imgWrap.style.border = "3px solid rgba(0,0,0,0.45)";
          imgWrap.style.display = "flex";
          imgWrap.style.alignItems = "center";
          imgWrap.style.justifyContent = "center";
          imgWrap.style.background = id===s.userId ? "var(--accent)" : "#ffb86b";

          const pImg = getProfileImageForUser(id);
          if(pImg){
            const img = document.createElement("img");
            img.src = pImg;
            img.style.width = "100%";
            img.style.height = "100%";
            img.style.objectFit = "cover";
            img.style.display = "block";
            imgWrap.appendChild(img);
          } else {
            const initials = (u?.name || "U").split(" ").map(x=>x[0]).slice(0,2).join("").toUpperCase();
            imgWrap.innerHTML = `<div style="color:#071018;font-weight:800">${initials}</div>`;
          }

          const label = document.createElement("div");
          label.className = "member-label";
          label.textContent = u.name || u.email || ("User " + id.slice(-4));
          label.setAttribute("data-user-id", id);

          wrapper.appendChild(imgWrap);
          wrapper.appendChild(label);

          const icon = L.divIcon({
            html: wrapper,
            className: '',
            iconSize: [180,56],
            iconAnchor: [22,22]
          });

          const marker = L.marker([lat, lng], { icon }).addTo(map);

          marker.on('click', () => { focusMember(id); });
          wrapper.addEventListener("click", (ev) => { ev.stopPropagation(); focusMember(id); });

          markers[id] = { marker, el: wrapper };
        } else {
          try{ markers[id].marker.setLatLng([lat, lng]); }catch(e){ console.warn("Failed to update marker position", e); }
          const pImg = getProfileImageForUser(id);
          if(pImg && markers[id].el){
            const imgWrap = markers[id].el.querySelector('div');
            if(imgWrap){
              imgWrap.innerHTML = `<img src="${pImg}" style="width:100%;height:100%;object-fit:cover;display:block"/>`;
            }
          }
        }
      } else {
        if(markers[id]){
          try{ map.removeLayer(markers[id].marker); }catch(e){}
          delete markers[id];
        }
      }
    });

    Object.keys(markers).forEach(id=>{
      if(!memberIds.has(id)){ try{ map.removeLayer(markers[id].marker); }catch(e){}; delete markers[id]; }
    });
  }

  const listEl = qs("#member-list");
  if(listEl){
    listEl.innerHTML = "";
    const filter = ((qs("#drawer-find") && qs("#drawer-find").value) || "").trim().toLowerCase();
    const filterDigits = digits(filter);

    const famHeader = make("div",{className:"small-muted", style:"padding:4px;font-weight:700;color:#e6eef0"}, "My Families");
    listEl.appendChild(famHeader);
    if(myFams.length === 0){
      listEl.appendChild(make("div",{className:"small-muted", style:"padding:2px 4px 6px"}, "No families yet."));
    }
    myFams.forEach(f=>{
      const crow = make("div",{className:"family-card", style:"display:flex;justify-content:space-between;align-items:center;gap:6px;padding:8px"});
      crow.appendChild(make("div",{style:"min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600"}, f.name + (f.members.length ? ` (${f.members.length})` : "")));
      const chat = make("button",{className:"btn small", style:"flex:0 0 auto;margin:0;padding:6px 8px", type:"button"}, "💬");
      chat.title = "Encrypted family chat";
      chat.onclick = () => { closeDrawer(); renderFamilyChat(f.id); };
      const share = make("button",{className:"btn small", style:"flex:0 0 auto;margin:0;padding:6px 8px", type:"button"}, "🔗");
      share.title = "Share invite / QR";
      share.onclick = () => openShareModal(f);
      const gear = make("button",{className:"btn small", style:"flex:0 0 auto;margin:0;padding:6px 8px", type:"button"}, "⚙");
      gear.title = "Family settings & roles";
      gear.onclick = () => { closeDrawer(); renderFamilyAdmin(uiBag(), f.id); };
      crow.appendChild(chat);
      crow.appendChild(share);
      crow.appendChild(gear);
      listEl.appendChild(crow);
    });

    if(myFams.length){
      const sep = document.createElement("div");
      sep.className = "small-muted";
      sep.style.cssText = "padding:6px 4px 2px;font-weight:700;color:#e6e9ed;border-top:1px solid rgba(255,255,255,0.04);margin-top:4px";
      sep.textContent = "Members";
      listEl.appendChild(sep);
    }

    const memberObjs = Array.from(memberIds).map(id => getUserById(id)).filter(Boolean);
    const sObj = currentSession();
    memberObjs.sort((a,b)=>{
      if(a.id === sObj.userId) return -1;
      if(b.id === sObj.userId) return 1;
      return (a.name || "").localeCompare(b.name || "");
    });
    memberObjs.forEach(u=>{
      if(filter){
        const blob = `${u.name||""} ${u.email||""} ${u.phone||""}`.toLowerCase();
        const ph = digits(u.phone);
        if(!blob.includes(filter) && !(filterDigits && ph.includes(filterDigits))) return;
      }
      const row = make("div",{className:"member-row"});
      const dotColor = u.lastLocation ? "green" : "#ff6b6b";
      const dot = make("div",{className:"status-dot", title: u.lastLocation ? "Active" : "Inactive", style:`background:${dotColor}`});
      const nameBtn = make("button",{className:"member-name", type:"button"}, u.name || u.email || ("User " + u.id.slice(-4)));
      nameBtn.onclick = () => { focusMember(u.id); };
      const meta = make("div",{className:"member-meta small-muted"}, u.lastLocation ? new Date(u.lastLocation.ts).toLocaleString() : "No location shared");

      const msgBtn = make("button",{className:"small-btn", type:"button", style:"margin-left:6px;background:transparent;border:1px solid rgba(255,255,255,0.03);color:var(--muted);padding:6px 8px;border-radius:8px"}, "💬");
      msgBtn.onclick = () => { renderMessagesForUser(u.id); };

      const histBtn = make("button",{className:"small-btn", type:"button", style:"margin-left:6px;background:transparent;border:1px solid rgba(255,255,255,0.03);color:var(--muted);padding:6px 8px;border-radius:8px"}, "🕘");
      histBtn.title = "View location history";
      histBtn.onclick = () => { renderHistoryForUser(u.id); };

      const actionsWrap = make("div",{className:"row", style:"gap:8px;align-items:center"});
      actionsWrap.append(msgBtn, histBtn);

      row.append(dot, nameBtn, meta, actionsWrap);
      listEl.appendChild(row);
    });

    if(filter && filter.length >= 2){
      const more = make("button",{className:"btn small secondary", type:"button"}, `Search directory for “${filter}”`);
      more.onclick = () => { closeDrawer(); renderFamilyList(filter); };
      listEl.appendChild(more);
    }
  }

  const sdiv = qs("#status");
  if(sdiv){
    const live = socket && socket.readyState === 1 ? " • live" : (serverOk ? " • online" : "");
    sdiv.textContent = `Signed in as ${getUserById(s.userId)?.name || "User"} • Families: ${myFams.length}${live}`;
  }
  updateLivePill();
  updateInboxBadge();
}

function publishLocation(lat, lng, type){
  const s = currentSession(); if(!s) return;
  lastFix = { lat, lng, ts: now() };
  const users = storage.get(DB.usersKey) || [];
  let u = users.find(x=>x.id===s.userId);
  if(u){
    u.lastLocation = { lat, lng, ts: lastFix.ts };
    saveUser(u);
  } else {
    u = { id: s.userId, name: "User", lastLocation: {lat, lng, ts: lastFix.ts}, locationHistory: [] };
    saveUser(u);
  }
  wsSend({ type:"location", lat, lng, kind: type || "live" });
  apiTry("/api/location", { method:"POST", body: { lat, lng, type: type || "live" } });
  if(trackingEnabled && !historyPrimed){
    historyPrimed = true;
    recordHistoryPoint(lat, lng, "minute");
  }
  updateFamilyMarkers();
}

let bgLifecycleBound = false;
let nativeWatchId = null;

function bindBgLifecycle(){
  if(bgLifecycleBound) return;
  bgLifecycleBound = true;
  document.addEventListener("visibilitychange", () => {
    if(document.hidden) flushLocationKeepalive();
    else {
      connectRealtime();
      enablePush();
      if(trackingEnabled) pingCurrentPosition();
    }
  });
  window.addEventListener("pagehide", flushLocationKeepalive);
  window.addEventListener("freeze", flushLocationKeepalive);
}

function flushLocationKeepalive(){
  if(!trackingEnabled || !lastFix) return;
  const s = currentSession();
  if(!s || !s.sessionToken) return;
  try{
    fetch("/api/location", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + s.sessionToken },
      body: JSON.stringify({ lat: lastFix.lat, lng: lastFix.lng, type: "bg", record: true }),
      keepalive: true
    });
  }catch(e){}
}

function pingCurrentPosition(){
  if(!trackingEnabled || !("geolocation" in navigator)) return;
  try{
    navigator.geolocation.getCurrentPosition(
      pos => publishLocation(pos.coords.latitude, pos.coords.longitude, "bg"),
      () => {},
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
  }catch(e){}
}

function notifySwTrack(on){
  const payload = { type: on ? "track-on" : "track-off" };
  const post = (reg) => {
    try{
      const worker = (reg && (reg.active || reg.waiting || reg.installing)) || (navigator.serviceWorker && navigator.serviceWorker.controller);
      if(worker) worker.postMessage(payload);
    }catch(e){}
  };
  try{
    if(navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage(payload);
    else if(navigator.serviceWorker) navigator.serviceWorker.ready.then(post).catch(()=>{});
  }catch(e){}
}

async function registerBgSync(){
  try{
    const reg = await navigator.serviceWorker.ready;
    if(reg.periodicSync && trackingEnabled){
      await reg.periodicSync.register("gps-familia-track", { minInterval: 60 * 1000 });
    }
  }catch(e){}
}
async function unregisterBgSync(){
  try{
    const reg = await navigator.serviceWorker.ready;
    if(reg.periodicSync) await reg.periodicSync.unregister("gps-familia-track");
  }catch(e){}
}

async function startNativeBackgroundGeo(){
  try{
    const cap = window.Capacitor && window.Capacitor.Plugins;
    const community = cap && cap.BackgroundGeolocation;
    if(community && community.addWatcher){
      nativeWatchId = await community.addWatcher({
        backgroundMessage: "GPS FAMILIA is recording your location history for family.",
        backgroundTitle: "Track On",
        requestPermissions: true,
        distanceFilter: 20
      }, (loc, err) => {
        if(loc && Number.isFinite(loc.latitude)) publishLocation(loc.latitude, loc.longitude, "bg");
      });
      return true;
    }
    if(window.BackgroundGeolocation && window.BackgroundGeolocation.configure){
      const bg = window.BackgroundGeolocation;
      bg.configure({
        locationProvider: bg.DISTANCE_FILTER_PROVIDER,
        desiredAccuracy: bg.HIGH_ACCURACY,
        stationaryRadius: 25,
        distanceFilter: 20,
        notificationTitle: "GPS FAMILIA",
        notificationText: "Tracking is On — tap Track Off in the app to stop",
        startForeground: true,
        interval: 60000,
        fastestInterval: 30000,
        stopOnTerminate: false,
        startOnBoot: true
      }, () => { try{ bg.start(); }catch(e){} });
      if(bg.on){
        bg.on("location", (loc) => {
          if(loc && Number.isFinite(loc.latitude)) publishLocation(loc.latitude, loc.longitude, "bg");
        });
      }
      return true;
    }
  }catch(e){ console.warn("native bg geo", e); }
  return false;
}
function stopNativeBackgroundGeo(){
  try{
    const cap = window.Capacitor && window.Capacitor.Plugins;
    if(cap && cap.BackgroundGeolocation && nativeWatchId){
      cap.BackgroundGeolocation.removeWatcher({ id: nativeWatchId });
      nativeWatchId = null;
    }
    if(window.BackgroundGeolocation && window.BackgroundGeolocation.stop){
      window.BackgroundGeolocation.stop();
    }
  }catch(e){}
}

function startTracking(opts){
  opts = opts || {};
  if(trackingEnabled) return;
  trackingEnabled = true;
  persistTrack(true);
  bindBgLifecycle();
  const btn = qs("#btn-toggle-tracking");
  if(btn){ btn.textContent = t("nav.trackOn"); btn.classList.add("on"); btn.style.color = ""; btn.setAttribute("aria-pressed","true"); }
  navigator.permissions && navigator.permissions.query({name:'geolocation'}).catch(()=>null);
  startNativeBackgroundGeo();
  notifySwTrack(true);
  registerBgSync();
  if("geolocation" in navigator){
    watchId = navigator.geolocation.watchPosition(pos => {
      publishLocation(pos.coords.latitude, pos.coords.longitude, "live");
    }, err => {
      if(lastFix){ console.warn("Geolocation error", err); return; }
      const demoLat = 39.7392 + (Math.random()-0.5)*0.02;
      const demoLng = -104.9903 + (Math.random()-0.5)*0.02;
      publishLocation(demoLat, demoLng, "demo");
      console.warn("Geolocation error", err);
    }, {enableHighAccuracy:true, maximumAge:2000, timeout:10000});
  } else if(!opts.resume) {
    notice("Geolocation not available — running demo simulation.");
  }
  startHistoryRecorder();
}

function stopTracking(){
  trackingEnabled = false;
  persistTrack(false);
  stopHistoryRecorder();
  stopNativeBackgroundGeo();
  notifySwTrack(false);
  unregisterBgSync();
  const btn = qs("#btn-toggle-tracking");
  if(btn){ btn.textContent = t("nav.trackOff"); btn.classList.remove("on"); btn.style.color = ""; btn.setAttribute("aria-pressed","false"); }
  if(watchId && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
  watchId = null;
}

function updateUIForSession(){
  const s = currentSession();
  const status = qs("#status");
  if(status){
    if(s && s.userId) status.textContent = "Signed in as " + (getUserById(s.userId)?.name || "User");
    else status.textContent = "Not signed in";
  }
  const track = qs("#btn-toggle-tracking");
  if(track){
    track.textContent = trackingEnabled ? t("nav.trackOn") : t("nav.trackOff");
    track.setAttribute("aria-pressed", trackingEnabled ? "true" : "false");
    track.classList.toggle("on", !!trackingEnabled);
  }
  updateProfileThumb();
  updateInboxBadge();
  if(qs("#account-drawer") && qs("#account-drawer").classList.contains("open")) paintAccountDrawer();
}

function centerOnMe(){
  const s = currentSession(); if(!s) return;
  const u = getUserById(s.userId);
  if(u && u.lastLocation) map.flyTo([u.lastLocation.lat, u.lastLocation.lng], 14);
  else notice("No location shared yet. Enable tracking first.");
}

function closeFeedPanel(){
  const panel = qs("#feed-panel");
  document.body.classList.remove("feed-open");
  if(panel){ panel.classList.remove("open"); panel.setAttribute("aria-hidden","true"); }
  const btn = qs("#btn-community");
  if(btn) btn.classList.remove("on");
  window.__refreshFeed = null;
  setTimeout(()=>{ try{ if(window.reflowMap) window.reflowMap(); }catch(e){} }, 280);
}
function openFeedPanel(opts){
  if(!currentSession()) return notice("Sign in first");
  closeDrawer();
  closeAccountDrawer();
  closeMarketPanel();
  const panel = qs("#feed-panel");
  const root = qs("#feed-root");
  if(!panel || !root){
    return renderCommunityFeed(Object.assign({}, uiBag(), { openFeedPanel: null }), opts || {});
  }
  document.body.classList.add("feed-open");
  panel.classList.add("open");
  panel.setAttribute("aria-hidden","false");
  const btn = qs("#btn-community");
  if(btn) btn.classList.add("on");
  mountCommunityFeed(uiBag(), root, opts || {});
  setTimeout(()=>{ try{ if(window.reflowMap) window.reflowMap(); }catch(e){} }, 60);
}
function toggleFeedPanel(){
  const panel = qs("#feed-panel");
  if(panel && panel.classList.contains("open")) closeFeedPanel();
  else openFeedPanel();
}
function closeMarketPanel(){
  const panel = qs("#market-panel");
  document.body.classList.remove("market-open");
  if(panel){ panel.classList.remove("open"); panel.setAttribute("aria-hidden","true"); }
  const btn = qs("#btn-market");
  if(btn) btn.classList.remove("on");
  window.__refreshMarket = null;
  setTimeout(()=>{ try{ if(window.reflowMap) window.reflowMap(); }catch(e){} }, 280);
}
function openMarketPanel(opts){
  if(!currentSession()) return notice("Sign in first");
  closeDrawer();
  closeAccountDrawer();
  closeFeedPanel();
  const panel = qs("#market-panel");
  const root = qs("#market-root");
  if(!panel || !root) return notice("Marketplace UI missing");
  document.body.classList.add("market-open");
  panel.classList.add("open");
  panel.setAttribute("aria-hidden","false");
  const btn = qs("#btn-market");
  if(btn) btn.classList.add("on");
  mountMarketplace(uiBag(), root, opts || {});
  setTimeout(()=>{ try{ if(window.reflowMap) window.reflowMap(); }catch(e){} }, 60);
}
function toggleMarketPanel(){
  const panel = qs("#market-panel");
  if(panel && panel.classList.contains("open")) closeMarketPanel();
  else openMarketPanel();
}

async function renderWallet(){
  const s = currentSession(); if(!s) return renderAuth();
  const wrap = make("div");
  wrap.appendChild(make("div",{className:"help-kicker"}, "Payments"));
  wrap.appendChild(make("h3",{}, "Wallet"));
  wrap.appendChild(make("p",{className:"small-muted"}, "Cards and banks stay tokenized — we never store a full card number, CVC, or routing number. Marketplace checkout is peer-to-peer: the seller receives the listed price; the buyer pays a 6.9% service fee ($0.49 min, $25 cap)."));
  const box = make("div");
  wrap.appendChild(box);
  async function paint(){
    box.innerHTML = "";
    const j = await apiTry("/api/pay/wallet");
    if(!j){ box.appendChild(make("div",{className:"privacy-note"}, "Could not load wallet.")); return; }
    const bal = Math.round(Number(j.balance || 0) * 100) / 100;
    box.appendChild(make("div",{className:"market-price"}, "Available  $" + bal.toFixed(2)));
    box.appendChild(make("div",{className:"small-muted"}, "Sales land here as available balance. Add a card to buy, or a bank to cash out."));
    (j.methods || []).forEach((m) => {
      const row = make("div",{className:"pref-row"});
      row.appendChild(make("label",{}, (m.brand || "card").toUpperCase() + " •••• " + m.last4 + "  " + (m.expMonth||"") + "/" + (m.expYear||"")));
      const del = make("button",{className:"btn small secondary", type:"button"}, "Remove");
      del.onclick = async () => { await apiTry("/api/pay/methods/" + encodeURIComponent(m.id), { method:"DELETE" }); paint(); };
      row.appendChild(del);
      box.appendChild(row);
    });
    (j.banks || []).forEach((b) => {
      const row = make("div",{className:"pref-row"});
      row.appendChild(make("label",{}, (b.name || "Bank") + " •••• " + b.last4));
      const del = make("button",{className:"btn small secondary", type:"button"}, "Remove");
      del.onclick = async () => { await apiTry("/api/pay/banks/" + encodeURIComponent(b.id), { method:"DELETE" }); paint(); };
      row.appendChild(del);
      box.appendChild(row);
    });
    if(!(j.methods||[]).length && !(j.banks||[]).length){
      box.appendChild(make("div",{className:"privacy-note"}, "No cards or banks on file."));
    }
  }
  const addCard = make("button",{className:"btn", type:"button"}, "Add card");
  addCard.onclick = () => {
    const form = make("div");
    form.appendChild(make("h3",{}, "Add a card"));
    form.appendChild(make("p",{className:"small-muted"}, "Enter last 4 digits only. Never type a full card number here."));
    const last4 = make("input",{className:"input", inputMode:"numeric", maxlength:"4", placeholder:"Last 4"});
    const brand = make("select",{className:"input"});
    ["visa","mastercard","amex","discover"].forEach((b) => brand.appendChild(make("option",{value:b}, b)));
    const expM = make("input",{className:"input", inputMode:"numeric", placeholder:"Exp month (1-12)"});
    const expY = make("input",{className:"input", inputMode:"numeric", placeholder:"Exp year (e.g. 2028)"});
    const save = make("button",{className:"btn", type:"button"}, "Save token");
    save.onclick = async () => {
      try{
        await api("/api/pay/methods", { method:"POST", body: { last4: last4.value, brand: brand.value, expMonth: Number(expM.value), expYear: Number(expY.value) } });
        notice("Card token saved.");
        closeModal();
        renderWallet();
      }catch(e){ notice(e.message || "Could not save"); }
    };
    form.append(last4, brand, expM, expY, make("div",{className:"row", style:"margin-top:10px;justify-content:flex-end"}, save));
    showModal(form, { variant:"form" });
  };
  const addBank = make("button",{className:"btn secondary", type:"button"}, "Connect bank");
  addBank.onclick = async () => {
    const tok = await apiTry("/api/pay/plaid/link-token", { method:"POST", body: {} });
    if(!tok) return notice("Could not start Plaid.");
    if(tok.demo){
      const form = make("div");
      form.appendChild(make("h3",{}, "Connect a bank (demo)"));
      form.appendChild(make("p",{className:"small-muted"}, "Pick your bank. We never collect routing or account numbers here."));
      const inst = make("select",{className:"input"});
      (tok.institutions || [{id:"chase", name:"Chase"}]).forEach((i) => inst.appendChild(make("option",{value:i.name}, i.name)));
      const last4 = make("input",{className:"input", inputMode:"numeric", maxlength:"4", placeholder:"Account last 4"});
      const go = make("button",{className:"btn", type:"button"}, "Link");
      go.onclick = async () => {
        try{
          await api("/api/pay/plaid/exchange", { method:"POST", body: { institution: inst.value, last4: last4.value } });
          notice("Bank linked.");
          closeModal();
          renderWallet();
        }catch(e){ notice(e.message || "Could not link"); }
      };
      form.append(inst, last4, make("div",{className:"row", style:"margin-top:10px;justify-content:flex-end"}, go));
      showModal(form, { variant:"form" });
      return;
    }
    notice("Plaid Link token ready. Complete Link in a production host with the Plaid SDK.");
  };
  wrap.appendChild(make("div",{className:"row", style:"gap:8px;margin-top:12px;flex-wrap:wrap"}, addCard, addBank));
  await paint();
  showModal(wrap, { variant: "form" });
}

function uiBag(){
  return {
    make, api, apiTry, apiCatch, currentSession, setSession, afterSignIn, cacheUserFromServer, closeModal, updateUIForSession, renderFamilyList, renderAvatarPicker,
    showModal, getAvatarFor, getUserById, myFamilies, qs, openShareModal, renderFamilyChat,
    notice, ask, askText, openFeedPanel, closeFeedPanel, toggleFeedPanel, mountCommunityFeed,
    uploadMedia, fileToCompressedBlob, loadToDataUrlSafely, fileToCompressedDataUrl,
    openMarketPanel, closeMarketPanel, renderMessagesForUser, renderReportUser, renderWallet,
    previewInvite, openInviteFromRaw, showInvitePreview, scanInviteFromCamera, qrDataUrl,
    renderInvitePerson, renderBlockUser, renderInbox
  };
}

function bindUI(){
  bindCalls(uiBag());
  bindPeople(uiBag());
  bindDrawer();
  bindMapTools();
  const communityBtn = qs("#btn-community");
  if(communityBtn) communityBtn.onclick = () => toggleFeedPanel();
  const marketBtn = qs("#btn-market");
  if(marketBtn) marketBtn.onclick = () => toggleMarketPanel();
  const searchBtn = qs("#btn-search");
  if(searchBtn) searchBtn.onclick = () => renderFamilyList();
  const helpBtn = qs("#btn-help");
  if(helpBtn) helpBtn.onclick = () => renderHelp("welcome");
  const sosBtn = qs("#btn-sos");
  if(sosBtn) sosBtn.onclick = () => sendSos();
  const trackBtn = qs("#btn-toggle-tracking");
  if(trackBtn) trackBtn.onclick = () => {
    if(!currentSession()){ notice("Sign in first"); return; }
    if(trackingEnabled) stopTracking();
    else if(hasGpsConsent()) startTracking();
    else renderDisclaimer(()=>{ startTracking(); });
  };

  const inboxBtn = qs("#btn-inbox");
  if(inboxBtn) inboxBtn.onclick = () => { renderInbox(); };

  const drawerFind = qs("#drawer-find");
  if(drawerFind){
    drawerFind.addEventListener("input", debounce(() => updateFamilyMarkers(), 180));
  }

  initProfileInput();
  bindDock();
  document.addEventListener("keydown", (e) => {
    if(e.key === "Escape"){
      hideMsgMenu();
      hidePinSheet();
      closeDrawer();
      closeAccountDrawer();
      closeFeedPanel();
      closeMarketPanel();
      document.querySelectorAll(".feed-lightbox").forEach(n => n.remove());
    }
  });
  startLiveTimers();
  mountDebugHud();
}

function setDock(id){
  document.querySelectorAll("#app-dock .dock-btn").forEach((x) => x.classList.toggle("on", x.getAttribute("data-dock") === id));
}
function bindDock(){
  const dock = qs("#app-dock");
  if(!dock || dock.dataset.bound) return;
  dock.dataset.bound = "1";
  dock.addEventListener("click", (e) => {
    const b = e.target.closest("[data-dock]");
    if(!b) return;
    const id = b.getAttribute("data-dock");
    setDock(id);
    if(id === "map"){
      closeFeedPanel(); closeMarketPanel(); closeDrawer(); closeAccountDrawer(); closeAllModals();
    } else if(id === "inbox"){
      renderInbox();
    } else if(id === "feed"){
      openFeedPanel();
    } else if(id === "market"){
      openMarketPanel();
    } else if(id === "menu"){
      const hit = qs("#btn-account");
      if(hit) hit.click();
    }
  });
}

let markerTimer = null, badgeTimer = null, syncTimer = null;
function startLiveTimers(){
  if(markerTimer) return;
  markerTimer = setInterval(() => { if(!document.hidden) updateFamilyMarkers(); }, 2500);
  badgeTimer = setInterval(() => { if(!document.hidden) updateInboxBadge(); }, 5000);
  syncTimer = setInterval(() => { if(!document.hidden && currentSession()) syncFromServer(); }, 15000);
  document.addEventListener("visibilitychange", () => {
    if(!document.hidden && currentSession()) syncFromServer();
  });
}

function mountDebugHud(){
  if(!/[?&]debug=1(?:&|$)/.test(location.search)) return;
  if(qs("#debug-hud")) return;
  const el = document.createElement("div");
  el.id = "debug-hud";
  el.setAttribute("role", "status");
  document.body.appendChild(el);
  const tick = () => {
    el.textContent = "v2.14 · " + (document.hidden ? "hidden" : "live") + " · " + (qs("#live-pill") ? qs("#live-pill").textContent : "");
  };
  tick();
  setInterval(tick, 2000);
}

function dismissSplash(){
  const overlay = document.getElementById("splash-overlay");
  if(!overlay) return;
  overlay.classList.add("hidden");
  overlay.setAttribute("aria-hidden", "true");
  overlay.style.display = "none";
  overlay.style.pointerEvents = "none";
  overlay.style.zIndex = "0";
}

function showSplashThenBoot(){
  const overlay = document.getElementById("splash-overlay");
  const btn = document.getElementById("splash-continue");
  let done = false;

  function finishSplash(){
    if(done) return;
    done = true;
    try{ if(typeof window.__hideSplash === "function") window.__hideSplash(); }catch(e){}
    dismissSplash();
    showLegalGate().then(() => {
      try{ boot(); }catch(e){ console.error(e); }
    }).catch(e => {
      console.error(e);
      try{ boot(); }catch(e2){ console.error(e2); }
    });
  }

  if(btn) btn.addEventListener("click", finishSplash);
  if(overlay && overlay.classList.contains("hidden")){
    finishSplash();
    return;
  }
  setTimeout(()=>{ finishSplash(); }, 5600);
}

function boot(){
  applyI18n(document);
  initMap();
  bindUI();
  updateUIForSession();
  updateLivePill();
  if("serviceWorker" in navigator){
    navigator.serviceWorker.register("/sw.js").catch(()=>{});
    navigator.serviceWorker.addEventListener("message", (ev) => {
      const d = ev.data || {};
      if(d.type === "open" && d.url) openFromNotificationUrl(d.url);
      if(d.type === "track-ping" && trackingEnabled) pingCurrentPosition();
    });
  }
  document.addEventListener("visibilitychange", () => {
    if(!document.hidden && currentSession()){
      connectRealtime();
      enablePush();
    }
  });
  window.addEventListener("online", () => {
    if(currentSession()){ connectRealtime(); enablePush(); }
  });
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); window.__deferredPrompt = e; });
  apiTry("/api/config").then(j => { if(j) applyServerConfig(j); });

  const pending = captureInviteFromUrl();

  openFromNotificationUrl(location.href);

  if(!currentSession()){
    renderAuth({ registerFirst: !!pending });
  } else {
    const s = currentSession(); let u = getUserById(s.userId);
    connectRealtime();
    syncFromServer();
    if(!u){ renderAuth({ registerFirst: !!pending }); }
    else {
      consumePendingInvite().then(() => ensureAlertPermission().then(() => resumeOrOfferTracking()));
    }
  }
}

window.f360 = window.f360 || {};
window.f360.updateInboxBadge = updateInboxBadge;
window.f360.sync = syncFromServer;
window.f360.notice = notice;
window.f360.ask = ask;
window.f360.askText = askText;
window.f360.showLegalGate = showLegalGate;
window.f360.openFeed = openFeedPanel;
window.f360.afterSignIn = afterSignIn;
window.f360.ensureAlertPermission = ensureAlertPermission;

document.addEventListener("DOMContentLoaded", () => {
  if(document.getElementById("splash-overlay")){
    showSplashThenBoot();
  } else {
    showLegalGate().then(() => boot()).catch(e => console.error(e));
  }
});
