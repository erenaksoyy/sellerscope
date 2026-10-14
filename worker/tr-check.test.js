import test from "node:test";
import assert from "node:assert/strict";
import { runTrCheck } from "./tr-check.js";
import { QuotaError } from "./llm.js";

const product = (n, title, brand = null) => ({
  id: `p${n}`, title, brand, price: 40, currency: "USD", bestseller_rank: n, marketplace: "amazon_us",
});
const listing = (title, price, source = "amazon_tr") => ({
  source, title, url: `https://tr/${encodeURIComponent(title)}`, price, imageUrl: null, sellerName: null,
});

// Sahte DB: adayları verir, yazılanları toplar (durum = yapay zekâ > kural > bilinmiyor).
function fakeDb(products) {
  const saved = [];
  return {
    saved,
    loadTrCandidates: async (_client, opts) => {
      saved.opts = opts;
      return products;
    },
    latestFxRates: async () => ({ USD: 50 }),
    saveTrCheck: async (_client, id, check) => {
      saved.push({ id, ...check });
      return check.aiStatus ?? check.ruleStatus ?? "unknown";
    },
  };
}
const base = { client: null, delayMs: 0, log: () => {} };

test("yapay zekâ yokken: kural 'var' diyebilir, diyemezse 'bilinmiyor' (asla 'yok')", async () => {
  const db = fakeDb([
    product(1, "JBL Vibe Beam 2 - Earbuds", "JBL"),
    product(2, "Full Motion TV Wall Mount", "Pipishell"),
  ]);
  const queries = [];
  const search = async (query) => {
    queries.push(query);
    return query.startsWith("jbl")
      ? { results: [listing("JBL Vibe Beam2 Kulaklık", 2699), listing("Sony Kulaklık", 1999)], searched: ["amazon_tr", "hepsiburada_tr"], failed: [] }
      : { results: [listing("Hareketli TV Askı Aparatı", 800)], searched: ["amazon_tr", "hepsiburada_tr"], failed: [] };
  };
  const tally = await runTrCheck({ ...base, db, search });
  assert.deepEqual(queries, ["jbl vibe beam 2", "pipishell full motion tv wall"]);
  assert.deepEqual(tally, { candidates: 2, found: 1, similar: 0, not_found: 0, unknown: 1, failed: 0 });
  assert.deepEqual(
    db.saved.map((s) => [s.id, s.ruleStatus, s.aiStatus, s.matches.map((m) => [m.title, m.kind])]),
    [["p1", "found", null, [["JBL Vibe Beam2 Kulaklık", "same"]]], ["p2", null, null, []]]
  );
  assert.deepEqual(db.saved[0].sources, ["amazon_tr", "hepsiburada_tr"]);
});

test("yapay zekâ ile: marka ve tür aramaları birleşir, ilanlar sınıflanır, sonuçsuz arama 'yok'", async () => {
  const db = fakeDb([product(1, "Roku Streaming Stick HD", "Roku"), product(2, "Niş çocuk eğitim ürünü"), product(3, "Kalem Pil")]);
  const ai = {
    queries: async () => new Map([
      ["p1", { exact: "Roku Streaming Stick", generic: "tv stick" }],
      ["p2", { exact: null, generic: "çocuk eğitim seti" }],
      ["p3", { exact: "Kalem Pil", generic: "kalem pil" }], // aynı ifade: tek arama
    ]),
    judge: async (_p, results) => ({
      status: "similar", kinds: results.map((r) => (r.title.includes("kablo") ? "different" : "similar")),
    }),
  };
  const asked = [];
  const search = async (query) => {
    asked.push(query);
    const results = {
      "Roku Streaming Stick": [listing("Roku Stick 4K", 12999), listing("HDMI kablo", 99)],
      "tv stick": [listing("Q96 TV Stick", 1999), listing("Roku Stick 4K", 12999)], // ikinci aramada yinelenen ilan
    }[query] ?? [];
    return { results, searched: ["amazon_tr"], failed: [] };
  };
  const tally = await runTrCheck({ ...base, db, search, ai });
  assert.equal(db.saved.opts.retryNoAi, true); // yapay zekâsız bakılmışlar da aday
  assert.deepEqual(asked, ["Roku Streaming Stick", "tv stick", "çocuk eğitim seti", "Kalem Pil"]);
  assert.deepEqual([tally.similar, tally.not_found], [1, 2]);
  assert.deepEqual(
    db.saved.map((s) => [s.query, s.aiStatus, s.matches.map((m) => m.title)]),
    [
      ["Roku Streaming Stick | tv stick", "similar", ["Roku Stick 4K", "Q96 TV Stick"]],
      ["çocuk eğitim seti", "not_found", []],
      ["Kalem Pil", "not_found", []],
    ]
  );
});

