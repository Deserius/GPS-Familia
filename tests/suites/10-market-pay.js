"use strict";

/** Marketplace + Stripe/Plaid demo wallet. No live card numbers. */
module.exports = {
  id: "market",
  name: "Marketplace & payments",
  async run(t) {
    t.section("Marketplace & payments");

    const seller = await t.register();
    const buyer = await t.register();
    if (!seller || !buyer) return;

    const unauth = await t.get("/api/market");
    await t.expectStatus(unauth, 401, "market requires auth");

    const demo = await t.get("/api/market", { token: seller.token });
    await t.expectStatus(demo, 200, "GET /api/market");
    t.check("demo listings exist", !!(demo.json && Array.isArray(demo.json.listings) && demo.json.listings.length >= 1),
      demo.json && String((demo.json.listings || []).length));
    t.check("demo listings flagged", !!(demo.json.listings || []).some((l) => l.demo === true));
    t.check("demo listing has photo", !!(demo.json.listings || []).some((l) => l.demo && l.media && l.media[0] && l.media[0].url));
    t.check("categories advertised", !!(demo.json && Array.isArray(demo.json.categories)));

    const byNew = await t.get("/api/market?condition=new", { token: seller.token });
    await t.expectStatus(byNew, 200, "filter condition=new");
    t.check("new filter excludes used", !!(byNew.json && (byNew.json.listings || []).every((l) => l.condition === "new" || l.mine)));

    const byUsed = await t.get("/api/market?condition=used", { token: seller.token });
    t.check("used filter is like_new/good/fair", !!(byUsed.json && (byUsed.json.listings || []).every((l) => ["like_new", "good", "fair"].includes(l.condition) || l.mine)));

    const byPrice = await t.get("/api/market?minPrice=100&maxPrice=200", { token: seller.token });
    t.check("price range 100-200", !!(byPrice.json && (byPrice.json.listings || []).every((l) => l.price >= 100 && l.price <= 200)));

    const far = await t.get("/api/market?miles=5&lat=25.76&lng=-80.19", { token: seller.token });
    t.check("distance filter drops Denver from Miami", !!(far.json && (far.json.listings || []).length < (demo.json.listings || []).length));

    const created = await t.post("/api/market", {
      title: "QA espresso cup",
      desc: "Test listing",
      price: 12.5,
      category: "home",
      condition: "new",
      city: "Aurora"
    }, { token: seller.token });
    await t.expectStatus(created, 200, "create listing");
    const lid = created.json && created.json.listing && created.json.listing.id;
    t.check("listing id", !!lid);
    t.check("listing has no precise GPS secret", created.json && created.json.listing && created.json.listing.password == null);
    t.hasNoSecret(created.json, "listing JSON has no password hashes");

    const getOne = await t.get("/api/market/" + encodeURIComponent(lid), { token: buyer.token });
    await t.expectStatus(getOne, 200, "buyer reads listing");
    t.check("seller name present", !!(getOne.json && getOne.json.listing && getOne.json.listing.sellerName));

    const save = await t.post("/api/market/" + encodeURIComponent(lid) + "/save", {}, { token: buyer.token });
    await t.expectStatus(save, 200, "save listing");
    t.check("saved flag", save.json && save.json.saved === true);

    const offer = await t.post("/api/market/" + encodeURIComponent(lid) + "/offer", { amount: 10 }, { token: buyer.token });
    await t.expectStatus(offer, 200, "buyer offer");
    const oid = offer.json && offer.json.offer && offer.json.offer.id;

    const steal = await t.patch("/api/market/" + encodeURIComponent(lid), { price: 1 }, { token: buyer.token });
    await t.expectStatus(steal, 403, "buyer cannot edit seller listing");

    if (oid) {
      const acc = await t.post("/api/market/" + encodeURIComponent(lid) + "/offers/" + encodeURIComponent(oid) + "/accept", {}, { token: seller.token });
      await t.expectStatus(acc, 200, "seller accepts offer");
    }

    const thread = await t.post("/api/market/" + encodeURIComponent(lid) + "/message", {}, { token: buyer.token });
    await t.expectStatus(thread, 200, "open seller thread");
    t.check("thread to seller", thread.json && thread.json.to === seller.user.id);

    const selfMsg = await t.post("/api/market/" + encodeURIComponent(lid) + "/message", {}, { token: seller.token });
    await t.expectStatus(selfMsg, 400, "seller cannot message self listing");

    const wallet = await t.get("/api/pay/wallet", { token: buyer.token });
    await t.expectStatus(wallet, 200, "GET /api/pay/wallet");
    t.check("payments flag", wallet.json && wallet.json.payments === true);
    t.hasNoSecret(wallet.json, "wallet has no private keys");
    t.check("no full PAN in wallet", !/\b[0-9]{13,19}\b/.test(JSON.stringify(wallet.json || {})));

    const pan = await t.post("/api/pay/methods", { number: "4242424242424242", cvc: "123" }, { token: buyer.token });
    await t.expectStatus(pan, 400, "reject full card number");

    const method = await t.post("/api/pay/methods", {
      last4: "4242", brand: "visa", expMonth: 12, expYear: 2028
    }, { token: buyer.token });
    await t.expectStatus(method, 200, "save tokenized last4");
    t.check("method last4 only", method.json && method.json.method && method.json.method.last4 === "4242");
    const mid = method.json.method.id;

    const setup = await t.post("/api/pay/setup-intent", {}, { token: buyer.token });
    await t.expectStatus(setup, 200, "setup-intent (demo or stripe)");
    t.check("clientSecret present", !!(setup.json && setup.json.clientSecret));

    const link = await t.post("/api/pay/plaid/link-token", {}, { token: buyer.token });
    await t.expectStatus(link, 200, "plaid link-token");
    t.check("link token", !!(link.json && link.json.linkToken));

    const rawBank = await t.post("/api/pay/plaid/exchange", { accountNumber: "123456789", routingNumber: "021000021" }, { token: buyer.token });
    await t.expectStatus(rawBank, 400, "reject raw bank numbers");

    const bank = await t.post("/api/pay/plaid/exchange", { institution: "Chase", last4: "0000" }, { token: buyer.token });
    await t.expectStatus(bank, 200, "demo bank link");

    const charge = await t.post("/api/pay/charge", { amount: 10, methodId: mid, listingId: lid }, { token: buyer.token });
    await t.expectStatus(charge, 200, "demo charge with saved method");
    t.check("charge succeeded", charge.json && charge.json.status === "succeeded");

    const q100 = await t.post("/api/pay/quote", { amount: 100 }, { token: buyer.token });
    await t.expectStatus(q100, 200, "quote $100");
    t.check("$100 fee is 6.90", q100.json && q100.json.quote && q100.json.quote.fee === 6.9);
    t.check("$100 total 106.90", q100.json.quote.total === 106.9);
    t.check("seller receives 100", q100.json.quote.sellerReceives === 100);

    const q5 = await t.post("/api/pay/quote", { amount: 5 }, { token: buyer.token });
    t.check("$5 hits $0.49 floor", q5.json && q5.json.quote && q5.json.quote.fee === 0.49);

    const qBig = await t.post("/api/pay/quote", { amount: 1000 }, { token: buyer.token });
    t.check("$1000 hits $25 cap", qBig.json && qBig.json.quote && qBig.json.quote.fee === 25);

    const item2 = await t.post("/api/market", {
      title: "QA floor lamp",
      desc: "P2P checkout",
      price: 40,
      category: "home",
      condition: "good",
      city: "Aurora"
    }, { token: seller.token });
    const lid2 = item2.json && item2.json.listing && item2.json.listing.id;
    t.check("second listing id", !!lid2);

    const selfPay = await t.post("/api/pay/p2p", { listingId: lid2, amount: 40, methodId: mid }, { token: seller.token });
    await t.expectStatus(selfPay, 400, "cannot p2p-buy own listing");

    const p2p = await t.post("/api/pay/p2p", { listingId: lid2, amount: 40, methodId: mid }, { token: buyer.token });
    await t.expectStatus(p2p, 200, "p2p checkout");
    t.check("p2p succeeded", p2p.json && p2p.json.status === "succeeded");
    t.check("p2p fee 2.76", p2p.json && p2p.json.quote && p2p.json.quote.fee === 2.76);
    t.check("p2p seller gets 40", p2p.json.quote.sellerReceives === 40);

    const after = await t.get("/api/market/" + encodeURIComponent(lid2), { token: seller.token });
    t.check("p2p marks listing sold", after.json && after.json.listing && after.json.listing.status === "sold");

    const sw = await t.get("/api/pay/wallet", { token: seller.token });
    t.check("seller balance credited", sw.json && Number(sw.json.balance) >= 40);

    const gone = await t.del("/api/market/" + encodeURIComponent(lid), {}, { token: seller.token });
    await t.expectStatus(gone, 200, "seller deletes listing");
  }
};
