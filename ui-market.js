/**
 * GPS FAMILIA marketplace panel — listings, offers, encrypted seller chat, P2P pay.
 */
function uiNotice(msg) {
  if (window.f360 && typeof window.f360.notice === "function") return window.f360.notice(String(msg == null ? "" : msg));
  return Promise.resolve();
}

function condLabel(c) {
  return ({ new: "New", like_new: "Like new", good: "Good", fair: "Fair", for_parts: "For parts" })[c] || c || "";
}

export async function mountMarketplace(H, root, opts) {
  opts = opts || {};
  const { make, api, apiTry, currentSession, getAvatarFor, uploadMedia } = H;
  if (!currentSession()) return uiNotice("Sign in first");
  root.innerHTML = "";
  const app = make("div", { className: "feed-app market-app" });
  const head = make("div", { className: "feed-panel-head" });
  const titles = make("div");
  titles.appendChild(make("div", { className: "help-kicker" }, "Buy & sell"));
  titles.appendChild(make("h3", {}, "Marketplace"));
  const x = make("button", { className: "modal-close feed-panel-x", type: "button" }, "✕");
  x.onclick = () => { if (typeof H.closeMarketPanel === "function") H.closeMarketPanel(); };
  head.append(titles, x);
  app.appendChild(head);

  let filter = opts.filter || "all";
  let cat = "";
  let query = "";
  let condition = "";
  let minPrice = "";
  let maxPrice = "";
  let miles = "";
  let sort = "newest";
  let status = "active";
  let feeInfo = { rate: 0.069, min: 0.49, cap: 25, percentLabel: "6.9%" };

  const chips = make("div", { className: "feed-chips" });
  [["all", "All"], ["mine", "Your listings"], ["saved", "Saved"]].forEach(([id, label]) => {
    const b = make("button", { className: "inbox-chip" + (id === filter ? " on" : ""), type: "button" }, label);
    b.dataset.id = id;
    b.onclick = () => {
      filter = id;
      chips.querySelectorAll(".inbox-chip").forEach((c) => c.classList.toggle("on", c.dataset.id === id));
      load();
    };
    chips.appendChild(b);
  });
  app.appendChild(chips);

  const tools = make("div", { className: "feed-filter-row" });
  const search = make("input", { className: "input", type: "search", placeholder: "Search listings…" });
  const catsel = make("select", { className: "input" });
  catsel.appendChild(make("option", { value: "" }, "Any category"));
  ["vehicles", "electronics", "furniture", "clothing", "home", "services", "free", "other"].forEach((c) => {
    catsel.appendChild(make("option", { value: c }, c.replace("_", " ")));
  });
  const sellBtn = make("button", { className: "btn small", type: "button" }, "＋ Sell");
  tools.append(search, catsel, sellBtn);
  app.appendChild(tools);

  const extra = make("div", { className: "market-filters" });
  const condsel = make("select", { className: "input" });
  [["", "Any condition"], ["new", "New"], ["like_new", "Like new"], ["used", "Used"], ["good", "Good"], ["fair", "Fair"], ["for_parts", "For parts"]].forEach(([v, l]) => {
    condsel.appendChild(make("option", { value: v }, l));
  });
  const pmin = make("input", { className: "input", type: "number", min: "0", step: "1", placeholder: "Min $" });
  const pmax = make("input", { className: "input", type: "number", min: "0", step: "1", placeholder: "Max $" });
  const milessel = make("select", { className: "input" });
  [["", "Any distance"], ["5", "Within 5 mi"], ["10", "Within 10 mi"], ["25", "Within 25 mi"], ["50", "Within 50 mi"], ["100", "Within 100 mi"]].forEach(([v, l]) => {
    milessel.appendChild(make("option", { value: v }, l));
  });
  const sortsel = make("select", { className: "input" });
  [["newest", "Newest"], ["price_asc", "Price: low"], ["price_desc", "Price: high"], ["distance", "Nearest"]].forEach(([v, l]) => {
    sortsel.appendChild(make("option", { value: v }, l));
  });
  const statussel = make("select", { className: "input" });
  [["active", "For sale"], ["sold", "Sold"], ["all", "For sale + sold"]].forEach(([v, l]) => {
    statussel.appendChild(make("option", { value: v }, l));
  });
  extra.append(condsel, pmin, pmax, milessel, sortsel, statussel);
  app.appendChild(extra);
  app.appendChild(make("div", { className: "small-muted market-fee-hint" }, "Peer-to-peer checkout. Seller gets the listed price. Buyer pays a 6.9% service fee ($0.49 min, $25 cap)."));

  const stream = make("div", { className: "feed-stream market-stream" });
  app.appendChild(stream);
  root.appendChild(app);

  function debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }
  function money(n) {
    const v = Number(n) || 0;
    if (v === 0) return "Free";
    return "$" + v.toLocaleString(undefined, { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
  }
  function viewerCoords() {
    try {
      const s = currentSession();
      const u = H.getUserById && s ? H.getUserById(s.userId) : null;
      if (u && u.lastLocation && Number.isFinite(u.lastLocation.lat)) return u.lastLocation;
    } catch (e) {}
    if (window.__lastGps && Number.isFinite(window.__lastGps.lat)) return window.__lastGps;
    return null;
  }

  search.addEventListener("input", debounce(() => { query = search.value.trim(); load(); }, 180));
  catsel.onchange = () => { cat = catsel.value; load(); };
  condsel.onchange = () => { condition = condsel.value; load(); };
  pmin.addEventListener("input", debounce(() => { minPrice = pmin.value; load(); }, 220));
  pmax.addEventListener("input", debounce(() => { maxPrice = pmax.value; load(); }, 220));
  milessel.onchange = () => { miles = milessel.value; load(); };
  sortsel.onchange = () => { sort = sortsel.value; load(); };
  statussel.onchange = () => { status = statussel.value; load(); };
  sellBtn.onclick = () => openComposer();

  async function load() {
    stream.innerHTML = "";
    stream.appendChild(make("div", { className: "small-muted" }, "Loading…"));
    const qs = new URLSearchParams();
    if (query) qs.set("q", query);
    if (cat) qs.set("category", cat);
    if (filter === "mine") qs.set("filter", "mine");
    if (filter === "saved") qs.set("filter", "saved");
    if (condition) qs.set("condition", condition);
    if (minPrice !== "") qs.set("minPrice", minPrice);
    if (maxPrice !== "") qs.set("maxPrice", maxPrice);
    if (miles) qs.set("miles", miles);
    if (sort) qs.set("sort", sort);
    if (filter !== "mine") qs.set("status", status);
    const loc = viewerCoords();
    if (loc) { qs.set("lat", String(loc.lat)); qs.set("lng", String(loc.lng)); }
    const j = await apiTry("/api/market?" + qs.toString());
    stream.innerHTML = "";
    const list = (j && j.listings) || [];
    if (!list.length) {
      stream.appendChild(make("div", { className: "feed-empty" }, filter === "mine" ? "You have not listed anything yet." : "No listings match. Widen the filters or tap Sell."));
      return;
    }
    list.forEach((l) => stream.appendChild(card(l)));
  }

  function card(l) {
    const el = make("div", { className: "feed-card market-card" + (l.status === "sold" ? " is-sold" : "") + (l.demo ? " is-demo" : "") });
    el.dataset.id = l.id;
    const headRow = make("div", { className: "feed-head" });
    const av = make("div", { className: "chat-avatar", style: "width:36px;height:36px;flex:0 0 36px;font-size:12px" });
    av.innerHTML = getAvatarFor({ id: l.sellerId, name: l.sellerName, profileImage: l.sellerAvatar });
    const meta = make("div", { style: "flex:1;min-width:0" });
    const nameRow = make("div", { style: "font-weight:800;display:flex;align-items:center;gap:6px;flex-wrap:wrap" }, l.sellerName || "Seller");
    if (l.demo) nameRow.appendChild(make("span", { className: "market-demo-pill" }, "Demo listing"));
    if (l.status === "sold") nameRow.appendChild(make("span", { className: "market-sold-pill" }, "Sold"));
    meta.appendChild(nameRow);
    const bits = [l.city || "Nearby", l.category || "other", condLabel(l.condition)];
    if (l.miles != null) bits.push(l.miles < 1 ? "Under 1 mi" : l.miles + " mi");
    meta.appendChild(make("div", { className: "small-muted" }, bits.filter(Boolean).join(" · ")));
    headRow.append(av, meta);
    el.appendChild(headRow);
    el.appendChild(make("div", { className: "market-price" }, money(l.price)));
    el.appendChild(make("div", { className: "feed-text", style: "font-weight:800" }, l.title || ""));
    if (l.desc) el.appendChild(make("div", { className: "feed-text" }, l.desc));
    if (l.media && l.media[0] && l.media[0].url) {
      const img = make("img", { className: "feed-img", src: l.media[0].url, alt: "" });
      el.appendChild(img);
    }
    const acts = make("div", { className: "feed-actions" });
    if (!l.mine) {
      if (l.status !== "sold") {
        const buy = make("button", { className: "feed-act", type: "button" }, l.price ? "Buy" : "Claim");
        buy.onclick = () => openCheckout(l);
        acts.appendChild(buy);
        const msg = make("button", { className: "feed-act", type: "button" }, "Message");
        msg.onclick = async () => {
          const r = await apiTry("/api/market/" + encodeURIComponent(l.id) + "/message", { method: "POST", body: {} });
          if (!r || !r.to) return uiNotice((r && r.error) || "Cannot message this seller.");
          if (typeof H.closeMarketPanel === "function") H.closeMarketPanel();
          if (typeof H.renderMessagesForUser === "function") H.renderMessagesForUser(r.to);
        };
        const offer = make("button", { className: "feed-act", type: "button" }, "Offer");
        offer.onclick = async () => {
          const amt = await (window.f360 && window.f360.askText ? window.f360.askText("Your offer in USD", String(l.price || "")) : Promise.resolve(""));
          if (amt == null || amt === "") return;
          const r = await apiTry("/api/market/" + encodeURIComponent(l.id) + "/offer", { method: "POST", body: { amount: Number(amt) } });
          if (r && r.ok) uiNotice("Offer sent — seller is notified.");
          else uiNotice((r && r.error) || "Could not send offer.");
        };
        acts.append(msg, offer);
      }
      const save = make("button", { className: "feed-act" + (l.saved ? " on" : ""), type: "button" }, l.saved ? "Saved" : "Save");
      save.onclick = async () => {
        const r = await apiTry("/api/market/" + encodeURIComponent(l.id) + "/save", { method: "POST", body: {} });
        if (r) { save.textContent = r.saved ? "Saved" : "Save"; save.classList.toggle("on", !!r.saved); }
      };
      const more = make("button", { className: "feed-act", type: "button" }, "Report");
      more.onclick = () => {
        if (typeof H.renderReportUser === "function") H.renderReportUser(l.sellerId, { listingId: l.id });
      };
      acts.append(save, more);
    } else {
      const sold = make("button", { className: "feed-act", type: "button" }, l.status === "sold" ? "Relist" : "Mark sold");
      sold.onclick = async () => {
        await apiTry("/api/market/" + encodeURIComponent(l.id), { method: "PATCH", body: { status: l.status === "sold" ? "active" : "sold" } });
        load();
      };
      const del = make("button", { className: "feed-act", type: "button" }, "Delete");
      del.onclick = async () => {
        if (window.f360 && window.f360.ask && !(await window.f360.ask("Delete this listing?"))) return;
        await apiTry("/api/market/" + encodeURIComponent(l.id), { method: "DELETE" });
        load();
      };
      acts.append(sold, del);
    }
    el.appendChild(acts);
    return el;
  }

  async function openCheckout(l) {
    if (!l.price) {
      uiNotice("This one is free — message the seller to arrange pickup.");
      return;
    }
    const qj = await apiTry("/api/pay/quote", { method: "POST", body: { amount: l.price } });
    const quote = (qj && qj.quote) || { item: l.price, fee: Math.max(0.49, Math.round(l.price * 0.069 * 100) / 100), total: 0, sellerReceives: l.price, percentLabel: "6.9%" };
    if (!quote.total) quote.total = Math.round((quote.item + quote.fee) * 100) / 100;
    const wallet = await apiTry("/api/pay/wallet");
    const methods = (wallet && wallet.methods) || [];
    const wrap = make("div");
    wrap.appendChild(make("div", { className: "help-kicker" }, "Peer-to-peer"));
    wrap.appendChild(make("h3", {}, l.demo ? "Pay (demo listing)" : "Pay seller"));
    if (l.demo) wrap.appendChild(make("p", { className: "small-muted" }, "This is a demo listing so you can see checkout. No real item ships."));
    wrap.appendChild(make("p", {}, l.title + " — " + money(l.price)));
    const br = make("div", { className: "market-breakdown" });
    br.appendChild(make("div", {}, "Item " + money(quote.item)));
    br.appendChild(make("div", {}, "Service fee " + (quote.percentLabel || feeInfo.percentLabel) + "  " + money(quote.fee)));
    br.appendChild(make("div", { style: "font-weight:800" }, "You pay " + money(quote.total)));
    br.appendChild(make("div", { className: "small-muted" }, "Seller receives " + money(quote.sellerReceives) + " — the listed price, in full."));
    wrap.appendChild(br);
    if (!methods.length) {
      wrap.appendChild(make("p", { className: "small-muted" }, "Add a card in Wallet first. We never store a full card number."));
      const goW = make("button", { className: "btn", type: "button" }, "Open wallet");
      goW.onclick = () => {
        if (typeof H.closeModal === "function") H.closeModal();
        if (typeof H.renderWallet === "function") H.renderWallet();
      };
      wrap.appendChild(make("div", { className: "row", style: "margin-top:10px;justify-content:flex-end" }, goW));
      if (typeof H.showModal === "function") H.showModal(wrap, { variant: "form" });
      return;
    }
    const sel = make("select", { className: "input" });
    methods.forEach((m) => sel.appendChild(make("option", { value: m.id }, (m.brand || "card").toUpperCase() + " •••• " + m.last4)));
    wrap.appendChild(sel);
    const pay = make("button", { className: "btn", type: "button" }, "Pay " + money(quote.total));
    pay.onclick = async () => {
      try {
        const r = await api("/api/pay/p2p", { method: "POST", body: { listingId: l.id, amount: quote.item, methodId: sel.value } });
        if (r && r.ok) {
          uiNotice("Paid. Seller is notified. The listing is marked sold.");
          if (typeof H.closeModal === "function") H.closeModal();
          load();
        }
      } catch (e) { uiNotice(e.message || "Payment failed"); }
    };
    wrap.appendChild(make("div", { className: "row", style: "margin-top:10px;justify-content:flex-end" }, pay));
    if (typeof H.showModal === "function") H.showModal(wrap, { variant: "form" });
  }

  function openComposer() {
    const wrap = make("div");
    wrap.appendChild(make("h3", {}, "Sell an item"));
    wrap.appendChild(make("p", { className: "small-muted" }, "Photos upload to this server. Chats stay end-to-end encrypted. Precise GPS is never stored on a listing. When someone pays, you receive the listed price; they pay a 6.9% service fee."));
    const title = make("input", { className: "input", placeholder: "Title" });
    const price = make("input", { className: "input", type: "number", min: "0", step: "1", placeholder: "Price (0 = free)" });
    const city = make("input", { className: "input", placeholder: "City / neighborhood" });
    const desc = make("textarea", { className: "input", placeholder: "Description", style: "min-height:72px" });
    const catEl = make("select", { className: "input" });
    ["furniture", "electronics", "clothing", "vehicles", "home", "services", "free", "other"].forEach((c) => {
      catEl.appendChild(make("option", { value: c }, c));
    });
    const cond = make("select", { className: "input" });
    [["new", "New"], ["like_new", "Like new"], ["good", "Good"], ["fair", "Fair"], ["for_parts", "For parts"]].forEach(([v, l]) => {
      cond.appendChild(make("option", { value: v }, l));
    });
    const file = make("input", { type: "file", accept: "image/*" });
    let media = [];
    const preview = make("div", { className: "feed-attach-preview" });
    file.onchange = async () => {
      const f = file.files && file.files[0];
      if (!f) return;
      try {
        const up = await uploadMedia(f);
        if (up && up.url) {
          media = [{ kind: "image", url: up.url }];
          preview.innerHTML = "";
          const img = document.createElement("img");
          img.src = up.url;
          img.style.cssText = "width:84px;height:84px;object-fit:cover;border-radius:10px";
          preview.appendChild(img);
        }
      } catch (e) { uiNotice(e.message || "Upload failed"); }
    };
    const post = make("button", { className: "btn", type: "button" }, "Publish listing");
    post.onclick = async () => {
      try {
        const j = await api("/api/market", {
          method: "POST",
          body: {
            title: title.value, desc: desc.value, price: Number(price.value || 0),
            category: catEl.value, condition: cond.value, city: city.value, media
          }
        });
        if (j && j.listing) {
          uiNotice("Listed: " + j.listing.title);
          if (typeof H.closeModal === "function") H.closeModal();
          filter = "mine";
          load();
        }
      } catch (e) { uiNotice(e.message || "Could not publish"); }
    };
    wrap.append(title, price, city, catEl, cond, desc, file, preview, make("div", { className: "row", style: "margin-top:10px;justify-content:flex-end" }, post));
    if (typeof H.showModal === "function") H.showModal(wrap, { variant: "form" });
  }

  window.__refreshMarket = (msg) => {
    if (!msg) return load();
    if (msg.action === "new" && msg.listing && filter === "all") {
      const empty = stream.querySelector(".feed-empty");
      if (empty) stream.innerHTML = "";
      stream.insertBefore(card(msg.listing), stream.firstChild);
    } else load();
  };

  const cfg = await apiTry("/api/config");
  if (cfg && cfg.feePercent) feeInfo.rate = cfg.feePercent;
  await load();
}

export function bindMarket(H) {
  return { mountMarketplace };
}
