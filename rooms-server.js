"use strict";

const TOPICS = [
  "Cooking", "Cars", "Sports", "Music", "Travel", "Gaming", "Games",
  "Gardening", "Faith", "Fishing", "Books", "Movies", "Other"
];

function publicRoom(r, userId) {
  const members = Array.isArray(r.members) ? r.members : [];
  return {
    id: r.id,
    name: r.name,
    topic: r.topic || "Other",
    desc: r.desc || "",
    privacy: r.privacy === "public" ? "public" : "private",
    ownerId: r.ownerId,
    memberCount: members.length,
    isMember: !!(userId && members.includes(userId)),
    createdAt: r.createdAt
  };
}

function attachRooms(ctx) {
  const { app, DB, saveData, auth, makeId, now, getUser, sendToUser, DEMO } = ctx;

  function seedRooms() {
    DB.rooms = Array.isArray(DB.rooms) ? DB.rooms : [];
    DB.settings = DB.settings || {};
    const already = !!DB.settings.demoRoomsSeeded;
    const ts = now();
    const rooms = [
      {
        id: "r_demo_cooking",
        name: "Sunday Sauce",
        topic: "Cooking",
        privacy: "public",
        desc: "Recipes, grocery runs, who brings the bread.",
        members: ["u_demo_connie", "u_demo_clemenza", "u_demo_kay", "u_demo_vito"],
        ownerId: "u_demo_connie"
      },
      {
        id: "r_demo_cars",
        name: "Classic Rides",
        topic: "Cars",
        privacy: "public",
        desc: "Engines, weekend drives, Denver meets.",
        members: ["u_demo_sonny", "u_demo_clemenza", "u_demo_tessio"],
        ownerId: "u_demo_sonny"
      },
      {
        id: "r_demo_cards",
        name: "Poker Night",
        topic: "Games",
        privacy: "private",
        desc: "Private table. No maps — just cards.",
        members: ["u_demo_vito", "u_demo_tom", "u_demo_clemenza", "u_demo_tessio"],
        ownerId: "u_demo_vito"
      }
    ];
    rooms.forEach((r) => {
      if (DB.rooms.find((x) => x.id === r.id)) return;
      DB.rooms.push({
        id: r.id,
        name: r.name,
        topic: r.topic,
        privacy: r.privacy,
        desc: r.desc,
        members: r.members.slice(),
        ownerId: r.ownerId,
        invites: [],
        createdAt: ts
      });
    });
    const chatter = [
      ["u_demo_connie", "r_demo_cooking", "Bring extra basil Friday. Sauce starts at 4."],
      ["u_demo_clemenza", "r_demo_cooking", "I got the sausage. Don't forget the bread."],
      ["u_demo_kay", "r_demo_cooking", "I'll do dessert. Something that travels."],
      ["u_demo_sonny", "r_demo_cars", "Cherry Creek lot Saturday. Leave the Lincoln at home."],
      ["u_demo_tessio", "r_demo_cars", "I'll bring the ragtop if it doesn't rain."],
      ["u_demo_vito", "r_demo_cards", "Table is set. No business talk."]
    ];
    if (!already) {
      chatter.forEach(([from, roomId, text], i) => {
        DB.messages.push({
          id: makeId("m"),
          from,
          to: null,
          roomId,
          text,
          ts: ts - (chatter.length - i) * 90000,
          kind: "chat",
          demo: true,
          readBy: []
        });
      });
    }
    DB.settings.demoRoomsSeeded = true;
    saveData();
  }

  seedRooms();

  app.get("/api/rooms/topics", auth, (req, res) => {
    res.json({ ok: true, topics: TOPICS });
  });

  app.get("/api/rooms", auth, (req, res) => {
    DB.rooms = DB.rooms || [];
    const q = String(req.query.q || "").trim().toLowerCase();
    const mine = [];
    const discover = [];
    DB.rooms.forEach((r) => {
      const members = r.members || [];
      const isMember = members.includes(req.userId);
      const blob = `${r.name || ""} ${r.topic || ""} ${r.desc || ""}`.toLowerCase();
      if (q && !blob.includes(q)) return;
      const row = publicRoom(r, req.userId);
      if (isMember) mine.push(row);
      else if (r.privacy === "public") discover.push(row);
    });
    res.json({ ok: true, rooms: mine, discover, topics: TOPICS });
  });

  app.get("/api/rooms/:id", auth, (req, res) => {
    const r = (DB.rooms || []).find((x) => x.id === req.params.id);
    if (!r) return res.status(404).json({ error: "room not found" });
    const members = r.members || [];
    if (r.privacy !== "public" && !members.includes(req.userId)) {
      return res.status(403).json({ error: "private room" });
    }
    const people = members.map((id) => {
      const u = getUser(id);
      return { id, name: u ? u.name : "Member" };
    });
    res.json({ ok: true, room: Object.assign(publicRoom(r, req.userId), { members: people }) });
  });

  app.post("/api/rooms", auth, (req, res) => {
    const { name, topic, desc, privacy } = req.body || {};
    const title = String(name || "").trim().slice(0, 60);
    if (!title) return res.status(400).json({ error: "name required" });
    const top = TOPICS.includes(topic) ? topic : "Other";
    const r = {
      id: makeId("r"),
      name: title,
      topic: top,
      desc: String(desc || "").trim().slice(0, 280),
      privacy: privacy === "public" ? "public" : "private",
      members: [req.userId],
      ownerId: req.userId,
      invites: [],
      createdAt: now()
    };
    DB.rooms = DB.rooms || [];
    DB.rooms.push(r);
    saveData();
    sendToUser(req.userId, { type: "room", action: "created", room: publicRoom(r, req.userId) });
    res.json({ ok: true, room: publicRoom(r, req.userId) });
  });

  app.post("/api/rooms/:id/join", auth, (req, res) => {
    const r = (DB.rooms || []).find((x) => x.id === req.params.id);
    if (!r) return res.status(404).json({ error: "room not found" });
    r.members = r.members || [];
    if (r.members.includes(req.userId)) return res.json({ ok: true, room: publicRoom(r, req.userId), already: true });
    if (r.privacy !== "public") return res.status(403).json({ error: "this room is invite-only" });
    r.members.push(req.userId);
    saveData();
    r.members.forEach((id) => sendToUser(id, { type: "room", action: "joined", roomId: r.id, userId: req.userId }));
    res.json({ ok: true, room: publicRoom(r, req.userId) });
  });

  app.post("/api/rooms/:id/leave", auth, (req, res) => {
    const r = (DB.rooms || []).find((x) => x.id === req.params.id);
    if (!r) return res.status(404).json({ error: "room not found" });
    r.members = (r.members || []).filter((id) => id !== req.userId);
    if (r.ownerId === req.userId) r.ownerId = r.members[0] || r.ownerId;
    saveData();
    sendToUser(req.userId, { type: "room", action: "left", roomId: r.id });
    res.json({ ok: true });
  });

  app.post("/api/rooms/:id/invite", auth, (req, res) => {
    const r = (DB.rooms || []).find((x) => x.id === req.params.id);
    if (!r) return res.status(404).json({ error: "room not found" });
    if (!(r.members || []).includes(req.userId)) return res.status(403).json({ error: "not a member" });
    const userId = String((req.body || {}).userId || "");
    if (!userId) return res.status(400).json({ error: "userId required" });
    const u = getUser(userId);
    if (!u) return res.status(404).json({ error: "user not found" });
    r.members = r.members || [];
    if (!r.members.includes(userId)) r.members.push(userId);
    saveData();
    sendToUser(userId, { type: "room", action: "invited", room: publicRoom(r, userId) });
    res.json({ ok: true, room: publicRoom(r, req.userId) });
  });

  if (DEMO) {
    /* keep demo rooms even if data was seeded before rooms existed */
    seedRooms();
  }
}

module.exports = { attachRooms, TOPICS };
