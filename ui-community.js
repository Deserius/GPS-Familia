import { mountCommunityFeed } from "./ui-feed.js";
export { mountCommunityFeed };

function uiNotice(msg){
  if (window.f360 && typeof window.f360.notice === "function") return window.f360.notice(String(msg == null ? "" : msg));
  return Promise.resolve();
}
function uiAsk(msg){
  if (window.f360 && typeof window.f360.ask === "function") return window.f360.ask(String(msg == null ? "" : msg));
  return Promise.resolve(false);
}

/* Community feed, family roles, demo logins, official social icons */

export const SOCIAL_SVG = {
  whatsapp: `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="#25D366" d="M12.04 2C6.58 2 2.15 6.43 2.15 11.89c0 1.95.52 3.8 1.5 5.44L2 22l4.82-1.56a9.86 9.86 0 0 0 5.22 1.48h.01c5.46 0 9.89-4.43 9.89-9.89C21.94 6.43 17.5 2 12.04 2zm5.72 14.01c-.24.68-1.4 1.26-1.94 1.31-.5.05-1.12.07-1.81-.11-.42-.11-.96-.31-1.66-.61-2.92-1.26-4.82-4.21-4.97-4.41-.14-.2-1.18-1.57-1.18-3 0-1.42.74-2.12 1-2.41.24-.27.64-.39.86-.39h.62c.2 0 .47-.04.73.56.27.63.91 2.2.99 2.36.08.16.13.35.03.56-.1.22-.16.35-.3.54-.15.19-.31.42-.44.56-.15.15-.3.31-.13.6.17.3.76 1.25 1.63 2.03 1.12 1 2.07 1.31 2.36 1.46.3.15.47.13.64-.08.18-.2.75-.87.95-1.17.2-.3.4-.25.67-.15.27.1 1.71.81 2 .95.3.15.5.22.57.34.08.13.08.73-.16 1.41z"/></svg>`,
  telegram: `<svg viewBox="0 0 24 24" width="22" height="22"><path fill="#26A5E4" d="M11.94 2C6.42 2 2 6.42 2 11.94c0 5.52 4.42 9.94 9.94 9.94 5.52 0 9.94-4.42 9.94-9.94C21.88 6.42 17.46 2 11.94 2zm4.86 6.77-1.63 7.68c-.12.55-.45.68-.9.42l-2.5-1.84-1.2 1.16c-.13.13-.25.25-.51.25l.18-2.55 4.64-4.19c.2-.18-.04-.28-.31-.1l-5.74 3.61-2.47-.77c-.54-.17-.55-.54.11-.8l9.65-3.72c.45-.16.84.1.68.85z"/></svg>`,
  facebook: `<svg viewBox="0 0 24 24" width="22" height="22"><path fill="#1877F2" d="M24 12.07C24 5.41 18.63 0 12 0S0 5.41 0 12.07C0 18.1 4.39 23.09 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.8-4.7 4.54-4.7 1.31 0 2.69.24 2.69.24v2.97h-1.52c-1.5 0-1.96.93-1.96 1.89v2.26h3.34l-.53 3.49h-2.81V24C19.61 23.09 24 18.1 24 12.07z"/></svg>`,
  x: `<svg viewBox="0 0 24 24" width="20" height="20"><path fill="#e6eef0" d="M18.24 2H21.5l-7.16 8.19L22.5 22h-6.59l-5.16-6.74L5.2 22H1.92l7.67-8.76L1.5 2h6.76l4.66 6.18L18.24 2zm-1.16 18h1.81L7.01 3.89H5.07L17.08 20z"/></svg>`,
  instagram: `<svg viewBox="0 0 24 24" width="22" height="22"><defs><radialGradient id="igGradFamilia" cx="30%" cy="110%"><stop offset="0" stop-color="#f58529"/><stop offset=".5" stop-color="#dd2a7b"/><stop offset="1" stop-color="#8134af"/></radialGradient></defs><rect x="2" y="2" width="20" height="20" rx="6" fill="url(#igGradFamilia)"/><circle cx="12" cy="12" r="4.2" fill="none" stroke="#fff" stroke-width="1.7"/><circle cx="17.2" cy="6.8" r="1.1" fill="#fff"/></svg>`,
  snapchat: `<svg viewBox="0 0 24 24" width="22" height="22"><rect width="24" height="24" rx="6" fill="#FFFC00"/><path fill="#111" d="M12 4.2c2.3 0 3.7 1.7 3.7 4.1 0 .7-.1 1.4.3 1.9.3.4.9.4 1.3.6.4.2.6.5.4.8-.2.4-.7.3-1.1.4-.5.1-.8.4-.8.8 0 .6.7 1.1 1.3 1.5.7.4 1.4.9 1.4 1.6 0 .7-.7.9-1.3.9-.5 0-.8-.2-1.2-.2-.6 0-1 .4-1.9.4s-1.3-.4-1.9-.4c-.4 0-.7.2-1.2.2-.6 0-1.3-.2-1.3-.9 0-.7.7-1.2 1.4-1.6.6-.4 1.3-.9 1.3-1.5 0-.4-.3-.7-.8-.8-.4-.1-.9 0-1.1-.4-.2-.3 0-.6.4-.8.4-.2 1-.2 1.3-.6.4-.5.3-1.2.3-1.9 0-2.4 1.4-4.1 3.7-4.1z"/></svg>`,
  email: `<svg viewBox="0 0 24 24" width="22" height="22"><rect width="24" height="24" rx="6" fill="#ea4335"/><path fill="#fff" d="M5 7.5h14v9H5v-9zm7 5.1L6.7 8.8h10.6L12 12.6zm0 1.3 5.5-4v6.6H6.5V9.9l5.5 4z"/></svg>`,
  sms: `<svg viewBox="0 0 24 24" width="22" height="22"><rect width="24" height="24" rx="6" fill="#34c759"/><path fill="#fff" d="M6 7h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H9l-3 2.2V8a1 1 0 0 1 1-1zm2 3v1.5h8V10H8zm0 3v1.5h5V13H8z"/></svg>`
};

