/**
 * People profile, QR router, notification center.
 * Uses existing friends / family / pay APIs — no second identity system.
 */

function uiNotice(msg) {
  if (window.f360 && typeof window.f360.notice === "function") return window.f360.notice(String(msg == null ? "" : msg));
  return Promise.resolve();
}
function uiAsk(msg) {
  if (window.f360 && typeof window.f360.ask === "function") return window.f360.ask(String(msg == null ? "" : msg));
  return Promise.resolve(false);
}

function relOf(u) {
  return (u && u.relationship) || {};
}

export function statusChip(rel) {
  const st = (rel && rel.state) || "NONE";
  const label = (rel && rel.label) || "Add Friend";
  return { state: st, label };
}

export async function openPeopleProfile(H, userId) {
  const { make, apiTry, showModal, closeModal, getAvatarFor, renderMessagesForUser, renderInvitePerson, renderReportUser, renderBlockUser, qrDataUrl } = H;
  const j = await apiTry("/api/users/" + encodeURIComponent(userId) + "/relationship");
  if (!j || !j.user) return uiNotice("Could not load this profile.");
  const u = j.user;
  const rel = j.relationship || {};
  const wrap = make("div", { className: "people-profile" });
  wrap.appendChild(make("div", { className: "help-kicker" }, "Who is this?"));
  const head = make("div", { className: "people-head" });
  const av = make("div", { className: "chat-avatar", style: "width:64px;height:64px;flex:0 0 64px;font-size:22px" });
  av.innerHTML = getAvatarFor(u);
  const info = make("div", { style: "flex:1;min-width:0" });
  info.appendChild(make("h3", { style: "margin:0" }, u.name || "Member"));
  info.appendChild(make("div", { className: "rel-chip" }, rel.label || "Add Friend"));
  if (u.inFamily) info.appendChild(make("div", { className: "small-muted" }, "In one of your families"));
  head.append(av, info);
  wrap.appendChild(head);
  wrap.appendChild(make("p", { className: "small-muted" }, "What you can do depends on whether they accepted you. Location stays hidden unless you share a family."));

  const actions = make("div", { className: "people-actions" });
  const acts = rel.actions || [];
  const busy = { on: false };
  function btn(label, cls, fn) {
    const b = make("button", { className: "btn small" + (cls ? " " + cls : ""), type: "button" }, label);
    b.onclick = async () => {
      if (busy.on) return;
      busy.on = true;
      b.disabled = true;
      try { await fn(); } finally { busy.on = false; b.disabled = false; }
    };
    actions.appendChild(b);
    return b;
  }
  if (acts.includes("add_friend")) btn("Add Friend", "", async () => {
    const r = await apiTry("/api/friends/request", { method: "POST", body: { userId: u.id } });
    if (r && (r.ok || r.requested || r.accepted)) { await uiNotice(r.accepted ? "You're now connected" : "Friend request sent"); closeModal(); openPeopleProfile(H, userId); }
    else uiNotice((r && r.error) || "Could not send request.");
  });
  if (acts.includes("accept_friend")) btn("Accept", "", async () => {
    const r = await apiTry("/api/friends/" + encodeURIComponent(rel.requestId) + "/accept", { method: "POST", body: {} });
    if (r && r.ok) { await uiNotice("You're now connected"); closeModal(); openPeopleProfile(H, userId); }
    else uiNotice("Could not accept.");
  });
  if (acts.includes("decline_friend")) btn("Decline", "secondary", async () => {
    await apiTry("/api/friends/" + encodeURIComponent(rel.requestId) + "/decline", { method: "POST", body: {} });
    closeModal();
  });
  if (acts.includes("cancel_friend")) btn("Cancel Request", "secondary", async () => {
    await apiTry("/api/friends/" + encodeURIComponent(rel.requestId) + "/cancel", { method: "POST", body: {} });
    await uiNotice("Request cancelled");
    closeModal(); openPeopleProfile(H, userId);
  });
  if (acts.includes("remove_friend")) btn("Remove Friend", "secondary", async () => {
    if (!(await uiAsk("Are you sure you want to remove " + (u.name || "this person") + "?"))) return;
    await apiTry("/api/friends/" + encodeURIComponent(rel.requestId || u.id), { method: "DELETE", body: {} });
    await uiNotice("Removed");
    closeModal();
  });
  if (acts.includes("message") || acts.includes("message_request")) btn(acts.includes("message") ? "Message" : "Message Request", "", async () => {
    closeModal();
    if (typeof renderMessagesForUser === "function") renderMessagesForUser(u.id);
  });
  if (acts.includes("invite_family")) btn("Invite to Family", "secondary", async () => {
    if (typeof renderInvitePerson === "function") renderInvitePerson(u);
  });
  if (acts.includes("block")) btn(rel.iBlocked ? "Blocked" : "Block", "secondary", async () => {
    if (typeof renderBlockUser === "function") await renderBlockUser(u);
  });
  if (acts.includes("report")) btn("Report", "secondary", async () => {
    if (typeof renderReportUser === "function") renderReportUser(u.id);
  });
  if (acts.includes("share") || acts.includes("my_qr")) btn("Share / QR", "secondary", async () => openMyQr(H, { userId: u.id }));
  wrap.appendChild(actions);
  showModal(wrap, { variant: "form" });
}

