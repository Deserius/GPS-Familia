"use strict";

/**
 * Real-time marketplace (Facebook Marketplace-style).
 * Listings are public-to-signed-in users. Buyer/seller chat uses encrypted /api/messages.
 * Precise GPS is never stored on a listing — city + ~city-block coords only.
 */

const CATEGORIES = ["vehicles", "electronics", "furniture", "clothing", "home", "services", "free", "other"];
const CONDITIONS = ["new", "like_new", "good", "fair", "for_parts"];

function ensure(DB) {
  DB.listings = Array.isArray(DB.listings) ? DB.listings : [];
  DB.offers = Array.isArray(DB.offers) ? DB.offers : [];
}

function sanitizeMediaUrl(u) {
  const s = String(u || "");
  if (/^\/uploads\/[A-Za-z0-9._-]+$/.test(s)) return s;
  if (s.startsWith("data:image/") && s.length < 900000) return s;
  return "";
}

function fuzz(n) {
  return Math.round(Number(n) * 100) / 100;
}

function haversineMiles(aLat, aLng, bLat, bLng) {
  if (![aLat, aLng, bLat, bLng].every(Number.isFinite)) return null;
  const R = 3958.8;
  const dLat = (bLat - aLat) * Math.PI / 180;
  const dLng = (bLng - aLng) * Math.PI / 180;
  const la1 = aLat * Math.PI / 180;
  const la2 = bLat * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function serializeListing(row, viewerId, getUser, origin) {
  const u = getUser(row.sellerId);
  const saved = Array.isArray(row.savedBy) && row.savedBy.includes(viewerId);
  const miles = origin && Number.isFinite(origin.lat)
    ? haversineMiles(origin.lat, origin.lng, row.lat, row.lng)
    : null;
  return {
    id: row.id,
    sellerId: row.sellerId,
    sellerName: u ? u.name : "Seller",
    sellerAvatar: (u && u.profileImage && String(u.profileImage).startsWith("/avatars/")) ? u.profileImage : "",
    title: row.title,
    desc: row.desc || "",
    price: row.price,
    currency: row.currency || "USD",
    category: row.category,
    condition: row.condition,
    media: (row.media || []).slice(0, 6),
    city: row.city || "",
    lat: row.lat,
    lng: row.lng,
    miles: miles == null ? null : Math.round(miles * 10) / 10,
    status: row.status,
    demo: !!row.demo,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    saved,
    mine: row.sellerId === viewerId,
    offerCount: (row.offers && row.offers.length) || 0
  };
}

function attach(ctx) {
  const {
    app, DB, saveData, auth, makeId, now, getUser, sendToUser, onlineUserIds, DEMO
  } = ctx;
  const social = require("./social-server");
  ensure(DB);

  function forbidChild(req, res, next) {
    const u = getUser(req.userId);
    if (u && (u.accountType === "child" || u.child === true)) {
      return res.status(403).json({ error: "marketplace is not available on a child account" });
    }
    next();
  }

  function seedDemoMarket() {
    const ts = now();
    const seed = [
      { sellerId: "u_demo_vito", title: "Mahogany dining table — seats 8", desc: "Family table. Pickup in Denver HQ. Cash or Familia wallet.", price: 450, category: "furniture", condition: "good", city: "Denver", lat: 39.74, lng: -104.99, image: "/market-demo/table.jpg" },
      { sellerId: "u_demo_sonny", title: "Motorcycle jacket, leather", desc: "Barely worn. Size L. RiNo pickup.", price: 120, category: "clothing", condition: "like_new", city: "RiNo", lat: 39.76, lng: -104.98, image: "/market-demo/jacket.jpg" },
      { sellerId: "u_demo_michael", title: "Quiet Cherry Creek bicycle", desc: "City bike, lights included. Meet in public.", price: 180, category: "other", condition: "good", city: "Cherry Creek", lat: 39.72, lng: -104.95, image: "/market-demo/bike.jpg" },
      { sellerId: "u_demo_tessio", title: "Case of olive oil (free)", desc: "Moving sale. First come.", price: 0, category: "free", condition: "new", city: "Englewood", lat: 39.65, lng: -104.99, image: "/market-demo/olive.jpg" },
      { sellerId: "u_demo_connie", title: "Kids winter coats, 2T–5T", desc: "Clean, smoke-free home.", price: 25, category: "clothing", condition: "good", city: "Capitol Hill", lat: 39.73, lng: -104.98, image: "/market-demo/coats.jpg" },
      { sellerId: "u_demo_clemenza", title: "Used espresso machine", desc: "Makes a proper shot. Aurora pickup.", price: 90, category: "home", condition: "fair", city: "Aurora", lat: 39.73, lng: -104.83, image: "/market-demo/espresso.jpg" }
    ];
    let changed = false;
    seed.forEach((s, i) => {
      const id = "lst_demo_" + (i + 1);
      let row = DB.listings.find((x) => x.id === id) || DB.listings.find((x) => x.title === s.title && x.sellerId === s.sellerId);
      if (!row) {
        row = {
          id,
          sellerId: s.sellerId,
          title: s.title,
          desc: s.desc,
          price: s.price,
          currency: "USD",
          category: s.category,
          condition: s.condition,
          media: [{ kind: "image", url: s.image }],
          city: s.city,
          lat: s.lat,
          lng: s.lng,
          status: "active",
          savedBy: i === 0 ? ["u_demo_michael"] : [],
          offers: [],
          createdAt: ts - (seed.length - i) * 3600000,
          updatedAt: ts - (seed.length - i) * 3600000,
          demo: true
        };
        DB.listings.push(row);
        changed = true;
        return;
      }
      row.demo = true;
      row.id = id;
      if (row.status === "removed" || row.status === "sold" || row.status === "hidden") {
        row.status = "active";
        changed = true;
      }
      if (!row.media || !row.media.length) {
        row.media = [{ kind: "image", url: s.image }];
        changed = true;
      }
    });
    DB.settings = DB.settings || {};
    if (!DB.settings.demoMarketSeeded) { DB.settings.demoMarketSeeded = true; changed = true; }
    if (changed) saveData();
  }
  seedDemoMarket();

  function emitMarket(action, listing, extra) {
    const ids = typeof onlineUserIds === "function" ? onlineUserIds() : [];
    const payload = Object.assign({ type: "market", action, id: listing && listing.id }, extra || {});
    ids.forEach((uid) => {
      if (listing && social.blockedBetween(DB, uid, listing.sellerId) && uid !== listing.sellerId) return;
      sendToUser(uid, listing ? Object.assign({}, payload, { listing: serializeListing(listing, uid, getUser) }) : payload);
    });
  }

  app.get("/api/market", auth, forbidChild, (req, res) => {
    ensure(DB);
    seedDemoMarket();
    const q = String(req.query.q || "").trim().toLowerCase();
    const cat = String(req.query.category || req.query.cat || "").toLowerCase();
    const filter = String(req.query.filter || "all");
    const mine = filter === "mine";
    const saved = filter === "saved";
    const condRaw = String(req.query.condition || "").toLowerCase();
    const minPrice = req.query.minPrice != null && req.query.minPrice !== "" ? Number(req.query.minPrice) : null;
    const maxPrice = req.query.maxPrice != null && req.query.maxPrice !== "" ? Number(req.query.maxPrice) : null;
    const milesMax = req.query.miles != null && req.query.miles !== "" ? Number(req.query.miles) : null;
    const sort = String(req.query.sort || "newest");
    const statusQ = String(req.query.status || (mine ? "all" : "active"));
    const originLat = Number(req.query.lat);
    const originLng = Number(req.query.lng);
    let origin = Number.isFinite(originLat) && Number.isFinite(originLng) ? { lat: originLat, lng: originLng } : null;
    if (!origin && req.user && req.user.lastLocation) {
      origin = { lat: req.user.lastLocation.lat, lng: req.user.lastLocation.lng };
    }
    const usedSet = ["like_new", "good", "fair"];
    let list = DB.listings.filter((l) => {
      if (l.status === "removed") return false;
      if (social.blockedBetween(DB, req.userId, l.sellerId) && l.sellerId !== req.userId) return false;
      if (mine) return l.sellerId === req.userId;
      if (saved) return Array.isArray(l.savedBy) && l.savedBy.includes(req.userId);
      if (statusQ === "sold") return l.status === "sold";
      if (statusQ === "all") return l.status === "active" || l.status === "sold" || l.sellerId === req.userId;
      return l.status === "active" || l.sellerId === req.userId;
    });
    if (cat && CATEGORIES.includes(cat)) list = list.filter((l) => l.category === cat);
    if (condRaw === "used") list = list.filter((l) => usedSet.includes(l.condition));
    else if (CONDITIONS.includes(condRaw)) list = list.filter((l) => l.condition === condRaw);
    if (Number.isFinite(minPrice)) list = list.filter((l) => Number(l.price) >= minPrice);
    if (Number.isFinite(maxPrice)) list = list.filter((l) => Number(l.price) <= maxPrice);
    if (q) {
      list = list.filter((l) => {
        const u = getUser(l.sellerId);
        const blob = `${l.title || ""} ${l.desc || ""} ${l.city || ""} ${l.category || ""} ${l.condition || ""} ${u ? u.name : ""}`.toLowerCase();
        return blob.includes(q);
      });
    }
    if (Number.isFinite(milesMax) && milesMax > 0 && origin) {
      list = list.filter((l) => {
        const d = haversineMiles(origin.lat, origin.lng, Number(l.lat), Number(l.lng));
        return d != null && d <= milesMax;
      });
    }
    if (sort === "price_asc") list.sort((a, b) => (a.price || 0) - (b.price || 0));
    else if (sort === "price_desc") list.sort((a, b) => (b.price || 0) - (a.price || 0));
    else if (sort === "distance") {
      list.sort((a, b) => {
        const da = origin ? haversineMiles(origin.lat, origin.lng, Number(a.lat), Number(a.lng)) : null;
        const db = origin ? haversineMiles(origin.lat, origin.lng, Number(b.lat), Number(b.lng)) : null;
        return (da == null ? 1e9 : da) - (db == null ? 1e9 : db);
      });
    } else list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const limit = Math.min(80, Math.max(8, Number(req.query.limit || 40)));
    const offset = Math.max(0, Number(req.query.offset || 0));
    res.json({
      ok: true,
      total: list.length,
      categories: CATEGORIES,
      conditions: CONDITIONS,
      listings: list.slice(offset, offset + limit).map((l) => serializeListing(l, req.userId, getUser, origin)),
      more: offset + limit < list.length
    });
  });

  app.get("/api/market/:id", auth, forbidChild, (req, res) => {
    ensure(DB);
    const row = DB.listings.find((l) => l.id === req.params.id);
    if (!row || row.status === "removed") return res.status(404).json({ error: "not found" });
    if (social.blockedBetween(DB, req.userId, row.sellerId) && row.sellerId !== req.userId) {
      return res.status(404).json({ error: "not found" });
    }
    const offers = (row.offers || []).filter((o) =>
      o.buyerId === req.userId || row.sellerId === req.userId
    ).map((o) => ({
      id: o.id,
      amount: o.amount,
      status: o.status,
      buyerId: row.sellerId === req.userId ? o.buyerId : undefined,
      mine: o.buyerId === req.userId,
      createdAt: o.createdAt
    }));
    res.json({ ok: true, listing: serializeListing(row, req.userId, getUser), offers });
  });

  app.post("/api/market", auth, forbidChild, (req, res) => {
    ensure(DB);
    const b = req.body || {};
    const title = String(b.title || "").trim().slice(0, 80);
    if (title.length < 3) return res.status(400).json({ error: "title required" });
    const desc = String(b.desc || b.description || "").trim().slice(0, 4000);
    let price = Number(b.price);
    if (!Number.isFinite(price) || price < 0) price = 0;
    price = Math.round(price * 100) / 100;
    const category = CATEGORIES.includes(b.category) ? b.category : "other";
    const condition = CONDITIONS.includes(b.condition) ? b.condition : "good";
    const media = [];
    (Array.isArray(b.media) ? b.media : []).forEach((m) => {
      const url = sanitizeMediaUrl(m && (m.url || m));
      if (url) media.push({ kind: "image", url });
    });
    if (b.image) {
      const url = sanitizeMediaUrl(b.image);
      if (url) media.push({ kind: "image", url });
    }
    const city = String(b.city || "").trim().slice(0, 80);
    let lat = Number(b.lat), lng = Number(b.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      const loc = req.user.lastLocation;
      if (loc) { lat = loc.lat; lng = loc.lng; }
    }
    const row = {
      id: makeId("lst"),
      sellerId: req.userId,
      title,
      desc,
      price,
      currency: "USD",
      category,
      condition,
      media: media.slice(0, 6),
      city,
      lat: Number.isFinite(lat) ? fuzz(lat) : null,
      lng: Number.isFinite(lng) ? fuzz(lng) : null,
      status: "active",
      savedBy: [],
      offers: [],
      createdAt: now(),
      updatedAt: now()
    };
    DB.listings.unshift(row);
    if (DB.listings.length > 5000) DB.listings = DB.listings.slice(0, 4000);
    saveData();
    emitMarket("new", row);
    res.json({ ok: true, listing: serializeListing(row, req.userId, getUser) });
  });

  app.patch("/api/market/:id", auth, forbidChild, (req, res) => {
    const row = (DB.listings || []).find((l) => l.id === req.params.id);
    if (!row) return res.status(404).json({ error: "not found" });
    if (row.sellerId !== req.userId) return res.status(403).json({ error: "only the seller can edit" });
    const b = req.body || {};
    if (b.title) row.title = String(b.title).trim().slice(0, 80);
    if (b.desc != null || b.description != null) row.desc = String(b.desc || b.description || "").slice(0, 4000);
    if (b.price != null) {
      const p = Number(b.price);
      if (Number.isFinite(p) && p >= 0) row.price = Math.round(p * 100) / 100;
    }
    if (CATEGORIES.includes(b.category)) row.category = b.category;
    if (CONDITIONS.includes(b.condition)) row.condition = b.condition;
    if (b.status === "sold" || b.status === "active" || b.status === "hidden") row.status = b.status;
    if (b.city != null) row.city = String(b.city).slice(0, 80);
    row.updatedAt = now();
    saveData();
    emitMarket("update", row);
    res.json({ ok: true, listing: serializeListing(row, req.userId, getUser) });
  });

  app.delete("/api/market/:id", auth, forbidChild, (req, res) => {
    const row = (DB.listings || []).find((l) => l.id === req.params.id);
    if (!row) return res.status(404).json({ error: "not found" });
    if (row.sellerId !== req.userId) return res.status(403).json({ error: "only the seller can delete" });
    row.status = "removed";
    row.updatedAt = now();
    saveData();
    emitMarket("delete", row);
    res.json({ ok: true });
  });

  app.post("/api/market/:id/save", auth, forbidChild, (req, res) => {
    const row = (DB.listings || []).find((l) => l.id === req.params.id);
    if (!row || row.status === "removed") return res.status(404).json({ error: "not found" });
    row.savedBy = Array.isArray(row.savedBy) ? row.savedBy : [];
    const i = row.savedBy.indexOf(req.userId);
    if (i >= 0) row.savedBy.splice(i, 1);
    else row.savedBy.push(req.userId);
    saveData();
    res.json({ ok: true, saved: row.savedBy.includes(req.userId) });
  });

  app.post("/api/market/:id/message", auth, forbidChild, (req, res) => {
    const row = (DB.listings || []).find((l) => l.id === req.params.id);
    if (!row || row.status === "removed") return res.status(404).json({ error: "not found" });
    if (row.sellerId === req.userId) return res.status(400).json({ error: "this is your listing" });
    const gate = social.canDm(DB, req.userId, row.sellerId, ctx);
    if (!gate.ok) return res.status(403).json({ error: gate.error });
    res.json({ ok: true, to: row.sellerId, listingId: row.id, title: row.title });
  });

  app.post("/api/market/:id/offer", auth, forbidChild, (req, res) => {
    const row = (DB.listings || []).find((l) => l.id === req.params.id);
    if (!row || row.status !== "active") return res.status(404).json({ error: "not found" });
    if (row.sellerId === req.userId) return res.status(400).json({ error: "cannot offer on your own listing" });
    const gate = social.canDm(DB, req.userId, row.sellerId, ctx);
    if (!gate.ok) return res.status(403).json({ error: gate.error });
    const amount = Number((req.body || {}).amount);
    if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: "amount required" });
    const o = {
      id: makeId("off"),
      buyerId: req.userId,
      amount: Math.round(amount * 100) / 100,
      status: "pending",
      createdAt: now()
    };
    row.offers = row.offers || [];
    row.offers.push(o);
    saveData();
    sendToUser(row.sellerId, { type: "market", action: "offer", listingId: row.id, offer: { id: o.id, amount: o.amount } });
    res.json({ ok: true, offer: { id: o.id, amount: o.amount, status: o.status } });
  });

  app.post("/api/market/:id/offers/:oid/accept", auth, forbidChild, (req, res) => {
    const row = (DB.listings || []).find((l) => l.id === req.params.id);
    if (!row) return res.status(404).json({ error: "not found" });
    if (row.sellerId !== req.userId) return res.status(403).json({ error: "only the seller can accept" });
    const o = (row.offers || []).find((x) => x.id === req.params.oid);
    if (!o) return res.status(404).json({ error: "offer not found" });
    o.status = "accepted";
    row.status = "sold";
    row.updatedAt = now();
    saveData();
    sendToUser(o.buyerId, { type: "market", action: "offer_accepted", listingId: row.id, offerId: o.id });
    emitMarket("update", row);
    res.json({ ok: true, listing: serializeListing(row, req.userId, getUser) });
  });

  app.post("/api/market/:id/offers/:oid/decline", auth, forbidChild, (req, res) => {
    const row = (DB.listings || []).find((l) => l.id === req.params.id);
    if (!row) return res.status(404).json({ error: "not found" });
    if (row.sellerId !== req.userId) return res.status(403).json({ error: "only the seller can decline" });
    const o = (row.offers || []).find((x) => x.id === req.params.oid);
    if (!o) return res.status(404).json({ error: "offer not found" });
    o.status = "declined";
    saveData();
    sendToUser(o.buyerId, { type: "market", action: "offer_declined", listingId: row.id, offerId: o.id });
    res.json({ ok: true });
  });
}

module.exports = { attach, ensure, CATEGORIES, CONDITIONS };