export function socialBtn(make, t) {
  const a = make("a", { className: "share-btn", href: t.url, target: "_blank", rel: "noopener" });
  const ico = make("span", { className: "sico" });
  ico.innerHTML = SOCIAL_SVG[t.key] || "";
  a.appendChild(ico);
  a.appendChild(make("span", {}, t.label));
  return a;
}

export async function mountDemoPanel(H, formWrap) {
  const { make, apiTry, setSession, afterSignIn, cacheUserFromServer, closeModal, updateUIForSession } = H;
  const box = make("div", { className: "demo-panel" });
  box.appendChild(make("div", { className: "help-kicker" }, "Sample family"));
  const list = make("div", { className: "demo-grid" });
  box.appendChild(list);
  const hint = make("div", { className: "small-muted", style: "margin-top:4px" }, "demo123 · OTP 000000");
  box.appendChild(hint);
  formWrap.appendChild(box);
  const j = await apiTry("/api/demo/accounts");
  if (!j || !j.accounts) {
    hint.textContent = "Demo seed loading… restart the server if this stays empty.";
    return;
  }
  j.accounts.forEach((a) => {
    const b = make("button", { className: "demo-user", type: "button" });
    const role = (a.families && a.families[0] && a.families[0].label) || "Member";
    b.appendChild(make("div", { style: "font-weight:700" }, a.name));
    b.appendChild(make("div", { className: "small-muted" }, role));
    b.onclick = async () => {
      const r = await apiTry("/api/demo/login", { method: "POST", body: { id: a.id } });
      if (!r || !r.user) return uiNotice("Demo login failed");
      cacheUserFromServer(r.user);
      setSession({ userId: r.user.id, sessionToken: r.sessionToken });
      if (typeof afterSignIn === "function") afterSignIn();
      else { closeModal(); updateUIForSession(); }
    };
    list.appendChild(b);
  });
}

export async function renderCommunityFeed(H, opts) {
  if (!H.currentSession()) return uiNotice("Sign in first");
  if (typeof H.openFeedPanel === "function") {
    return H.openFeedPanel(opts || {});
  }
  const root = document.getElementById("feed-root");
  if (root) {
    const panel = document.getElementById("feed-panel");
    document.body.classList.add("feed-open");
    if (panel) {
      panel.classList.add("open");
      panel.setAttribute("aria-hidden", "false");
    }
    await mountCommunityFeed(H, root, opts || {});
    return;
  }
  const wrap = H.make("div", { className: "feed-app" });
  H.showModal(wrap, { variant: "feed" });
  const modal = document.querySelector(".modal");
  if (modal) modal.classList.add("feed-shell");
  await mountCommunityFeed(H, wrap, opts || {});
}