export async function openMyQr(H, opts) {
  opts = opts || {};
  const { make, apiTry, showModal, qrDataUrl } = H;
  const type = opts.type || "profile";
  const body = { type };
  if (opts.familyId) body.familyId = opts.familyId;
  if (opts.amount) body.amount = opts.amount;
  const j = await apiTry("/api/qr/generate", { method: "POST", body });
  if (!j || !j.qr) return uiNotice("Could not make a QR code.");
  const wrap = make("div", { className: "qr-card" });
  wrap.appendChild(make("div", { className: "help-kicker" }, "My QR"));
  wrap.appendChild(make("h3", {}, type === "payment" ? "Scan to pay" : "Scan to connect"));
  wrap.appendChild(make("p", { className: "small-muted" }, "This code does not include your email or phone. They still have to accept."));
  const img = make("img", { alt: "Personal QR", style: "width:220px;height:220px;border-radius:12px;background:#fff;display:block;margin:8px auto" });
  qrDataUrl(j.qr.url).then((d) => { if (d) img.src = d; });
  wrap.appendChild(img);
  const copy = make("button", { className: "btn small", type: "button" }, "Copy link");
  copy.onclick = async () => {
    try { await navigator.clipboard.writeText(j.qr.url); copy.textContent = "Copied"; } catch (e) { uiNotice(j.qr.url); }
  };
  wrap.appendChild(make("div", { className: "row", style: "justify-content:center;margin-top:8px" }, copy));
  showModal(wrap, { variant: "form" });
}

export async function routeQr(H, raw) {
  const { apiCatch, apiTry, closeModal, showInvitePreview, renderMessagesForUser, openMarketPanel } = H;
  const token = String(raw || "").trim();
  if (!token) { await uiNotice("No QR found."); return false; }
  let j = await apiCatch("/api/qr/resolve", { method: "POST", body: { token } });
  if (!j || j.error) {
    const prev = typeof H.previewInvite === "function" ? await H.previewInvite(token) : null;
    if (prev && prev.ok) {
      closeModal();
      await showInvitePreview(prev);
      return true;
    }
    await uiNotice((j && j.error) || "This QR code is not recognized.");
    return false;
  }
  await uiNotice("QR code recognized");
  if (j.kind === "FAMILY_INVITE") {
    if (j.token && typeof H.openInviteFromRaw === "function") return H.openInviteFromRaw(j.token);
    if (j.alreadyMember) { await uiNotice("You're already in that family."); return true; }
    return true;
  }
  if (j.kind === "PAYMENT_REQUEST") {
    const name = (j.user && j.user.name) || "this person";
    const amt = j.amount ? (" $" + Number(j.amount).toFixed(2)) : "";
    if (!(await uiAsk("Send" + amt + " to " + name + "? You'll confirm the payment method next."))) return false;
    if (typeof openMarketPanel === "function") openMarketPanel({ payTo: j.toUserId, amount: j.amount });
    else await uiNotice("Open Marketplace to finish this payment.");
    return true;
  }
  if (j.user && j.user.id) {
    closeModal();
    await openPeopleProfile(H, j.user.id);
    return true;
  }
  await uiNotice("This QR code is not supported.");
  return false;
}

