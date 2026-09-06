"use strict";

/**
 * Wallet: Stripe cards + Plaid bank links.
 * Full PAN / CVV / account+routing numbers are NEVER stored.
 * Without live keys, a PCI-safe demo vault still lets the UI and tests run.
 */

function stripeKey() {
  return String(process.env.STRIPE_SECRET_KEY || "").trim();
}
function stripePk() {
  return String(process.env.STRIPE_PUBLISHABLE_KEY || "").trim();
}
function plaidId() {
  return String(process.env.PLAID_CLIENT_ID || "").trim();
}
function plaidSecret() {
  return String(process.env.PLAID_SECRET || "").trim();
}
function plaidEnv() {
  const e = String(process.env.PLAID_ENV || "sandbox").toLowerCase();
  return e === "production" || e === "development" ? e : "sandbox";
}
function plaidHost() {
  return "https://" + plaidEnv() + ".plaid.com";
}

function walletOf(DB, userId) {
  DB.wallets = DB.wallets && typeof DB.wallets === "object" ? DB.wallets : {};
  if (!DB.wallets[userId]) {
    DB.wallets[userId] = { methods: [], banks: [], stripeCustomerId: "", createdAt: Date.now() };
  }
  return DB.wallets[userId];
}

function publicMethod(m) {
  return {
    id: m.id,
    brand: m.brand,
    last4: m.last4,
    expMonth: m.expMonth,
    expYear: m.expYear,
    source: m.source,
    createdAt: m.createdAt
  };
}
function publicBank(b) {
  return {
    id: b.id,
    name: b.name,
    last4: b.last4,
    subtype: b.subtype || "checking",
    source: b.source,
    createdAt: b.createdAt
  };
}

