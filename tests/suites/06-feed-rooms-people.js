"use strict";

/** Community feed, hobby rooms, people hub invites. */
module.exports = {
  id: "community",
  name: "Feed, rooms & people hub",
  async run(t) {
    t.section("Feed, rooms & people hub");

    const vito = await t.login("vito@familia.test", "demo123");
    const tessio = await t.login("tessio@familia.test", "demo123");
    const a = await t.register();
    if (!vito || !tessio || !a) return;

    const topics = await t.get("/api/rooms/topics", { token: vito.token });
    await t.expectStatus(topics, 200, "GET /api/rooms/topics");
    t.check("topics include Cooking", !!(topics.json && Array.isArray(topics.json.topics) && topics.json.topics.includes("Cooking")));

    const rooms = await t.get("/api/rooms", { token: vito.token });
    await t.expectStatus(rooms, 200, "GET /api/rooms");
    t.check("demo rooms exist", !!(rooms.json && (rooms.json.rooms || []).length + (rooms.json.discover || []).length >= 2));

    const created = await t.post("/api/rooms", {
      name: "QA Table " + Date.now().toString(36),
      topic: "Games",
      desc: "Private test table",
      privacy: "private"
    }, { token: a.token });
    await t.expectStatus(created, 200, "create private room");
    const room = created.json && created.json.room;
    const joinDenied = await t.post("/api/rooms/" + room.id + "/join", {}, { token: tessio.token });
    await t.expectStatus(joinDenied, 403, "private room is invite-only");
    const invited = await t.post("/api/rooms/" + room.id + "/invite", { userId: vito.user.id }, { token: a.token });
    await t.expectStatus(invited, 200, "invite into private room");

    const pubRoom = await t.post("/api/rooms", { name: "QA Public Hall", topic: "Other", privacy: "public" }, { token: a.token });
    const pr = pubRoom.json && pubRoom.json.room;
    const joined = await t.post("/api/rooms/" + pr.id + "/join", {}, { token: tessio.token });
    await t.expectStatus(joined, 200, "join public room");

    const rmsg = await t.post("/api/messages", { roomId: room.id, enc: { iv: "cm9vbQ", ct: "c2Vj" } }, { token: a.token });
    await t.expectStatus(rmsg, 200, "encrypted room message");
    const rpeek = await t.get("/api/messages?room=" + room.id, { token: tessio.token });
    await t.expectStatus(rpeek, 403, "non-member cannot read private room");

    const feed = await t.get("/api/feed", { token: vito.token });
    await t.expectStatus(feed, 200, "GET /api/feed");
    t.check("feed returns posts", !!(feed.json && Array.isArray(feed.json.posts)));

    const pubPost = await t.post("/api/posts", { text: "QA public " + Date.now(), audience: "public" }, { token: a.token });
    await t.expectStatus(pubPost, 200, "create public post");
    const pid = pubPost.json && pubPost.json.post && pubPost.json.post.id;

    const house = await t.post("/api/families", { name: "QA FeedHouse " + Date.now().toString(36), privacy: "private" }, { token: vito.token });
    const houseId = house.json && house.json.family && house.json.family.id;
    const famPost = await t.post("/api/posts", {
      text: "QA family only " + Date.now(),
      audience: "family",
      familyId: houseId
    }, { token: vito.token });
    await t.expectStatus(famPost, 200, "create family-only post");
    const fid = famPost.json && famPost.json.post && famPost.json.post.id;

    const tessioFeed = await t.get("/api/feed?filter=family", { token: tessio.token });
    const tessioSees = ((tessioFeed.json && tessioFeed.json.posts) || []).some((p) => p.id === fid);
    t.check("outsider cannot see other family's post", tessioSees === false);

    const vitoFeed = await t.get("/api/feed", { token: vito.token });
    const vitoSees = ((vitoFeed.json && vitoFeed.json.posts) || []).some((p) => p.id === fid);
    t.check("author sees own family-only post", vitoSees === true);

    if (pid) {
      const like = await t.post("/api/posts/" + pid + "/like", {}, { token: vito.token });
      await t.expectStatus(like, 200, "like post");
      t.check("liked flag", !!(like.json && like.json.liked === true));
      const cmt = await t.post("/api/posts/" + pid + "/comments", { text: "Noted." }, { token: vito.token });
      await t.expectStatus(cmt, 200, "comment on post");
      const share = await t.post("/api/posts/" + pid + "/share", { mode: "count" }, { token: vito.token });
      await t.expectStatus(share, 200, "share counter");
      const one = await t.get("/api/posts/" + pid, { token: tessio.token });
      await t.expectStatus(one, 200, "public post visible to outsider");
      const delDenied = await t.del("/api/posts/" + pid, {}, { token: tessio.token });
      await t.expectStatus(delDenied, 403, "cannot delete someone else's post");
      const delOk = await t.del("/api/posts/" + pid, {}, { token: a.token });
      await t.expectStatus(delOk, 200, "author deletes post");
    }

    const hub = await t.get("/api/people/hub", { token: vito.token });
    await t.expectStatus(hub, 200, "GET /api/people/hub");
    t.check("hub has suggested + families", !!(hub.json && Array.isArray(hub.json.suggested) && Array.isArray(hub.json.families)));

    const invite = await t.post("/api/people/invite", { userId: a.user.id, familyId: "f_demo_corleone" }, { token: vito.token });
    await t.expectStatus(invite, 200, "Head invites QA user");
    const rid = invite.json && (invite.json.request && invite.json.request.id);
    if (rid) {
      const steal = await t.post("/api/people/requests/" + rid + "/accept", {}, { token: tessio.token });
      await t.expectStatus(steal, 403, "outsider cannot accept someone else's invite");
      const acc = await t.post("/api/people/requests/" + rid + "/accept", {}, { token: a.token });
      await t.expectStatus(acc, 200, "invitee accepts");
    }

    const search = await t.get("/api/search?q=sauce", { token: vito.token });
    t.check("search finds rooms or posts", !!(search.json && ((search.json.rooms || []).length + (search.json.posts || []).length) >= 1),
      "rooms=" + ((search.json && search.json.rooms) || []).length + " posts=" + ((search.json && search.json.posts) || []).length);
  }
};
