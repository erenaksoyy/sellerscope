import test from "node:test";
import assert from "node:assert/strict";
import { fold, ruleQuery, ruleMatches, createAi } from "./tr-match.js";

const listing = (title, price = 1000) => ({ source: "amazon_tr", title, url: `https://x/${encodeURIComponent(title)}`, price });

test("fold: küçük harf, aksansız (Türkçe ve Almanca)", () => {
  assert.equal(fold("Kulak İÇİ Kulaklık ıslak Größe Pokémon"), "kulak ici kulaklik islak grosse pokemon");
});

test("ruleQuery: marka + adın başı; ayraçta kesilir, ölçü ve dolgu kelimeleri atılır", () => {
  assert.equal(ruleQuery({ title: "JBL Vibe Beam 2 - Noise Cancelling Earbuds - Black", brand: "JBL" }), "jbl vibe beam 2");
  assert.equal(
    ruleQuery({ title: "Apple AirPods Pro 3 Wireless Earbuds with Active Noise Cancellation", brand: "Apple" }),
    "apple airpods pro 3 wireless"
  );
  // Marka bilinmiyorsa başlığın ilk kelimesi marka sayılır.
  assert.equal(
    ruleQuery({ title: "Pokémon-Sammelkartenspiel: Top-Trainer-Box 30 Jahre", brand: null }),
    "pokemon sammelkartenspiel"
  );
  assert.equal(ruleQuery({ title: "HydroJug Traveler 40oz Insulated Tumbler for Gym", brand: "HydroJug" }), "hydrojug traveler insulated tumbler gym");
  // Marka başlıkta geçmiyorsa başa eklenir.
  assert.equal(ruleQuery({ title: "Echo Dot Kids", brand: "Amazon" }), "amazon echo dot kids");
});

test("ruleMatches: marka + model TR ilanında geçiyorsa 'aynı ürün'", () => {
  const product = { title: "JBL Vibe Beam 2 - Noise Cancelling Earbuds - Black", brand: "JBL" };
  const results = [
    listing("JBL Vibe Beam2 TWS Kablosuz Kulak İçi Kulaklık - Beyaz", 2699), // "Beam 2" = "Beam2"
    listing("JBL Wave Beam2, Kablosuz Kulakiçi Kulaklık", 2499), // başka model
    listing("Sony WF-C510 Kablosuz Kulaklık", 1999), // başka marka
    listing("Jbl vibe beam 2 uyumlu silikon kılıf", 150), // aksesuar: çok ucuz
  ];
  assert.deepEqual(ruleMatches(product, results, 39 * 49), [0]);
  // TL karşılığı bilinmiyorsa fiyat elemesi yapılamaz.
  assert.deepEqual(ruleMatches(product, results, null), [0, 3]);
});

test("ruleMatches: model kodu eşleşmesi; marka yoksa ya da ad çok kısaysa karar yok", () => {
  const lego = { title: "LEGO Star Wars Advent Calendar 2026 75456 | Christmas", brand: null };
  assert.deepEqual(ruleMatches(lego, [listing("LEGO 75456 Yılbaşı Takvimi"), listing("Lego City 60400")]), [0]);
  // Jenerik ürün: Türkçe ilanlarla kelime kelime tutmaz -> kural susar ("yok" demez).
  const generic = { title: "Full Motion TV Wall Mount for 32-70 Inch TVs", brand: "Pipishell" };
  assert.deepEqual(ruleMatches(generic, [listing("Hareketli TV Duvar Askı Aparatı 32-70 inç")]), []);
  assert.deepEqual(ruleMatches({ title: "Slime", brand: null }, [listing("Slime")]), []);
  assert.deepEqual(ruleMatches({ title: "30 Pack Squishy Toys", brand: null }, [listing("30 Pack Squishy Toys")]), []);
});

test("createAi.queries: toplu çağrı, kimlik eşlemesi, bozuk öğeler atlanır", async () => {
  const calls = [];
  const ask = async (req) => {
    calls.push(req);
    const batch = JSON.parse(req.prompt);
    return {
      items: [
        ...batch.map((b) => ({ i: b.i, brand: " Acme ", model: `  ${b.title}   X1 `, generic: `tür   ${b.title}` })),
        { i: 999, brand: "Yok", model: "", generic: "olmayan ürün" }, { i: 0 }, // geçersiz öğeler
      ],
    };
  };
  const products = Array.from({ length: 23 }, (_, n) => ({ id: `id-${n}`, title: `T${n}`, brand: null }));
  const queries = await createAi({ ask }).queries(products);
  assert.equal(calls.length, 2); // 20'lik gruplar
  assert.equal(calls[0].task, "queries"); // arama ifadesi zinciri
  assert.deepEqual(JSON.parse(calls[1].prompt).map((b) => b.i), [0, 1, 2]);
  assert.equal(queries.size, 23);
  assert.deepEqual(queries.get("id-21"), { exact: "Acme T21 X1", generic: "tür T21" });
});

test("createAi.queries: model yoksa marka + ürün türü; marka yoksa yalnız ürün türü", async () => {
  const items = [
    { i: 0, brand: "Amazon Basics", model: "", generic: "alkali kalem pil" },
    { i: 1, brand: "", model: "", generic: "yumuşak stres oyuncağı" },
    { i: 2, brand: "De'Longhi", model: "EcoDecalk", generic: "" },
    { i: 3, brand: "", model: "X200", generic: "" }, // aranacak bir şey yok
  ];
  const products = items.map((it) => ({ id: `p${it.i}`, title: "T", brand: null }));
  const queries = await createAi({ ask: async () => ({ items }) }).queries(products);
  assert.deepEqual([...queries], [
    ["p0", { exact: "Amazon Basics alkali kalem pil", generic: "alkali kalem pil" }],
    ["p1", { exact: null, generic: "yumuşak stres oyuncağı" }],
    ["p2", { exact: "De'Longhi EcoDecalk", generic: null }],
  ]);
});

test("createAi.judge: aynı > benzer > yok; eksik yanıt hata (yanlış 'yok' üretilmez)", async () => {
  const product = { title: "Roku Streaming Stick HD", brand: "Roku", price: 19.99, currency: "USD" };
  const results = [listing("Roku Streaming Stick 4K"), listing("Q96 TV Stick"), listing("HDMI kablo")];
  const tasks = [];
  const answer = (verdicts) => createAi({
    ask: async (req) => {
      tasks.push(req.task);
      return { verdicts };
    },
  }).judge(product, results);

  assert.deepEqual(
    await answer([{ i: 0, kind: "same" }, { i: 1, kind: "similar" }, { i: 2, kind: "different" }]),
    { status: "found", kinds: ["same", "similar", "different"] }
  );
  assert.equal((await answer([{ i: 0, kind: "different" }, { i: 1, kind: "similar" }, { i: 2, kind: "different" }])).status, "similar");
  assert.equal((await answer([0, 1, 2].map((i) => ({ i, kind: "different" })))).status, "not_found");
  await assert.rejects(answer([{ i: 0, kind: "different" }]), /eksik/);
  await assert.rejects(answer([0, 1, 2].map((i) => ({ i, kind: "belki" }))), /eksik/);
  assert.ok(tasks.every((t) => t === "judge")); // ilan kararı zinciri
});
