"use strict";

const DEFAULT_ROLE_DEFS = {
  owner: {
    label: "Head of Family",
    privileges: {
      manageRoles: true, manageMembers: true, editFamily: true, invite: true,
      kick: true, moderateFeed: true, viewLocation: true, viewHistory: true,
      deleteFamily: true, transfer: true
    }
  },
  admin: {
    label: "Admin",
    privileges: {
      manageRoles: false, manageMembers: true, editFamily: true, invite: true,
      kick: true, moderateFeed: true, viewLocation: true, viewHistory: true,
      deleteFamily: false, transfer: false
    }
  },
  consigliere: {
    label: "Consigliere",
    privileges: {
      manageRoles: true, manageMembers: true, editFamily: false, invite: true,
      kick: false, moderateFeed: true, viewLocation: true, viewHistory: true,
      deleteFamily: false, transfer: false
    }
  },
  member: {
    label: "Member",
    privileges: {
      manageRoles: false, manageMembers: false, editFamily: false, invite: true,
      kick: false, moderateFeed: false, viewLocation: true, viewHistory: true,
      deleteFamily: false, transfer: false
    }
  },
  guest: {
    label: "Guest",
    privileges: {
      manageRoles: false, manageMembers: false, editFamily: false, invite: false,
      kick: false, moderateFeed: false, viewLocation: false, viewHistory: false,
      deleteFamily: false, transfer: false
    }
  }
};

function cloneDefs() {
  return JSON.parse(JSON.stringify(DEFAULT_ROLE_DEFS));
}

function ensureFamilyRoles(f) {
  if (!f.roles) f.roles = {};
  if (!f.roleDefs) f.roleDefs = cloneDefs();
  Object.keys(DEFAULT_ROLE_DEFS).forEach((k) => {
    if (!f.roleDefs[k]) f.roleDefs[k] = JSON.parse(JSON.stringify(DEFAULT_ROLE_DEFS[k]));
  });
  if (f.ownerId) f.roles[f.ownerId] = "owner";
  (f.members || []).forEach((id) => {
    if (!f.roles[id]) f.roles[id] = id === f.ownerId ? "owner" : "member";
  });
  return f;
}

function roleOf(f, userId) {
  if (!f || !userId) return "guest";
  if (f.ownerId === userId) return "owner";
  return (f.roles && f.roles[userId]) || ((f.members || []).includes(userId) ? "member" : "guest");
}

function can(f, userId, priv) {
  if (!f || !userId) return false;
  const r = roleOf(f, userId);
  if (r === "owner") return true;
  const defs = (f.roleDefs && f.roleDefs[r]) || DEFAULT_ROLE_DEFS[r] || DEFAULT_ROLE_DEFS.member;
  return !!(defs.privileges && defs.privileges[priv]);
}

const PRIV_HELP = {
  viewLocation: "See your live map pin while Track is On (your Privacy switches still apply)",
  viewHistory: "Open your location history / trail",
  invite: "Invite people into this family",
  manageMembers: "Accept or decline join requests",
  kick: "Remove members",
  editFamily: "Rename the family, change privacy or password",
  manageRoles: "Create roles and assign privileges",
  moderateFeed: "Remove family-only feed posts",
  deleteFamily: "Delete the family",
  transfer: "Pass Head of Family to someone else"
};

function briefing(f, userId, opts) {
  opts = opts || {};
  ensureFamilyRoles(f);
  const role = opts.asRole || roleOf(f, userId);
  const defs = f.roleDefs || DEFAULT_ROLE_DEFS;
  const my = defs[role] || DEFAULT_ROLE_DEFS.member;
  const priv = my.privileges || {};
  const roles = Object.keys(defs).map((k) => ({
    key: k,
    label: (defs[k] && defs[k].label) || k,
    privileges: (defs[k] && defs[k].privileges) || {}
  }));
  const youCan = Object.keys(PRIV_HELP).filter((p) => priv[p]).map((p) => PRIV_HELP[p]);
  const theyCan = [];
  theyCan.push(priv.viewLocation
    ? "Members with viewLocation can see your pin while Track is On — unless you turn Track Off or hide your pin in Privacy."
    : "Your pin is hidden from this family until a Head promotes you off Guest.");
  theyCan.push("Direct and family chats stay end-to-end encrypted (AES-GCM) on this device.");
  theyCan.push("Search, marketplace, and people who are not in this family never receive your GPS.");
  return {
    familyId: f.id,
    familyName: f.name,
    privacy: f.privacy,
    role,
    roleLabel: my.label || role,
    privileges: priv,
    roles,
    youCan,
    theyCan,
    privilegeHelp: PRIV_HELP,
    note: "Only the Head of Family makes admin-style changes. You can leave anytime. Blocked people cannot DM you even if you share a family."
  };
}