export async function renderFamilyAdmin(H, familyId) {
  const { make, api, apiTry, showModal, closeModal, openShareModal, renderFamilyChat } = H;
  const j = await apiTry("/api/families/" + encodeURIComponent(familyId) + "/admin");
  if (!j) return uiNotice("Could not load family settings");
  const wrap = make("div", { className: "admin-app" });
  wrap.appendChild(make("div", { className: "help-kicker" }, "Advanced · privileges"));
  wrap.appendChild(make("h3", {}, j.family.name));
  wrap.appendChild(make("div", { className: "small-muted" }, "Your role: " + ((j.family.roleDefs[j.myRole] && j.family.roleDefs[j.myRole].label) || j.myRole)));

  if (j.can.editFamily) {
    const name = make("input", { className: "input", value: j.family.name });
    const priv = make("select", { className: "input" });
    priv.appendChild(make("option", { value: "private" }, "Private"));
    priv.appendChild(make("option", { value: "public" }, "Public"));
    priv.value = j.family.privacy || "private";
    const save = make("button", { className: "btn small", type: "button" }, "Save settings");
    save.onclick = async () => {
      try {
        await api("/api/families/" + familyId, { method: "PATCH", body: { name: name.value, privacy: priv.value } });
        uiNotice("Saved");
      } catch (e) { uiNotice(e.message); }
    };
    wrap.appendChild(make("h4", {}, "Family settings"));
    wrap.append(name, priv, make("div", { className: "row", style: "margin:8px 0" }, save));
  }

  wrap.appendChild(make("h4", {}, "Members & roles"));
  const table = make("div", { className: "role-table" });
  const roleKeys = Object.keys(j.family.roleDefs || {});
  j.members.forEach((m) => {
    const row = make("div", { className: "role-row" });
    row.appendChild(make("div", { style: "flex:1;min-width:0" }, make("div", { style: "font-weight:700" }, m.name), make("div", { className: "small-muted" }, m.roleLabel)));
    if (j.can.manageRoles || j.can.manageMembers) {
      const sel = make("select", { className: "input", style: "width:auto;min-width:140px" });
      roleKeys.forEach((k) => {
        if (k === "owner") return;
        sel.appendChild(make("option", { value: k }, (j.family.roleDefs[k] && j.family.roleDefs[k].label) || k));
      });
      sel.value = m.role === "owner" ? "admin" : m.role;
      sel.disabled = m.role === "owner";
      sel.onchange = async () => {
        try {
          await api("/api/families/" + familyId + "/roles", { method: "PUT", body: { userId: m.id, role: sel.value } });
        } catch (e) { uiNotice(e.message); sel.value = m.role; }
      };
      row.appendChild(sel);
    }
    if (j.can.kick && m.role !== "owner") {
      const kick = make("button", { className: "btn small secondary", type: "button" }, "Remove");
      kick.onclick = async () => {
        if (!(await uiAsk("Remove " + m.name + "?"))) return;
        await apiTry("/api/families/" + familyId + "/kick", { method: "POST", body: { userId: m.id } });
        closeModal();
        renderFamilyAdmin(H, familyId);
      };
      row.appendChild(kick);
    }
    table.appendChild(row);
  });
  wrap.appendChild(table);

  if (j.requests && j.requests.length) {
    wrap.appendChild(make("h4", {}, "Join requests"));
    j.requests.forEach((r) => {
      const row = make("div", { className: "role-row" });
      row.appendChild(make("div", { style: "flex:1" }, r.name || r.userId));
      if (j.can.manageMembers) {
        const ok = make("button", { className: "btn small", type: "button" }, "Accept");
        const no = make("button", { className: "btn small secondary", type: "button" }, "Decline");
        ok.onclick = async () => {
          await apiTry(`/api/families/${familyId}/requests/${r.id}/accept`, { method: "POST", body: {} });
          closeModal(); renderFamilyAdmin(H, familyId);
        };
        no.onclick = async () => {
          await apiTry(`/api/families/${familyId}/requests/${r.id}/decline`, { method: "POST", body: {} });
          closeModal(); renderFamilyAdmin(H, familyId);
        };
        row.append(ok, no);
      }
      wrap.appendChild(row);
    });
  }

  if (j.can.manageRoles) {
    wrap.appendChild(make("h4", {}, "Create a role"));
    const key = make("input", { className: "input", placeholder: "key (e.g. captain)" });
    const label = make("input", { className: "input", placeholder: "Label (e.g. Captain)" });
    const privs = ["invite", "kick", "manageMembers", "manageRoles", "editFamily", "moderateFeed", "viewLocation", "viewHistory"];
    const checks = make("div", { className: "priv-grid" });
    const state = {};
    privs.forEach((p) => {
      const lab = make("label", { className: "priv-item" });
      const cb = make("input", { type: "checkbox" });
      cb.onchange = () => { state[p] = cb.checked; };
      lab.append(cb, document.createTextNode(" " + p));
      checks.appendChild(lab);
    });
    const add = make("button", { className: "btn small", type: "button" }, "Add role");
    add.onclick = async () => {
      try {
        await api("/api/families/" + familyId + "/role-defs", { method: "POST", body: { key: key.value, label: label.value, privileges: state } });
        closeModal(); renderFamilyAdmin(H, familyId);
      } catch (e) { uiNotice(e.message); }
    };
    wrap.append(key, label, checks, make("div", { className: "row", style: "margin-top:8px" }, add));
  }

  const foot = make("div", { className: "row", style: "margin-top:14px;flex-wrap:wrap" });
  const chat = make("button", { className: "btn small", type: "button" }, "Family chat");
  chat.onclick = () => { closeModal(); if (renderFamilyChat) renderFamilyChat(familyId); };
  const share = make("button", { className: "btn small secondary", type: "button" }, "Invite / QR");
  share.onclick = () => { if (openShareModal) openShareModal(j.family); };
  foot.append(chat, share);
  wrap.appendChild(foot);
  showModal(wrap);
}

export function ctxFrom(g) { return g; }