export async function openQrScan(H) {
  const raw = typeof H.scanInviteFromCamera === "function" ? await H.scanInviteFromCamera() : "";
  if (!raw) return false;
  return routeQr(H, raw);
}

export async function openNotifications(H) {
  const { make, apiTry, showModal, closeModal } = H;
  const wrap = make("div", { className: "notif-app" });
  wrap.appendChild(make("div", { className: "help-kicker" }, "Needs your attention"));
  wrap.appendChild(make("h3", {}, "Notifications"));
  const tabs = make("div", { className: "people-tabs" });
  let filter = "all";
  const list = make("div", { className: "notif-list" });
  async function paint() {
    list.innerHTML = "";
    list.appendChild(make("div", { className: "small-muted" }, "Loading…"));
    const j = await apiTry("/api/notifications?filter=" + encodeURIComponent(filter));
    list.innerHTML = "";
    const rows = (j && j.notifications) || [];
    if (!rows.length) {
      list.appendChild(make("div", { className: "privacy-note" }, "You're all caught up."));
      return;
    }
    rows.forEach((n) => {
      const card = make("button", { className: "notif-card" + (n.readAt ? "" : " unread"), type: "button" });
      card.appendChild(make("div", { style: "font-weight:700" }, n.title || n.type));
      card.appendChild(make("div", { className: "small-muted" }, n.body || ""));
      card.onclick = async () => {
        await apiTry("/api/notifications/" + encodeURIComponent(n.id) + "/read", { method: "POST", body: {} });
        closeModal();
        if (n.type === "friend") H.renderFamilyList && H.renderFamilyList("", { tab: "friends" });
        else if (n.type === "family") H.renderFamilyList && H.renderFamilyList("", { tab: "requests" });
        else if (n.type === "message") H.renderInbox && H.renderInbox();
        else if (n.url && n.url.indexOf("chat=") >= 0) {
          const id = String(n.url).split("chat=")[1];
          if (id && H.renderMessagesForUser) H.renderMessagesForUser(id);
        }
      };
      list.appendChild(card);
    });
  }
  [["all", "All"], ["friend", "Friends"], ["family", "Family"], ["message", "Messages"], ["payment", "Pay"]].forEach(([id, label]) => {
    const b = make("button", { className: "inbox-chip" + (id === "all" ? " on" : ""), type: "button" }, label);
    b.onclick = () => { filter = id; tabs.querySelectorAll(".inbox-chip").forEach((x) => x.classList.remove("on")); b.classList.add("on"); paint(); };
    tabs.appendChild(b);
  });
  const readAll = make("button", { className: "btn small secondary", type: "button" }, "Mark all read");
  readAll.onclick = async () => { await apiTry("/api/notifications/read-all", { method: "POST", body: {} }); paint(); };
  wrap.append(tabs, readAll, list);
  showModal(wrap);
  paint();
}

export function bindPeople(H) {
  window.f360 = window.f360 || {};
  window.f360.openPeopleProfile = (id) => openPeopleProfile(H, id);
  window.f360.openMyQr = (opts) => openMyQr(H, opts);
  window.f360.openQrScan = () => openQrScan(H);
  window.f360.routeQr = (raw) => routeQr(H, raw);
  window.f360.openNotifications = () => openNotifications(H);
}