async function stripeForm(path, params) {
  const key = stripeKey();
  if (!key) return null;
  const body = new URLSearchParams();
  Object.keys(params || {}).forEach((k) => {
    const v = params[k];
    if (v == null || v === "") return;
    body.set(k, String(v));
  });
  const res = await fetch("https://api.stripe.com/v1" + path, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((json.error && json.error.message) || "stripe error");
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

async function plaidPost(path, payload) {
  if (!plaidId() || !plaidSecret()) return null;
  const res = await fetch(plaidHost() + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(Object.assign({
      client_id: plaidId(),
      secret: plaidSecret()
    }, payload || {}))
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((json.error_message) || (json.error_code) || "plaid error");
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

/** Buyer-side marketplace take-rate.
 *  6.9% matches OfferUp / typical goods-and-services rails.
 *  Seller receives 100% of the agreed item price.
 *  Fee covers card processing (~2.9% + $0.30) plus ~3–4% platform margin.
 *  Floor $0.49 so cheap items still cover processing; cap $25 so big tickets stay fair.
 */
const FEE_RATE = 0.069;
const FEE_MIN = 0.49;
const FEE_CAP = 25;

function quoteFee(amount) {
  const item = Math.round(Number(amount) * 100) / 100;
  if (!Number.isFinite(item) || item <= 0) {
    return {
      item: 0, fee: 0, total: 0, sellerReceives: 0,
      rate: FEE_RATE, min: FEE_MIN, cap: FEE_CAP, payer: "buyer", percentLabel: "6.9%"
    };
  }
  let fee = Math.round(item * FEE_RATE * 100) / 100;
  if (fee < FEE_MIN) fee = FEE_MIN;
  if (fee > FEE_CAP) fee = FEE_CAP;
  const total = Math.round((item + fee) * 100) / 100;
  return {
    item, fee, total, sellerReceives: item,
    rate: FEE_RATE, min: FEE_MIN, cap: FEE_CAP, payer: "buyer", percentLabel: "6.9%"
  };
}

function configSnippet() {
  return {
    payments: true,
    p2p: true,
    stripe: !!stripePk(),
    stripePublishable: stripePk() || "",
    plaid: !!(plaidId() && plaidSecret()),
    plaidEnv: plaidEnv(),
    demoWallet: !(stripeKey() && stripePk()),
    feePercent: FEE_RATE,
    feeMin: FEE_MIN,
    feeCap: FEE_CAP,
    feePayer: "buyer"
  };
}

function attach(ctx) {
  const { app, DB, saveData, auth, makeId, now, DEMO } = ctx;

  app.get("/api/pay/wallet", auth, (req, res) => {
    const w = walletOf(DB, req.userId);
    res.json({
      ok: true,
      ...configSnippet(),
      balance: Math.round(Number(w.balance || 0) * 100) / 100,
      methods: (w.methods || []).map(publicMethod),
      banks: (w.banks || []).map(publicBank)
    });
  });

  app.get("/api/pay/quote", auth, (req, res) => {
    const amount = Number(req.query.amount != null ? req.query.amount : (req.body && req.body.amount));
    res.json({ ok: true, quote: quoteFee(amount) });
  });

  app.post("/api/pay/quote", auth, (req, res) => {
    const amount = Number((req.body || {}).amount);
    res.json({ ok: true, quote: quoteFee(amount) });
  });

  app.post("/api/pay/setup-intent", auth, async (req, res) => {
    try {
      if (stripeKey()) {
        const w = walletOf(DB, req.userId);
        if (!w.stripeCustomerId) {
          const cust = await stripeForm("/customers", {
            email: req.user.email || undefined,
            name: req.user.name || undefined,
            "metadata[userId]": req.userId
          });
          if (cust && cust.id) {
            w.stripeCustomerId = cust.id;
            saveData();
          }
        }
        const si = await stripeForm("/setup_intents", {
          customer: w.stripeCustomerId || undefined,
          usage: "off_session"
        });
        return res.json({ ok: true, clientSecret: si.client_secret, demo: false });
      }
      res.json({ ok: true, clientSecret: "seti_demo_" + makeId("si"), demo: true });
    } catch (e) {
      res.status(e.status || 502).json({ error: e.message || "stripe setup failed" });
    }
  });

  app.post("/api/pay/methods", auth, async (req, res) => {
    const b = req.body || {};
    if (b.number && String(b.number).replace(/\D/g, "").length > 4) {
      return res.status(400).json({ error: "do not send full card numbers — use Stripe.js or last4 only" });
    }
    if (b.cvc || b.cvv) {
      return res.status(400).json({ error: "do not send CVC" });
    }
    const w = walletOf(DB, req.userId);
    try {
      if (b.paymentMethodId && stripeKey()) {
        const pmId = String(b.paymentMethodId);
        if (w.stripeCustomerId) {
          await stripeForm("/payment_methods/" + encodeURIComponent(pmId) + "/attach", {
            customer: w.stripeCustomerId
          });
        }
        const pm = await stripeForm("/payment_methods/" + encodeURIComponent(pmId), {});
        const card = (pm && pm.card) || {};
        const rec = {
          id: pm.id || makeId("pm"),
          brand: card.brand || "card",
          last4: card.last4 || "0000",
          expMonth: card.exp_month || 0,
          expYear: card.exp_year || 0,
          source: "stripe",
          stripePaymentMethodId: pm.id,
          createdAt: now()
        };
        w.methods = w.methods || [];
        w.methods.push(rec);
        saveData();
        return res.json({ ok: true, method: publicMethod(rec) });
      }
      const last4 = String(b.last4 || "").replace(/\D/g, "").slice(-4);
      if (last4.length !== 4) return res.status(400).json({ error: "last4 required (4 digits)" });
      const expMonth = Number(b.expMonth || b.exp_month);
      const expYear = Number(b.expYear || b.exp_year);
      if (!(expMonth >= 1 && expMonth <= 12) || !(expYear >= 2024 && expYear <= 2100)) {
        return res.status(400).json({ error: "valid expiry required" });
      }
      const rec = {
        id: makeId("pm"),
        brand: String(b.brand || "visa").toLowerCase().slice(0, 16),
        last4,
        expMonth,
        expYear,
        source: stripeKey() ? "stripe" : "demo",
        createdAt: now()
      };
      w.methods = w.methods || [];
      w.methods.push(rec);
      saveData();
      res.json({ ok: true, method: publicMethod(rec), demo: rec.source === "demo" });
    } catch (e) {
      res.status(e.status || 502).json({ error: e.message || "could not save card" });
    }
  });

  app.delete("/api/pay/methods/:id", auth, (req, res) => {
    const w = walletOf(DB, req.userId);
    const before = (w.methods || []).length;
    w.methods = (w.methods || []).filter((m) => m.id !== req.params.id);
    if (w.methods.length === before) return res.status(404).json({ error: "not found" });
    saveData();
    res.json({ ok: true });
  });

  app.post("/api/pay/plaid/link-token", auth, async (req, res) => {
    try {
      const live = await plaidPost("/link/token/create", {
        user: { client_user_id: req.userId },
        client_name: "GPS FAMILIA",
        products: ["auth"],
        country_codes: ["US"],
        language: "en"
      });
      if (live && live.link_token) {
        return res.json({ ok: true, linkToken: live.link_token, demo: false });
      }
      res.json({
        ok: true,
        linkToken: "link-sandbox-demo-" + makeId("plaid"),
        demo: true,
        institutions: [
          { id: "ins_demo_chase", name: "Chase" },
          { id: "ins_demo_wells", name: "Wells Fargo" },
          { id: "ins_demo_bofa", name: "Bank of America" },
          { id: "ins_demo_citi", name: "Citi" }
        ]
      });
    } catch (e) {
      res.status(e.status || 502).json({ error: e.message || "plaid link failed" });
    }
  });

  app.post("/api/pay/plaid/exchange", auth, async (req, res) => {
    const b = req.body || {};
    if (b.accountNumber || b.routingNumber) {
      return res.status(400).json({ error: "do not send raw bank account numbers — use Plaid Link" });
    }
    const w = walletOf(DB, req.userId);
    try {
      if (b.public_token && plaidSecret()) {
        const ex = await plaidPost("/item/public_token/exchange", { public_token: b.public_token });
        let last4 = "0000", name = "Bank", subtype = "checking";
        if (ex && ex.access_token) {
          const auth = await plaidPost("/auth/get", { access_token: ex.access_token });
          const acct = auth && auth.accounts && auth.accounts[0];
          if (acct) {
            name = acct.name || acct.official_name || "Bank";
            last4 = String((acct.mask || "0000")).slice(-4);
            subtype = acct.subtype || "checking";
          }
        }
        const rec = {
          id: makeId("bk"),
          name,
          last4,
          subtype,
          source: "plaid",
          itemId: ex.item_id || "",
          createdAt: now()
        };
        w.banks = w.banks || [];
        w.banks.push(rec);
        saveData();
        return res.json({ ok: true, bank: publicBank(rec) });
      }
      const inst = String(b.institution || b.name || "Chase").slice(0, 40);
      const last4 = String(b.last4 || "0000").replace(/\D/g, "").slice(-4).padStart(4, "0");
      const rec = {
        id: makeId("bk"),
        name: inst,
        last4,
        subtype: String(b.subtype || "checking"),
        source: "demo",
        createdAt: now()
      };
      w.banks = w.banks || [];
      w.banks.push(rec);
      saveData();
      res.json({ ok: true, bank: publicBank(rec), demo: true });
    } catch (e) {
      res.status(e.status || 502).json({ error: e.message || "could not link bank" });
    }
  });

  app.delete("/api/pay/banks/:id", auth, (req, res) => {
    const w = walletOf(DB, req.userId);
    const before = (w.banks || []).length;
    w.banks = (w.banks || []).filter((m) => m.id !== req.params.id);
    if (w.banks.length === before) return res.status(404).json({ error: "not found" });
    saveData();
    res.json({ ok: true });
  });

  app.post("/api/pay/charge", auth, async (req, res) => {
    const b = req.body || {};
    const amount = Number(b.amount);
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "amount required" });
    const cents = Math.round(amount * 100);
    const methodId = String(b.methodId || "");
    const w = walletOf(DB, req.userId);
    const method = (w.methods || []).find((m) => m.id === methodId);
    if (!method) return res.status(400).json({ error: "saved card required" });
    try {
      if (stripeKey() && method.stripePaymentMethodId) {
        const pi = await stripeForm("/payment_intents", {
          amount: String(cents),
          currency: "usd",
          customer: w.stripeCustomerId || undefined,
          payment_method: method.stripePaymentMethodId,
          confirm: "true",
          off_session: "true",
          "metadata[listingId]": b.listingId || "",
          "metadata[userId]": req.userId
        });
        return res.json({
          ok: true,
          paymentId: pi.id,
          status: pi.status,
          amount: cents / 100,
          demo: false
        });
      }
      const rec = {
        id: makeId("pay"),
        amount: cents / 100,
        currency: "USD",
        methodId,
        listingId: b.listingId || null,
        status: "succeeded",
        source: "demo",
        createdAt: now()
      };
      w.payments = Array.isArray(w.payments) ? w.payments : [];
      w.payments.push(rec);
      saveData();
      res.json({ ok: true, paymentId: rec.id, status: "succeeded", amount: rec.amount, demo: true });
    } catch (e) {
      res.status(e.status || 502).json({ error: e.message || "charge failed" });
    }
  });

  app.post("/api/pay/p2p", auth, async (req, res) => {
    const b = req.body || {};
    const listingId = String(b.listingId || "");
    const listing = listingId && Array.isArray(DB.listings)
      ? DB.listings.find((l) => l.id === listingId)
      : null;
    if (listingId && !listing) return res.status(404).json({ error: "listing not found" });
    if (listing && listing.sellerId === req.userId) return res.status(400).json({ error: "cannot buy your own listing" });
    if (listing && listing.status === "sold") return res.status(400).json({ error: "already sold" });
    const itemAmt = listing && (b.amount == null || b.amount === "") ? Number(listing.price) : Number(b.amount);
    const quote = quoteFee(itemAmt);
    if (quote.item <= 0) return res.status(400).json({ error: "nothing to charge on a free listing" });
    const methodId = String(b.methodId || "");
    const buyerW = walletOf(DB, req.userId);
    const method = (buyerW.methods || []).find((m) => m.id === methodId);
    if (!method) return res.status(400).json({ error: "saved card required" });
    const sellerId = listing ? listing.sellerId : String(b.toUserId || "");
    if (!sellerId) return res.status(400).json({ error: "seller required" });
    const cents = Math.round(quote.total * 100);
    try {
      let paymentId = makeId("p2p");
      let status = "succeeded";
      let demo = true;
      if (stripeKey() && method.stripePaymentMethodId) {
        const pi = await stripeForm("/payment_intents", {
          amount: String(cents),
          currency: "usd",
          customer: buyerW.stripeCustomerId || undefined,
          payment_method: method.stripePaymentMethodId,
          confirm: "true",
          off_session: "true",
          "metadata[listingId]": listingId || "",
          "metadata[sellerId]": sellerId,
          "metadata[fee]": String(quote.fee),
          "metadata[kind]": "p2p"
        });
        paymentId = pi.id;
        status = pi.status || "succeeded";
        demo = false;
      }
      const sellerW = walletOf(DB, sellerId);
      sellerW.balance = Math.round((Number(sellerW.balance || 0) + quote.sellerReceives) * 100) / 100;
      sellerW.payouts = Array.isArray(sellerW.payouts) ? sellerW.payouts : [];
      sellerW.payouts.push({
        id: makeId("po"),
        amount: quote.sellerReceives,
        listingId: listingId || null,
        from: req.userId,
        status: "available",
        createdAt: now()
      });
      buyerW.payments = Array.isArray(buyerW.payments) ? buyerW.payments : [];
      buyerW.payments.push({
        id: paymentId,
        amount: quote.total,
        fee: quote.fee,
        item: quote.item,
        currency: "USD",
        methodId,
        listingId: listingId || null,
        to: sellerId,
        status,
        kind: "p2p",
        source: demo ? "demo" : "stripe",
        createdAt: now()
      });
      if (listing && status === "succeeded") {
        listing.status = "sold";
        listing.soldTo = req.userId;
        listing.soldAt = now();
        listing.updatedAt = now();
      }
      DB.transfers = Array.isArray(DB.transfers) ? DB.transfers : [];
      DB.transfers.push({
        id: makeId("tr"),
        from: req.userId,
        to: sellerId,
        listingId: listingId || null,
        item: quote.item,
        fee: quote.fee,
        total: quote.total,
        paymentId,
        demo,
        createdAt: now()
      });
      saveData();
      if (typeof ctx.sendToUser === "function") {
        ctx.sendToUser(sellerId, {
          type: "market",
          action: "sold",
          listingId: listingId || null,
          amount: quote.sellerReceives
        });
      }
      res.json({
        ok: true,
        paymentId,
        status,
        demo,
        quote,
        listingId: listingId || null
      });
    } catch (e) {
      res.status(e.status || 502).json({ error: e.message || "p2p payment failed" });
    }
  });
}

module.exports = { attach, configSnippet, stripePk, stripeKey, quoteFee };