function attach(ctx) {
  const {
    app, DB, saveData, auth, makeId, now, getUser, publicUser, publicFamily,
    sharesFamily, hashPassword, createSession, sendToUser, broadcastToFamilyOf, DEMO
  } = ctx;
  const DEMO_PASSWORD = String(ctx.DEMO_PASSWORD || process.env.DEMO_PASSWORD || "demo123");

  function walkTrail(lat, lng, ts, n) {
    const out = [];
    let a = lat, b = lng;
    for (let i = n - 1; i >= 0; i--) {
      a += Math.sin(i * 0.47) * 0.0018;
      b += Math.cos(i * 0.31) * 0.0022;
      out.push({ lat: a, lng: b, ts: ts - i * 60 * 1000, type: "minute" });
    }
    if (out.length) {
      out[out.length - 1].lat = lat;
      out[out.length - 1].lng = lng;
      out[out.length - 1].ts = ts;
    }
    return out;
  }

  function seedDemoTrails() {
    if (DB.settings && DB.settings.demoTrailsSeeded) return;
    let changed = false;
    const ts = now();
    (DB.users || []).forEach((u) => {
      if (!u || !u.demo || !u.lastLocation) return;
      const hist = u.locationHistory || [];
      if (hist.length >= 12) return;
      u.locationHistory = walkTrail(u.lastLocation.lat, u.lastLocation.lng, u.lastLocation.ts || ts, 24);
      changed = true;
    });
    DB.settings = DB.settings || {};
    DB.settings.demoTrailsSeeded = true;
    if (changed) saveData();
  }

  function seedPendingDemoRequest() {
    DB.joinRequests = DB.joinRequests || [];
    const f = DB.families.find((x) => x.id === "f_demo_corleone");
    if (!f) return;
    if ((f.members || []).includes("u_demo_carlo")) return;
    const hit = DB.joinRequests.find((r) => r.familyId === "f_demo_corleone" && r.userId === "u_demo_carlo" && r.status === "pending");
    if (hit) return;
    DB.joinRequests.push({
      id: makeId("jr"),
      familyId: "f_demo_corleone",
      userId: "u_demo_carlo",
      status: "pending",
      kind: "join",
      createdAt: now() - 180000
    });
    saveData();
  }

  function seedDemoAvatars() {
    const map = {
      u_demo_vito: "/avatars/av-01.png",
      u_demo_sonny: "/avatars/av-02.png",
      u_demo_fredo: "/avatars/av-03.png",
      u_demo_michael: "/avatars/av-04.png",
      u_demo_connie: "/avatars/av-05.png",
      u_demo_tom: "/avatars/av-06.png",
      u_demo_kay: "/avatars/av-07.png",
      u_demo_clemenza: "/avatars/av-08.png",
      u_demo_tessio: "/avatars/av-09.png",
      u_demo_carlo: "/avatars/av-10.png"
    };
    let changed = false;
    Object.keys(map).forEach((id) => {
      const u = getUser(id);
      if (!u) return;
      if (u.profileImage && String(u.profileImage).startsWith("/avatars/")) return;
      u.profileImage = map[id];
      u.avatarId = map[id].replace(/^\/avatars\//, "").replace(/\.[^.]+$/, "");
      changed = true;
    });
    if (changed) saveData();
  }

  function seedIfNeeded() {
    if (DB.settings && DB.settings.demoSeeded) {
      DB.families.forEach(ensureFamilyRoles);
      seedDemoTrails();
      seedPendingDemoRequest();
      seedDemoAvatars();
      return;
    }
    const pw = hashPassword(DEMO_PASSWORD);
    const ts = now();
    const users = [
      { id: "u_demo_vito", name: "Don Vito", email: "vito@familia.test", phone: "5551112222", city: "Denver HQ", lat: 39.7392, lng: -104.9903 },
      { id: "u_demo_sonny", name: "Sonny Corleone", email: "sonny@familia.test", phone: "5553334444", city: "RiNo", lat: 39.758, lng: -104.978 },
      { id: "u_demo_fredo", name: "Fredo Corleone", email: "fredo@familia.test", phone: "5556667777", city: "Lakewood", lat: 39.704, lng: -105.081 },
      { id: "u_demo_michael", name: "Michael Corleone", email: "michael@familia.test", phone: "5552223333", city: "Cherry Creek", lat: 39.717, lng: -104.950 },
      { id: "u_demo_connie", name: "Connie Corleone", email: "connie@familia.test", phone: "5558889999", city: "Capitol Hill", lat: 39.734, lng: -104.977 },
      { id: "u_demo_tom", name: "Tom Hagen", email: "tom@familia.test", phone: "5554445555", city: "LoDo", lat: 39.753, lng: -104.995 },
      { id: "u_demo_kay", name: "Kay Adams", email: "kay@familia.test", phone: "5557770000", city: "Boulder", lat: 40.015, lng: -105.271 },
      { id: "u_demo_clemenza", name: "Peter Clemenza", email: "clemenza@familia.test", phone: "5551212000", city: "Aurora", lat: 39.729, lng: -104.832 },
      { id: "u_demo_tessio", name: "Sal Tessio", email: "tessio@familia.test", phone: "5553434000", city: "Englewood", lat: 39.648, lng: -104.988 },
      { id: "u_demo_carlo", name: "Carlo Rizzi", email: "carlo@familia.test", phone: "5555656000", city: "Highlands", lat: 39.762, lng: -105.011 }
    ];
    users.forEach((u) => {
      if (DB.users.find((x) => x.id === u.id || (x.email && x.email.toLowerCase() === u.email))) return;
      DB.users.push({
        id: u.id,
        name: u.name,
        email: u.email,
        phone: u.phone,
        password: pw,
        demo: true,
        createdAt: ts,
        lastLocation: { lat: u.lat, lng: u.lng, ts },
        locationHistory: walkTrail(u.lat, u.lng, ts, 24)
      });
    });

    const corleone = {
      id: "f_demo_corleone",
      name: "Corleone",
      password: "",
      privacy: "private",
      members: ["u_demo_vito", "u_demo_sonny", "u_demo_fredo", "u_demo_michael", "u_demo_connie", "u_demo_tom", "u_demo_kay", "u_demo_clemenza"],
      invites: [Buffer.from(JSON.stringify({ fid: "f_demo_corleone", ts })).toString("base64")],
      ownerId: "u_demo_vito",
      createdAt: ts,
      roles: {
        u_demo_vito: "owner",
        u_demo_sonny: "admin",
        u_demo_michael: "admin",
        u_demo_tom: "consigliere",
        u_demo_fredo: "member",
        u_demo_connie: "member",
        u_demo_clemenza: "member",
        u_demo_kay: "guest"
      },
      roleDefs: cloneDefs()
    };
    const tessioCrew = {
      id: "f_demo_tessio",
      name: "Tessio Crew",
      password: "",
      privacy: "public",
      members: ["u_demo_tessio", "u_demo_carlo", "u_demo_fredo"],
      invites: [Buffer.from(JSON.stringify({ fid: "f_demo_tessio", ts })).toString("base64")],
      ownerId: "u_demo_tessio",
      createdAt: ts,
      roles: { u_demo_tessio: "owner", u_demo_carlo: "admin", u_demo_fredo: "member" },
      roleDefs: cloneDefs()
    };
    if (!DB.families.find((f) => f.id === corleone.id)) DB.families.push(corleone);
    if (!DB.families.find((f) => f.id === tessioCrew.id)) DB.families.push(tessioCrew);
    DB.families.forEach(ensureFamilyRoles);

    const convos = [
      ["u_demo_vito", "u_demo_sonny", "Sonny — keep the peace tonight. No fireworks."],
      ["u_demo_sonny", "u_demo_vito", "Understood, Pop. I'll ride with Clemenza."],
      ["u_demo_michael", "u_demo_vito", "I'm in Denver. Map is live."],
      ["u_demo_vito", "u_demo_michael", "Good. Family first."],
      ["u_demo_connie", "u_demo_kay", "Kay, you're on the guest list. Location stays private until Vito promotes you."],
      ["u_demo_tom", "u_demo_vito", "Consigliere note: Tessio Crew is public if you want Fredo watched."]
    ];
    convos.forEach(([from, to, text], i) => {
      DB.messages.push({
        id: makeId("m"),
        from, to, text, ts: ts - (convos.length - i) * 60000, readAt: null, kind: "chat", demo: true
      });
    });
    DB.messages.push({
      id: makeId("m"),
      from: "u_demo_vito",
      to: null,
      familyId: "f_demo_corleone",
      text: "Family room is open. Business stays in this chat.",
      ts: ts - 120000,
      kind: "chat",
      demo: true
    });

    DB.posts = DB.posts || [];
    const seedPosts = [
      { authorId: "u_demo_vito", audience: "public", text: "The family that maps together stays together. Welcome to GPS-FAMILIA." },
      { authorId: "u_demo_sonny", audience: "family", familyId: "f_demo_corleone", text: "Corleone only: dinner at the compound Friday. Don't be late." },
      { authorId: "u_demo_michael", audience: "public", text: "Cherry Creek is quiet tonight. Tracking on." },
      { authorId: "u_demo_tessio", audience: "public", text: "Tessio Crew is taking new members. Public family — search Tessio." },
      { authorId: "u_demo_connie", audience: "family", familyId: "f_demo_corleone", text: "Someone tell Fredo the guest Wi-Fi password is not the family password." },
      { authorId: "u_demo_tom", audience: "public", text: "Legal reminder: location sharing is consent-only. Guests don't appear on the map." }
    ];
    seedPosts.forEach((p, i) => {
      DB.posts.push({
        id: makeId("p"),
        authorId: p.authorId,
        text: p.text,
        audience: p.audience,
        familyId: p.familyId || null,
        createdAt: ts - (seedPosts.length - i) * 3600000,
        likes: i % 2 === 0 ? ["u_demo_sonny", "u_demo_connie"] : ["u_demo_michael"],
        comments: i === 0 ? [
          { id: makeId("c"), userId: "u_demo_michael", text: "Heard.", ts: ts - 3000000 }
        ] : [],
        shares: i === 3 ? 2 : 0
      });
    });

    const pendingCarlo = (DB.joinRequests || []).find((r) => r.familyId === "f_demo_corleone" && r.userId === "u_demo_carlo");
    if (!pendingCarlo) {
      DB.joinRequests = DB.joinRequests || [];
      DB.joinRequests.push({
        id: makeId("jr"),
        familyId: "f_demo_corleone",
        userId: "u_demo_carlo",
        status: "pending",
        kind: "join",
        createdAt: ts - 180000
      });
    }

    seedDemoAvatars();
    DB.settings.demoSeeded = true;
    DB.settings.demoTrailsSeeded = true;
    saveData();
    console.log("Demo family seeded. Login: vito@familia.test / demo123  (or tap a demo account)");
  }

  seedIfNeeded();

  app.get("/api/demo/accounts", (req, res) => {
    const list = DB.users.filter((u) => u.demo).map((u) => {
      const fams = DB.families.filter((f) => (f.members || []).includes(u.id)).map((f) => ({
        name: f.name,
        role: roleOf(f, u.id),
        label: (f.roleDefs && f.roleDefs[roleOf(f, u.id)] && f.roleDefs[roleOf(f, u.id)].label) || roleOf(f, u.id)
      }));
      return { id: u.id, name: u.name, email: u.email, phone: u.phone, families: fams };
    });
    const payload = { ok: true, demo: !!DEMO, accounts: list };
    if (DEMO) payload.otpHint = "000000";
    res.json(payload);
  });

  app.post("/api/demo/login", (req, res) => {
    if (!DEMO) return res.status(403).json({ error: "demo mode off" });
    const { id, email } = req.body || {};
    const u = DB.users.find((x) => (id && x.id === id) || (email && x.email && x.email.toLowerCase() === String(email).toLowerCase()));
    if (!u) return res.status(404).json({ error: "demo user not found" });
    const sessionToken = createSession(u.id);
    res.json({ ok: true, sessionToken, user: publicUser(u, u.id, { includeProfile: true, includeHistory: true }), demo: true });
  });

  app.post("/api/auth/demo-google", (req, res) => {
    if (!DEMO) return res.status(403).json({ error: "demo mode off" });
    let u = DB.users.find((x) => x.id === "u_demo_google");
    if (!u) {
      u = {
        id: "u_demo_google",
        name: "Google Demo",
        email: "google-demo@familia.test",
        phone: "",
        password: "",
        googleSub: "demo",
        demo: true,
        createdAt: now(),
        locationHistory: []
      };
      DB.users.push(u);
      saveData();
    }
    const sessionToken = createSession(u.id);
    res.json({ ok: true, sessionToken, user: publicUser(u, u.id, { includeProfile: true }), demo: true });
  });

  app.get("/api/families/:id/briefing", auth, (req, res) => {
    const f = DB.families.find((x) => x.id === req.params.id);
    if (!f) return res.status(404).json({ error: "family not found" });
    if (!(f.members || []).includes(req.userId)) return res.status(403).json({ error: "not a member" });
    res.json({ ok: true, briefing: briefing(f, req.userId) });
  });

  app.get("/api/families/:id/admin", auth, (req, res) => {
    const f = DB.families.find((x) => x.id === req.params.id);
    if (!f) return res.status(404).json({ error: "family not found" });
    if (!(f.members || []).includes(req.userId)) return res.status(403).json({ error: "not a member" });
    ensureFamilyRoles(f);
    const members = (f.members || []).map((id) => {
      const u = getUser(id);
      const r = roleOf(f, id);
      return {
        id,
        name: u ? u.name : "User",
        email: u ? u.email : "",
        phone: u ? u.phone : "",
        role: r,
        roleLabel: (f.roleDefs[r] && f.roleDefs[r].label) || r,
        online: false
      };
    });
    const requests = DB.joinRequests.filter((r) => r.familyId === f.id && r.status === "pending").map((r) => {
      const u = getUser(r.userId);
      return { ...r, name: u ? u.name : "User" };
    });
    res.json({
      ok: true,
      family: {
        id: f.id, name: f.name, privacy: f.privacy, ownerId: f.ownerId,
        roles: f.roles, roleDefs: f.roleDefs, members: f.members,
        invites: f.invites || []
      },
      members,
      requests,
      myRole: roleOf(f, req.userId),
      myPrivileges: (f.roleDefs[roleOf(f, req.userId)] || DEFAULT_ROLE_DEFS.member).privileges,
      can: {
        manageRoles: can(f, req.userId, "manageRoles"),
        manageMembers: can(f, req.userId, "manageMembers"),
        editFamily: can(f, req.userId, "editFamily"),
        invite: can(f, req.userId, "invite"),
        kick: can(f, req.userId, "kick")
      }
    });
  });

  app.patch("/api/families/:id", auth, (req, res) => {
    const f = DB.families.find((x) => x.id === req.params.id);
    if (!f) return res.status(404).json({ error: "family not found" });
    if (!can(f, req.userId, "editFamily")) return res.status(403).json({ error: "only Head / Admin can edit family settings" });
    const { name, privacy, password } = req.body || {};
    if (name) f.name = String(name).trim();
    if (privacy === "public" || privacy === "private") f.privacy = privacy;
    if (password !== undefined) f.password = password ? hashPassword(password) : "";
    saveData();
    res.json({ ok: true, family: typeof publicFamily === "function" ? publicFamily(f) : f });
  });

  app.put("/api/families/:id/roles", auth, (req, res) => {
    const f = DB.families.find((x) => x.id === req.params.id);
    if (!f) return res.status(404).json({ error: "family not found" });
    ensureFamilyRoles(f);
    if (!can(f, req.userId, "manageRoles") && !can(f, req.userId, "manageMembers")) {
      return res.status(403).json({ error: "you cannot assign roles" });
    }
    const { userId, role } = req.body || {};
    if (!userId || !role) return res.status(400).json({ error: "userId & role required" });
    if (!(f.members || []).includes(userId)) return res.status(400).json({ error: "not a member" });
    if (userId === f.ownerId) return res.status(400).json({ error: "cannot demote the Head of Family — transfer first" });
    if (role === "owner") return res.status(400).json({ error: "use transfer to make a new Head" });
    if (!f.roleDefs[role]) return res.status(400).json({ error: "unknown role" });
    if (role === "admin" && roleOf(f, req.userId) !== "owner" && !can(f, req.userId, "manageRoles")) {
      return res.status(403).json({ error: "only the Head can appoint Admins" });
    }
    f.roles[userId] = role;
    saveData();
    sendToUser(userId, { type: "family", action: "role", familyId: f.id, role });
    res.json({ ok: true, roles: f.roles });
  });

  app.post("/api/families/:id/role-defs", auth, (req, res) => {
    const f = DB.families.find((x) => x.id === req.params.id);
    if (!f) return res.status(404).json({ error: "family not found" });
    if (!can(f, req.userId, "manageRoles")) return res.status(403).json({ error: "only Head / Consigliere can create roles" });
    const { key, label, privileges } = req.body || {};
    const id = String(key || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "") || makeId("role");
    if (id === "owner") return res.status(400).json({ error: "cannot replace owner" });
    f.roleDefs = f.roleDefs || cloneDefs();
    f.roleDefs[id] = {
      label: String(label || id),
      privileges: Object.assign({}, DEFAULT_ROLE_DEFS.member.privileges, privileges || {})
    };
    saveData();
    res.json({ ok: true, roleDefs: f.roleDefs });
  });

  app.put("/api/families/:id/role-defs/:key", auth, (req, res) => {
    const f = DB.families.find((x) => x.id === req.params.id);
    if (!f) return res.status(404).json({ error: "family not found" });
    if (!can(f, req.userId, "manageRoles")) return res.status(403).json({ error: "only Head / Consigliere can edit roles" });
    const key = req.params.key;
    if (key === "owner") return res.status(400).json({ error: "Head privileges are locked" });
    if (!f.roleDefs[key]) return res.status(404).json({ error: "role not found" });
    if (req.body.label) f.roleDefs[key].label = String(req.body.label);
    if (req.body.privileges) f.roleDefs[key].privileges = Object.assign({}, f.roleDefs[key].privileges, req.body.privileges);
    saveData();
    res.json({ ok: true, roleDefs: f.roleDefs });
  });

  app.post("/api/families/:id/kick", auth, (req, res) => {
    const f = DB.families.find((x) => x.id === req.params.id);
    if (!f) return res.status(404).json({ error: "family not found" });
    if (!can(f, req.userId, "kick") && !can(f, req.userId, "manageMembers")) {
      return res.status(403).json({ error: "you cannot remove members" });
    }
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: "userId required" });
    if (userId === f.ownerId) return res.status(400).json({ error: "cannot kick the Head" });
    f.members = (f.members || []).filter((id) => id !== userId);
    if (f.roles) delete f.roles[userId];
    saveData();
    sendToUser(userId, { type: "family", action: "kicked", familyId: f.id });
    res.json({ ok: true });
  });

  app.post("/api/families/:id/transfer", auth, (req, res) => {
    const f = DB.families.find((x) => x.id === req.params.id);
    if (!f) return res.status(404).json({ error: "family not found" });
    if (f.ownerId !== req.userId) return res.status(403).json({ error: "only the Head of Family can transfer" });
    const { userId } = req.body || {};
    if (!userId || !(f.members || []).includes(userId)) return res.status(400).json({ error: "member required" });
    f.roles = f.roles || {};
    f.roles[req.userId] = "admin";
    f.ownerId = userId;
    f.roles[userId] = "owner";
    saveData();
    broadcastToFamilyOf(userId, { type: "family", action: "transfer", familyId: f.id, ownerId: userId });
    res.json({ ok: true, family: typeof publicFamily === "function" ? publicFamily(f) : f });
  });

  function canSeePost(post, viewerId) {
    if (!post) return false;
    if (post.audience === "public") return true;
    if (post.authorId === viewerId) return true;
    if (post.familyId) {
      const f = DB.families.find((x) => x.id === post.familyId);
      return !!(f && (f.members || []).includes(viewerId));
    }
    if (post.audience === "family" || post.audience === "families") {
      return sharesFamily(post.authorId, viewerId);
    }
    return false;
  }

  function sanitizeMediaUrl(u, kind) {
    const s = String(u || "");
    if (/^\/uploads\/[A-Za-z0-9._-]+$/.test(s)) return s;
    if (kind !== "video" && s.startsWith("data:image/") && s.length < 900000) return s;
    return "";
  }

  function normalizeMedia(post) {
    const media = [];
    const seen = new Set();
    const push = (kind, url) => {
      const k = kind === "video" ? "video" : "image";
      const u = sanitizeMediaUrl(url, k);
      if (!u || seen.has(u)) return;
      seen.add(u);
      media.push({ kind: k, url: u });
    };
    if (Array.isArray(post.media)) {
      post.media.forEach((m) => { if (m) push(m.kind, m.url); });
    }
    if (post.image) push("image", post.image);
    if (post.video) push("video", post.video);
    return media.slice(0, 4);
  }

  function serializePost(post, viewerId) {
    const u = getUser(post.authorId);
    const fam = post.familyId ? DB.families.find((x) => x.id === post.familyId) : null;
    const media = normalizeMedia(post);
    const firstImg = media.find((m) => m.kind === "image");
    const firstVid = media.find((m) => m.kind === "video");
    let canDelete = post.authorId === viewerId;
    if (!canDelete && post.familyId && fam) canDelete = can(fam, viewerId, "moderateFeed");
    return {
      id: post.id,
      authorId: post.authorId,
      authorName: u ? u.name : "User",
      authorAvatar: (u && u.profileImage && (String(u.profileImage).startsWith("/avatars/") || String(u.profileImage).startsWith("/uploads/"))) ? u.profileImage : "",
      text: post.text || "",
      image: (firstImg && firstImg.url) || "",
      video: (firstVid && firstVid.url) || "",
      media,
      audience: post.audience,
      familyId: post.familyId || null,
      familyName: (fam && fam.name) || "",
      createdAt: post.createdAt || post.ts,
      ts: post.createdAt || post.ts,
      likes: (post.likes || []).length,
      liked: (post.likes || []).includes(viewerId),
      comments: (post.comments || []).map((c) => {
        const cu = getUser(c.userId || c.authorId);
        return {
          id: c.id,
          userId: c.userId || c.authorId,
          authorId: c.userId || c.authorId,
          name: cu ? cu.name : "User",
          text: c.text,
          ts: c.ts
        };
      }),
      shares: post.shares || 0,
      sharedFrom: post.sharedFrom || null,
      canDelete
    };
  }

  function emitFeed(action, post) {
    const ids = typeof ctx.onlineUserIds === "function" ? ctx.onlineUserIds() : [];
    const payloadBase = { type: "feed", action, id: post && post.id };
    if (action === "delete") {
      ids.forEach((uid) => sendToUser(uid, payloadBase));
      return;
    }
    ids.forEach((uid) => {
      if (!canSeePost(post, uid)) return;
      sendToUser(uid, Object.assign({}, payloadBase, { post: serializePost(post, uid) }));
    });
  }

  app.get("/api/feed", auth, (req, res) => {
    const q = String(req.query.q || "").trim().toLowerCase();
    const filter = String(req.query.filter || "all");
    const limit = Math.min(80, Math.max(8, Number(req.query.limit || 40)));
    const offset = Math.max(0, Number(req.query.offset || 0));
    DB.posts = DB.posts || [];
    let list = DB.posts.filter((p) => canSeePost(p, req.userId));
    if (filter === "public") list = list.filter((p) => p.audience === "public");
    if (filter === "family") list = list.filter((p) => p.audience !== "public");
    if (filter === "mine") list = list.filter((p) => p.authorId === req.userId);
    if (filter === "photos") list = list.filter((p) => normalizeMedia(p).some((m) => m.kind === "image"));
    if (filter === "videos") list = list.filter((p) => normalizeMedia(p).some((m) => m.kind === "video"));
    if (q) {
      list = list.filter((p) => {
        const u = getUser(p.authorId);
        const blob = `${p.text || ""} ${u ? u.name : ""}`.toLowerCase();
        return blob.includes(q);
      });
    }
    list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const total = list.length;
    res.json({
      ok: true,
      total,
      offset,
      posts: list.slice(offset, offset + limit).map((p) => serializePost(p, req.userId)),
      more: offset + limit < total
    });
  });

  app.get("/api/people/hub", auth, (req, res) => {
    DB.joinRequests = DB.joinRequests || [];
    const incomingJoins = [];
    const incomingInvites = [];
    const outgoing = [];
    DB.joinRequests.filter((r) => r.status === "pending").forEach((r) => {
      const f = DB.families.find((x) => x.id === r.familyId);
      const u = getUser(r.userId);
      const from = r.fromId ? getUser(r.fromId) : null;
      const pack = {
        id: r.id,
        kind: r.kind === "invite" ? "invite" : "join",
        familyId: r.familyId,
        familyName: f ? f.name : "Family",
        userId: r.userId,
        name: u ? u.name : "User",
        fromId: r.fromId || null,
        fromName: from ? from.name : "",
        createdAt: r.createdAt
      };
      if (pack.kind === "invite" && r.userId === req.userId) incomingInvites.push(pack);
      else if (pack.kind !== "invite" && f && can(f, req.userId, "manageMembers")) incomingJoins.push(pack);
      else if (pack.kind !== "invite" && r.userId === req.userId) outgoing.push(pack);
      else if (pack.kind === "invite" && r.fromId === req.userId) outgoing.push(pack);
    });
    const mySet = new Set([req.userId]);
    DB.families.forEach((f) => {
      if ((f.members || []).includes(req.userId)) (f.members || []).forEach((id) => mySet.add(id));
    });
    const suggested = DB.users
      .filter((u) => u.id !== req.userId && !mySet.has(u.id))
      .slice(0, 20)
      .map((u) => publicUser(u, req.userId, { forSearch: true }));
    const families = DB.families.filter((f) => (f.members || []).includes(req.userId) && can(f, req.userId, "invite")).map((f) => ({
      id: f.id, name: f.name, privacy: f.privacy, memberCount: (f.members || []).length
    }));
    res.json({
      ok: true,
      incomingJoins,
      incomingInvites,
      outgoing,
      suggested,
      families,
      counts: { incoming: incomingJoins.length + incomingInvites.length, outgoing: outgoing.length }
    });
  });

  app.post("/api/people/invite", auth, (req, res) => {
    const { userId, familyId } = req.body || {};
    const f = DB.families.find((x) => x.id === familyId);
    if (!f) return res.status(404).json({ error: "family not found" });
    if (!can(f, req.userId, "invite")) return res.status(403).json({ error: "you cannot invite to this family" });
    const target = getUser(userId);
    if (!target) return res.status(404).json({ error: "user not found" });
    if ((f.members || []).includes(userId)) return res.json({ ok: true, already: true, family: typeof publicFamily === "function" ? publicFamily(f) : f });
    DB.joinRequests = DB.joinRequests || [];
    const existing = DB.joinRequests.find((r) => r.familyId === f.id && r.userId === userId && r.status === "pending");
    if (existing) return res.json({ ok: true, requested: true, request: existing });
    const r = {
      id: makeId("jr"),
      familyId: f.id,
      userId,
      status: "pending",
      kind: "invite",
      fromId: req.userId,
      createdAt: now()
    };
    DB.joinRequests.push(r);
    saveData();
    sendToUser(userId, { type: "join_request", action: "invite", request: r, familyId: f.id, familyName: f.name, fromName: req.user.name });
    res.json({ ok: true, request: r });
  });

  app.post("/api/people/requests/:rid/accept", auth, (req, res) => {
    const r = (DB.joinRequests || []).find((x) => x.id === req.params.rid);
    if (!r || r.status !== "pending") return res.status(404).json({ error: "request not found" });
    const f = DB.families.find((x) => x.id === r.familyId);
    if (!f) return res.status(404).json({ error: "family not found" });
    ensureFamilyRoles(f);
    if (r.kind === "invite") {
      if (r.userId !== req.userId) return res.status(403).json({ error: "this invite is not for you" });
      if (!f.members.includes(req.userId)) f.members.push(req.userId);
      f.roles[req.userId] = f.roles[req.userId] && f.roles[req.userId] !== "guest" ? f.roles[req.userId] : "member";
    } else {
      if (!can(f, req.userId, "manageMembers")) return res.status(403).json({ error: "only Head / Admin can accept" });
      if (!f.members.includes(r.userId)) f.members.push(r.userId);
      f.roles[r.userId] = "member";
    }
    r.status = "accepted";
    r.resolvedAt = now();
    r.resolvedBy = req.userId;
    saveData();
    const joinedId = r.kind === "invite" ? req.userId : r.userId;
    sendToUser(joinedId, { type: "family", action: "joined", familyId: f.id, userId: joinedId, briefing: briefing(f, joinedId) });
    broadcastToFamilyOf(joinedId, { type: "family", action: "joined", familyId: f.id, userId: joinedId });
    res.json({
      ok: true,
      family: typeof publicFamily === "function" ? publicFamily(f) : { id: f.id, name: f.name, privacy: f.privacy, members: f.members, ownerId: f.ownerId },
      briefing: briefing(f, joinedId)
    });
  });

  app.post("/api/people/requests/:rid/decline", auth, (req, res) => {
    const r = (DB.joinRequests || []).find((x) => x.id === req.params.rid);
    if (!r || r.status !== "pending") return res.status(404).json({ error: "request not found" });
    const f = DB.families.find((x) => x.id === r.familyId);
    if (!f) return res.status(404).json({ error: "family not found" });
    if (r.kind === "invite") {
      if (r.userId !== req.userId && r.fromId !== req.userId) return res.status(403).json({ error: "forbidden" });
    } else if (!can(f, req.userId, "manageMembers") && r.userId !== req.userId) {
      return res.status(403).json({ error: "only Head / Admin can decline" });
    }
    r.status = "declined";
    r.resolvedAt = now();
    r.resolvedBy = req.userId;
    saveData();
    const notify = r.kind === "invite" ? r.fromId : r.userId;
    if (notify) sendToUser(notify, { type: "join_request", action: "declined", familyId: f.id, id: r.id });
    res.json({ ok: true });
  });

  app.get("/api/posts/:id", auth, (req, res) => {
    const post = (DB.posts || []).find((p) => p.id === req.params.id);
    if (!post || !canSeePost(post, req.userId)) return res.status(404).json({ error: "not found" });
    res.json({ ok: true, post: serializePost(post, req.userId) });
  });

  app.post("/api/posts", auth, (req, res) => {
    const { text, image, video, audience, familyId, media: mediaIn } = req.body || {};
    const body = String(text || "").trim().slice(0, 4000);
    const media = normalizeMedia({ media: mediaIn, image, video });
    if (!body && !media.length) return res.status(400).json({ error: "write something or add a photo / video" });
    let aud = audience === "family" || audience === "families" ? "family" : "public";
    let fid = familyId || null;
    if (aud === "family") {
      const mine = DB.families.filter((f) => (f.members || []).includes(req.userId));
      if (fid) {
        const f = mine.find((x) => x.id === fid);
        if (!f) return res.status(403).json({ error: "not in that family" });
      } else if (mine.length === 1) fid = mine[0].id;
      else if (mine.length === 0) return res.status(400).json({ error: "join a family first" });
    }
    const firstImg = media.find((m) => m.kind === "image");
    const firstVid = media.find((m) => m.kind === "video");
    const post = {
      id: makeId("p"),
      authorId: req.userId,
      text: body,
      image: (firstImg && firstImg.url) || "",
      video: (firstVid && firstVid.url) || "",
      media,
      audience: aud === "family" ? "family" : "public",
      familyId: aud === "family" ? fid : null,
      createdAt: now(),
      likes: [],
      comments: [],
      shares: 0
    };
    DB.posts = DB.posts || [];
    DB.posts.unshift(post);
    saveData();
    emitFeed("new", post);
    res.json({ ok: true, post: serializePost(post, req.userId) });
  });

  app.post("/api/posts/:id/like", auth, (req, res) => {
    const post = (DB.posts || []).find((p) => p.id === req.params.id);
    if (!post || !canSeePost(post, req.userId)) return res.status(404).json({ error: "not found" });
    post.likes = post.likes || [];
    const i = post.likes.indexOf(req.userId);
    if (i >= 0) post.likes.splice(i, 1);
    else post.likes.push(req.userId);
    saveData();
    emitFeed("update", post);
    res.json({ ok: true, likes: post.likes.length, liked: post.likes.includes(req.userId), post: serializePost(post, req.userId) });
  });

  app.post("/api/posts/:id/comments", auth, (req, res) => {
    const post = (DB.posts || []).find((p) => p.id === req.params.id);
    if (!post || !canSeePost(post, req.userId)) return res.status(404).json({ error: "not found" });
    const text = String((req.body || {}).text || "").trim().slice(0, 2000);
    if (!text) return res.status(400).json({ error: "text required" });
    const c = { id: makeId("c"), userId: req.userId, text, ts: now() };
    post.comments = post.comments || [];
    post.comments.push(c);
    saveData();
    emitFeed("update", post);
    const ser = serializePost(post, req.userId);
    res.json({ ok: true, comment: ser.comments.slice(-1)[0], post: ser });
  });

  app.post("/api/posts/:id/share", auth, (req, res) => {
    const post = (DB.posts || []).find((p) => p.id === req.params.id);
    if (!post || !canSeePost(post, req.userId)) return res.status(404).json({ error: "not found" });
    post.shares = (post.shares || 0) + 1;
    let copy = null;
    const mode = req.body && req.body.mode;
    if (mode === "repost") {
      const aud = req.body.audience === "family" ? "family" : "public";
      let fid = req.body.familyId || null;
      if (aud === "family") {
        const mine = DB.families.filter((f) => (f.members || []).includes(req.userId));
        if (fid && !mine.find((x) => x.id === fid)) return res.status(403).json({ error: "not in that family" });
        if (!fid && mine.length === 1) fid = mine[0].id;
        if (!fid && mine.length === 0) return res.status(400).json({ error: "join a family first" });
      }
      const media = normalizeMedia(post);
      const firstImg = media.find((m) => m.kind === "image");
      const firstVid = media.find((m) => m.kind === "video");
      const author = getUser(post.authorId);
      copy = {
        id: makeId("p"),
        authorId: req.userId,
        text: String(req.body.text || post.text || "").slice(0, 4000),
        image: (firstImg && firstImg.url) || "",
        video: (firstVid && firstVid.url) || "",
        media,
        audience: aud === "family" ? "family" : "public",
        familyId: aud === "family" ? fid : null,
        likes: [],
        comments: [],
        shares: 0,
        sharedFrom: { id: post.id, authorId: post.authorId, authorName: author ? author.name : "Member" },
        createdAt: now()
      };
      DB.posts.unshift(copy);
    }
    saveData();
    emitFeed("update", post);
    if (copy) emitFeed("new", copy);
    res.json({
      ok: true,
      shares: post.shares,
      post: copy ? serializePost(copy, req.userId) : serializePost(post, req.userId)
    });
  });

  app.delete("/api/posts/:id", auth, (req, res) => {
    const post = (DB.posts || []).find((p) => p.id === req.params.id);
    if (!post) return res.status(404).json({ error: "not found" });
    const isAuthor = post.authorId === req.userId;
    let mod = false;
    if (post.familyId) {
      const f = DB.families.find((x) => x.id === post.familyId);
      mod = f && can(f, req.userId, "moderateFeed");
    }
    if (!isAuthor && !mod) return res.status(403).json({ error: "cannot delete" });
    DB.posts = DB.posts.filter((p) => p.id !== req.params.id);
    saveData();
    emitFeed("delete", post);
    res.json({ ok: true });
  });
}

module.exports = { attach, ensureFamilyRoles, can, roleOf, DEFAULT_ROLE_DEFS, briefing };