test("iki aramadan birine yanıt vermeyen site 'arandı' sayılmaz; hiçbiri tam aranmadıysa 'yok' yazılmaz", async () => {
  const db = fakeDb([product(1, "Acme Bir X100", "Acme"), product(2, "Acme İki X200", "Acme")]);
  const ai = {
    queries: async (products) => new Map(products.map((p) => [p.id, { exact: `acme ${p.id}`, generic: `tür ${p.id}` }])),
    judge: async (_p, results) => ({ status: "similar", kinds: results.map(() => "similar") }),
  };
  const unread = (code) => ({ code, blocked: false, message: "arama sayfası tanınmadı" });
  const search = async (query) => ({
    "acme p1": { results: [listing("A1", 100)], searched: ["amazon_tr", "hepsiburada_tr"], failed: [] },
    "tür p1": { results: [listing("H1", 200, "hepsiburada_tr")], searched: ["hepsiburada_tr"], failed: [unread("amazon_tr")] },
    // p2: iki arama da boş, ama hiçbir site ikisine birden yanıt vermedi.
    "acme p2": { results: [], searched: ["amazon_tr"], failed: [unread("hepsiburada_tr")] },
    "tür p2": { results: [], searched: ["hepsiburada_tr"], failed: [unread("amazon_tr")] },
  }[query]);
  const tally = await runTrCheck({ ...base, db, search, ai });
  assert.deepEqual(
    db.saved.map((s) => [s.id, s.sources, s.matches.map((m) => m.title)]),
    [["p1", ["hepsiburada_tr"], ["A1", "H1"]]]
  );
  assert.deepEqual([tally.similar, tally.not_found, tally.failed], [1, 0, 1]);
});

test("yapay zekâ kotası biterse kalan ürünler kural katmanıyla işlenir, 'yok' yazılmaz", async () => {
  const db = fakeDb([product(1, "Acme Turbo Blender X200", "Acme"), product(2, "Acme Mini Chopper Z9", "Acme")]);
  let judged = 0;
  const ai = {
    queries: async (products) => new Map(products.map((p) => [p.id, { exact: null, generic: `tr ${p.id}` }])),
    judge: async () => {
      judged++;
      throw new QuotaError("yapay zekâ kotası doldu (HTTP 429)");
    },
  };
  const queries = [];
  const search = async (query) => {
    queries.push(query);
    return { results: [listing("Acme Turbo Blender X200 Türkiye", 3000)], searched: ["amazon_tr"], failed: [] };
  };
  const tally = await runTrCheck({ ...base, db, search, ai });
  assert.equal(judged, 1); // kota hatasından sonra bir daha sorulmaz
  assert.deepEqual(queries, ["tr p1", "acme mini chopper z9"]);
  assert.deepEqual(db.saved.map((s) => [s.ruleStatus, s.aiStatus]), [["found", null], [null, null]]);
  assert.deepEqual([tally.found, tally.unknown, tally.not_found], [1, 1, 0]);
});

test("yapay zekâ kararı alınamaz ve kural da bulamazsa sonuç yazılmaz (eski kayıt ezilmez)", async () => {
  const db = fakeDb([product(1, "Niş ürün bir"), product(2, "Niş ürün iki")]);
  let judged = 0;
  const ai = {
    queries: async (products) => new Map(products.map((p) => [p.id, { exact: null, generic: `tür ${p.id}` }])),
    judge: async (_p, results) => {
      if (++judged === 1) throw new Error("The operation was aborted due to timeout");
      return { status: "similar", kinds: results.map(() => "similar") };
    },
  };
  const search = async () => ({ results: [listing("Benzer ürün", 100)], searched: ["amazon_tr"], failed: [] });
  const tally = await runTrCheck({ ...base, db, search, ai });
  assert.deepEqual(db.saved.map((s) => [s.id, s.aiStatus]), [["p2", "similar"]]); // geçici hata yapay zekâyı kapatmaz
  assert.deepEqual([tally.similar, tally.unknown, tally.failed], [1, 0, 1]);
});

test("engelleyen site koşunun kalanında denenmez; hiçbir site aranamazsa sonuç yazılmaz", async () => {
  const db = fakeDb([product(1, "Acme Bir X100", "Acme"), product(2, "Acme İki X200", "Acme"), product(3, "Acme Üç X300", "Acme")]);
  const asked = [];
  const search = async (_query, { sources }) => {
    asked.push([...sources]);
    if (asked.length === 1) {
      return { results: [], searched: ["hepsiburada_tr"], failed: [{ code: "amazon_tr", blocked: true, message: "erişim engellendi (HTTP 403)" }] };
    }
    return { results: [], searched: [], failed: [{ code: "hepsiburada_tr", blocked: true, message: "erişim engellendi (HTTP 403)" }] };
  };
  const tally = await runTrCheck({ ...base, db, search });
  assert.deepEqual(asked, [["amazon_tr", "hepsiburada_tr"], ["hepsiburada_tr"]]); // 3. ürün için istek yok
  assert.deepEqual(db.saved.map((s) => [s.id, s.sources]), [["p1", ["hepsiburada_tr"]]]);
  assert.deepEqual([tally.unknown, tally.failed], [1, 1]);
});

test("--dry-run: aday listesi, arama yok; limit ve pazaryeri DB sorgusuna iner", async () => {
  const db = fakeDb([product(1, "JBL Vibe Beam 2", "JBL")]);
  const lines = [];
  const search = async () => assert.fail("arama yapılmamalıydı");
  const tally = await runTrCheck({ ...base, db, search, dryRun: true, limit: 7, codes: ["amazon_de"], log: (l) => lines.push(l) });
  assert.deepEqual(tally, { candidates: 1, found: 0, similar: 0, not_found: 0, unknown: 0, failed: 0 });
  assert.deepEqual(db.saved.opts, { codes: ["amazon_de"], limit: 7, recheckDays: 30, retryNoAi: false });
  assert.match(lines[0], /amazon_us #1 \| JBL Vibe Beam 2 -> "jbl vibe beam 2"/);
});
