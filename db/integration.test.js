// Gerçek Postgres'e karşı entegrasyon testi: şema + seed + cron yazımı +
// API sorguları + haftalık özet, uçtan uca. Sahte query ile görülemeyen SQL
// hatalarını (tip çözümleme, kapsam, NUMERIC/DATE dönüşümü) yakalar.
// Hedef: TEST_DATABASE_URL, yoksa yerel (localhost) DATABASE_URL. Her koşu
// kendi geçici şemasında çalışır ve sonunda onu siler; gerçek tablolara
// dokunmaz. Yerel Postgres yoksa testler atlanır (npm test DB'siz de geçer).
import "../worker/env.js";
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createHandler } from "../api/handler.js";
import { runDigest } from "../worker/digest.js";
import { ABROAD_MARKETPLACES } from "../worker/config.js";

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCHEMA = `it_${process.pid}_${Date.now().toString(36)}`;
const SECRET = "test-secret";

function localUrl(url) {
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname) ? url : null;
  } catch {
    return null;
  }
}

const base = process.env.TEST_DATABASE_URL || localUrl(process.env.DATABASE_URL);
let skip = base ? false : "yerel Postgres yok (TEST_DATABASE_URL tanımla)";
let db = null;
let pool = null;
let scopedUrl = null;
if (base) {
  // Tüm bağlantılar (alt süreçteki cron dahil) yalnız geçici şemayı görür.
  scopedUrl = `${base}${base.includes("?") ? "&" : "?"}options=${encodeURIComponent(`-c search_path=${SCHEMA}`)}`;
  process.env.DATABASE_URL = scopedUrl;
  try {
    db = await import("../worker/db.js");
    pool = db.getPool();
    await pool.query("SELECT 1");
  } catch (err) {
    skip = `Postgres'e bağlanılamadı: ${err.message}`;
    await db?.closePool();
    pool = null;
  }
}

const q = (text, params) => pool.query(text, params);
const handle = createHandler({ query: q, jwtSecret: SECRET });
const get = (path, headers = {}) => handle({ method: "GET", path, headers });
const titles = (res) => res.body.data.map((p) => p.title);

let today; // DB'nin bugünü (oturum saat dilimi), "YYYY-MM-DD"
let de; // amazon_de / ev-mutfak hedefi
const ids = {};

function item(n, title, price, reviewCount, rank) {
  const externalId = `IT${String(n).padStart(8, "0")}`;
  return {
    externalId, title, brand: "Test", url: `https://www.amazon.de/dp/${externalId}`,
    imageUrl: null, sellerName: null, price, currency: "EUR", rating: 4.5, reviewCount, rank,
  };
}

// history: [[kaç gün önce, tahmini satış, sıra], ...]. Bugünün satırı gerçek
// insertSnapshot ile, geçmiş günler doğrudan INSERT ile yazılır.
async function seedProduct(client, target, it, history) {
  const { id } = await db.upsertProduct(
    client, target.marketplace_id, target.category_id, target.country_code, it
  );
  for (const [daysAgo, sales, rank] of history) {
    if (daysAgo === 0) {
      await db.insertSnapshot(client, id, { ...it, rank }, sales / 20, sales);
      continue;
    }
    await client.query(
      `INSERT INTO product_snapshots
         (product_id, captured_on, price, review_count, rating,
          bestseller_rank, review_count_delta, estimated_sales_daily)
       VALUES ($1, CURRENT_DATE - $2::int, $3, $4, $5, $6, $7, $8)`,
      [id, daysAgo, it.price, it.reviewCount, it.rating, rank, sales / 20, sales]
    );
  }
  return id;
}

before(async () => {
  if (skip) return;
  await pool.query(`CREATE SCHEMA ${SCHEMA}`);
  await pool.query(readFileSync(`${ROOT}db/schema.sql`, "utf8"));
  // Göçler sıfır şemanın üstünde de sorunsuz (yeniden) çalışabilmeli.
  for (const f of readdirSync(`${ROOT}db/migrations`).filter((n) => n.endsWith(".sql")).sort()) {
    await pool.query(readFileSync(`${ROOT}db/migrations/${f}`, "utf8"));
  }
  await pool.query(readFileSync(`${ROOT}db/seed.sql`, "utf8"));
  today = (await pool.query(`SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS d`)).rows[0].d;

  // amazon_de / ev-mutfak: sonuçları elle hesaplanabilen 4 ürün (7 günlük
  // pencere: son 3 gün "yeni dönem", önceki 4 gün "eski dönem").
  const client = await pool.connect();
  try {
    de = (await db.loadTargets(client)).find(
      (t) => t.marketplace_code === "amazon_de" && t.category_slug === "ev-mutfak"
    );
    // Eski dönem 20/gün, yeni dönem 80/gün -> 320 satış, %+300, sıra 20 -> 5.
    ids.rising = await seedProduct(client, de, item(1, "Yükselen ürün", 30, 500, 5), [
      [6, 20, 20], [5, 20, 20], [4, 20, 20], [3, 20, 20], [2, 80, 5], [1, 80, 5], [0, 80, 5],
    ]);
    // Her gün 40 -> 280 satış, %0.
    ids.steady = await seedProduct(
      client, de, item(2, "Sabit ürün", 50, 800, 10), [6, 5, 4, 3, 2, 1, 0].map((d) => [d, 40, 10])
    );
    // Yalnız son 2 gün -> 40 satış, önceki dönem yok (değişim null, "yeni").
    ids.fresh = await seedProduct(client, de, item(3, "Yeni ürün", 80, 40, 3), [[1, 20, 3], [0, 20, 3]]);
    // Aktör yorum sayısı döndürmedi -> sayı NULL, satış 0.
    ids.unknown = await seedProduct(client, de, item(4, "Sayısı bilinmeyen ürün", 120, null, 40), [[0, 0, 40]]);
    await db.refreshCategoryStats(client, de.marketplace_id, de.category_id, de.country_code);
  } finally {
    client.release();
  }
});

after(async () => {
  if (!pool) return;
  await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await db.closePool();
});

// --- şema + yazma katmanı ---

test("şema + göçler + seed geçici şemaya kurulur", { skip }, async () => {
  const { rows } = await pool.query(
    `SELECT current_schema() AS schema,
            (SELECT COUNT(*)::int FROM marketplaces) AS marketplaces,
            (SELECT COUNT(*)::int FROM categories) AS categories`
  );
  assert.deepEqual(rows[0], { schema: SCHEMA, marketplaces: 5, categories: 10 });
  const client = await pool.connect();
  try {
    assert.equal((await db.loadTargets(client)).length, 10);
  } finally {
    client.release();
  }
});

test("upsertProduct: önceki yorum sayısı, bilinmeyen sayı son değeri ezmez", { skip }, async () => {
  const client = await pool.connect();
  try {
    const t = (await db.loadTargets(client)).find(
      (x) => x.marketplace_code === "trendyol_tr" && x.category_slug === "elektronik"
    );
    const up = (it) => db.upsertProduct(client, t.marketplace_id, t.category_id, t.country_code, it);
    const known = { ...item(100, "Sayısı bilinen", 9.99, 100, 1), currency: "TRY" };

    const first = await up(known);
    assert.equal(first.prevReviewCount, null); // yeni ürün
    const second = await up({ ...known, reviewCount: 110 });
    assert.equal(second.id, first.id);
    assert.equal(second.prevReviewCount, 100);
    const third = await up({ ...known, reviewCount: null }); // bugün sayı gelmedi
    assert.equal(third.prevReviewCount, 110);
    const { rows } = await client.query(
      `SELECT price, rating, review_count FROM products WHERE id = $1`, [first.id]
    );
    // NUMERIC sütunlar metin değil sayı döner; son bilinen yorum sayısı korunur.
    assert.deepEqual(rows[0], { price: 9.99, rating: 4.5, review_count: 110 });

    // Sayısı hiç bilinmemiş ürün: sayı ilk geldiğinde önceki null (artış sayılmaz).
    const never = { ...item(101, "Sayısı hiç bilinmedi", 5, null, 2), currency: "TRY" };
    const n1 = await up(never);
    await db.insertSnapshot(client, n1.id, never, 0, 0);
    const n2 = await up({ ...never, reviewCount: 50 });
    assert.equal(n2.prevReviewCount, null);
    const snap = await client.query(
      `SELECT review_count FROM product_snapshots WHERE product_id = $1`, [n1.id]
    );
    assert.equal(snap.rows[0].review_count, null);
  } finally {
    client.release();
  }
});

test("refreshCategoryStats: bugünkü snapshot'lardan özet", { skip }, async () => {
  const { rows } = await pool.query(
    `SELECT to_char(stats_on, 'YYYY-MM-DD') AS stats_on, product_count, avg_price,
            total_estimated_sales, top_product_id
     FROM category_daily_stats WHERE marketplace_id = $1 AND category_id = $2`,
    [de.marketplace_id, de.category_id]
  );
  assert.deepEqual(rows, [{
    stats_on: today, product_count: 4, avg_price: 70,
    total_estimated_sales: 140, top_product_id: ids.rising,
  }]);
});

test("cron (mock veri): ilk gün 0 satış, ertesi gün yorum artışı x katsayı", { skip }, async () => {
  const cron = () => run(process.execPath, ["worker/run.js", "--marketplace=amazon_tr"], {
    cwd: ROOT,
    // REAL_FETCH boş: ortamda/.env'de açık olsa bile ücretli çekim yapılmaz.
    env: { ...process.env, DATABASE_URL: scopedUrl, REAL_FETCH: "" },
    timeout: 30000,
  });
  const TR = `JOIN marketplaces m ON m.id = p.marketplace_id WHERE m.code = 'amazon_tr'`;
  const counts = async () => (await pool.query(
    `SELECT (SELECT COUNT(*)::int FROM products p ${TR}) AS products,
            (SELECT COUNT(*)::int FROM product_snapshots s
               JOIN products p ON p.id = s.product_id ${TR}) AS snapshots,
            (SELECT COALESCE(SUM(s.estimated_sales_daily), 0)::int FROM product_snapshots s
               JOIN products p ON p.id = s.product_id ${TR}
               AND s.captured_on = CURRENT_DATE) AS sales_today`
  )).rows[0];

  // 1. gün: 2 kategori x 50 ürün, hepsi ilk kez görülüyor -> satış yok.
  const day1 = await cron();
  assert.doesNotMatch(day1.stderr, /HATA/);
  assert.match(day1.stdout, /TOPLAM: 100 ürün, tahmini 0 satış\/gün/);
  assert.deepEqual(await counts(), { products: 100, snapshots: 100, sales_today: 0 });

  // İlk koşuyu "dün"e taşı: her ürün dün 5 yorum gerideydi, birinin sayısı bilinmiyordu.
  await pool.query(
    `UPDATE product_snapshots s SET captured_on = CURRENT_DATE - 1
     FROM products p ${TR} AND p.id = s.product_id`
  );
  await pool.query(
    `UPDATE category_daily_stats st SET stats_on = CURRENT_DATE - 1
     FROM marketplaces m WHERE m.id = st.marketplace_id AND m.code = 'amazon_tr'`
  );
  await pool.query(
    `UPDATE products p SET review_count = p.review_count - 5
     FROM marketplaces m WHERE m.id = p.marketplace_id AND m.code = 'amazon_tr'`
  );
  await pool.query(
    `UPDATE products SET review_count = NULL WHERE external_id = 'mock-amazon_tr-elektronik-001'`
  );

  // 2. gün: 99 ürün x 5 yorum x katsayı 20 = 9900; sayısı bilinmeyen ürün 0.
  const day2 = await cron();
  assert.doesNotMatch(day2.stderr, /HATA/);
  assert.match(day2.stdout, /TOPLAM: 100 ürün, tahmini 9900 satış\/gün/);
  assert.deepEqual(await counts(), { products: 100, snapshots: 200, sales_today: 9900 });
  const stats = await pool.query(
    `SELECT c.slug, st.product_count, st.total_estimated_sales
     FROM category_daily_stats st
     JOIN categories c ON c.id = st.category_id
     JOIN marketplaces m ON m.id = st.marketplace_id
     WHERE m.code = 'amazon_tr' AND st.stats_on = CURRENT_DATE ORDER BY c.slug`
  );
  assert.deepEqual(stats.rows, [
    { slug: "elektronik", product_count: 50, total_estimated_sales: 4900 },
    { slug: "ev-yasam", product_count: 50, total_estimated_sales: 5000 },
  ]);
  const filled = await pool.query(
    `SELECT review_count FROM products WHERE external_id = 'mock-amazon_tr-elektronik-001'`
  );
  assert.ok(filled.rows[0].review_count > 0); // bilinmeyen sayı bugünkü değerle doldu

  // Aynı gün tekrar koşu: çift ürün/snapshot satırı oluşmaz.
  await cron();
  const again = await counts();
  assert.deepEqual([again.products, again.snapshots], [100, 200]);
});

// --- API (gerçek SQL) ---

test("GET /api/categories", { skip }, async () => {
  const res = await get("/api/categories?marketplace=amazon_de");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data.map((c) => c.slug), ["elektronik", "ev-mutfak", "spor-outdoor"]);
  assert.equal((await get("/api/categories?marketplace=yok")).status, 404);
});

test("GET /api/products: satış, değişim yüzdesi, sıralama, filtre", { skip }, async () => {
  const top = await get("/api/products?marketplace=amazon_de&category=ev-mutfak");
  assert.equal(top.status, 200);
  assert.deepEqual(top.body.meta, { range: "7d", sort: "top" });
  assert.deepEqual(
    top.body.data.map((p) => [p.title, p.sales, p.change_pct]),
    [["Yükselen ürün", 320, 300], ["Sabit ürün", 280, 0], ["Yeni ürün", 40, null], ["Sayısı bilinmeyen ürün", 0, 0]]
  );
  const rising = top.body.data[0];
  assert.equal(rising.id, ids.rising);
  assert.deepEqual(
    [rising.price, rising.currency, rising.rating, rising.review_count, rising.bestseller_rank, rising.best_rank],
    [30, "EUR", 4.5, 500, 5, 5]
  );
  assert.equal(top.body.data[3].review_count, null); // bilinmiyor, 0 değil

  const byChange = await get("/api/products?marketplace=amazon_de&category=ev-mutfak&sort=rising");
  assert.deepEqual(titles(byChange), ["Yeni ürün", "Yükselen ürün", "Sabit ürün", "Sayısı bilinmeyen ürün"]);

  // 30 gün: ilk 15 günde veri yok -> karşılaştırılacak dönem yok (null).
  const month = await get("/api/products?marketplace=amazon_de&category=ev-mutfak&range=30d");
  assert.equal(month.body.meta.range, "30d");
  assert.deepEqual(
    [month.body.data[0].title, month.body.data[0].sales, month.body.data[0].change_pct],
    ["Yükselen ürün", 320, null]
  );

  const priced = await get("/api/products?marketplace=amazon_de&category=ev-mutfak&min_price=40&max_price=100");
  assert.deepEqual(titles(priced), ["Sabit ürün", "Yeni ürün"]);
  assert.equal((await get("/api/products?marketplace=amazon_de&category=yok")).status, 404);
});

test("GET /api/products/:id: günlük seri", { skip }, async () => {
  const res = await get(`/api/products/${ids.rising}?range=7d`);
  assert.equal(res.status, 200);
  assert.deepEqual(
    [res.body.title, res.body.marketplace, res.body.category, res.body.price, res.body.meta.range],
    ["Yükselen ürün", "amazon_de", "ev-mutfak", 30, "7d"]
  );
  assert.equal(res.body.series.length, 7);
  const sixAgo = (await pool.query(`SELECT to_char(CURRENT_DATE - 6, 'YYYY-MM-DD') AS d`)).rows[0].d;
  assert.deepEqual(res.body.series[0], { date: sixAgo, price: 30, sales: 20, rank: 20 });
  assert.deepEqual(res.body.series[6], { date: today, price: 30, sales: 80, rank: 5 });

  assert.equal((await get(`/api/products/${ids.rising}`)).body.series.length, 7); // varsayılan 30 gün
  assert.equal((await get("/api/products/11111111-1111-4111-8111-111111111111")).status, 404);
  assert.equal((await get("/api/products/abc")).status, 400);
});

test("GET /api/explosions: sıralama, yeni ürün, sıra sıçraması, eşikler", { skip }, async () => {
  const res = await get("/api/explosions?marketplace=amazon_de&category=ev-mutfak");
  assert.equal(res.status, 200);
  assert.deepEqual(
    res.body.data.map((p) => [p.title, p.change_pct, p.is_new, p.sales_recent, p.sales_prev, p.rank_jump]),
    [
      ["Yeni ürün", null, true, 40, 0, null],
      ["Yükselen ürün", 300, false, 240, 80, 15],
      ["Sabit ürün", 0, false, 120, 160, 0],
      ["Sayısı bilinmeyen ürün", 0, false, 0, 0, null],
    ]
  );
  assert.deepEqual(
    [res.body.data[1].marketplace, res.body.data[1].category, res.body.data[1].rank_recent, res.body.data[1].rank_prev],
    ["amazon_de", "ev-mutfak", 5, 20]
  );

  const minChange = await get("/api/explosions?marketplace=amazon_de&min_change=100");
  assert.deepEqual(titles(minChange), ["Yeni ürün", "Yükselen ürün"]);
  const minSales = await get("/api/explosions?marketplace=amazon_de&min_sales=200");
  assert.deepEqual(titles(minSales), ["Yükselen ürün"]);
  assert.deepEqual(titles(await get("/api/explosions?marketplace=amazon_de&limit=1")), ["Yeni ürün"]);

  // Pazaryeri verilmezse kapsam yurt dışı: TR ürünleri listeye girmez.
  const abroad = await get("/api/explosions");
  assert.deepEqual(abroad.body.meta.marketplaces, ABROAD_MARKETPLACES);
  assert.equal(abroad.body.data.length, 4);
  assert.ok(abroad.body.data.every((p) => ABROAD_MARKETPLACES.includes(p.marketplace)));
});

// --- üyelik + haftalık özet ---

test("üyelik akışı: kayıt, giriş, favori, takip, haftalık özet", { skip }, async () => {
  const post = (path, body, headers = {}) => handle({ method: "POST", path, headers, body });
  const del = (path, headers) => handle({ method: "DELETE", path, headers });
  const email = "uye@example.com";
  const creds = { email, password: "gizli-sifre-1" };

  const reg = await post("/api/auth/register", creds);
  assert.equal(reg.status, 201);
  assert.equal((await post("/api/auth/register", creds)).status, 409);
  const login = await post("/api/auth/login", creds);
  assert.equal(login.status, 200);
  assert.equal((await post("/api/auth/login", { email, password: "yanlis-sifre" })).status, 401);
  const auth = { authorization: `Bearer ${login.body.token}` };

  assert.equal((await get("/api/favorites")).status, 401);
  assert.equal((await post("/api/favorites", { product_id: ids.rising }, auth)).status, 201);
  assert.equal((await post("/api/favorites", { product_id: ids.rising }, auth)).status, 200);
  const favs = await get("/api/favorites", auth);
  assert.deepEqual(favs.body.data.map((f) => [f.id, f.title, f.price]), [[ids.rising, "Yükselen ürün", 30]]);
  assert.equal((await del(`/api/favorites/${ids.rising}`, auth)).status, 200);
  assert.deepEqual((await get("/api/favorites", auth)).body.data, []);

  const follow = { marketplace: "amazon_de", category_id: de.category_id };
  assert.equal((await post("/api/follows", follow, auth)).status, 201);
  assert.equal((await post("/api/follows", follow, auth)).status, 200);
  assert.deepEqual((await get("/api/follows", auth)).body.data, [
    { marketplace: "amazon_de", category_id: de.category_id, name: "Ev & Mutfak", slug: "ev-mutfak" },
  ]);

  const sent = [];
  const send = async (mail) => { sent.push(mail); };
  assert.deepEqual(await runDigest({ query: q, send }), { mailed: 1, skipped: 0 });
  assert.equal(sent[0].to, email);
  assert.equal(sent[0].subject, "Haftalık yükselenler: 1 kategoride 4 ürün");
  assert.ok(sent[0].text.includes("== Amazon Almanya / Ev & Mutfak =="));
  assert.ok(sent[0].text.includes("1. Yeni ürün\n   80 EUR | tahmini 40 satış/hafta | Yeni"));
  assert.ok(sent[0].text.includes("2. Yükselen ürün\n   30 EUR | tahmini 320 satış/hafta | +300%"));
  // Aynı hafta ikinci koşu: tekrar gönderilmez.
  assert.deepEqual(await runDigest({ query: q, send }), { mailed: 0, skipped: 0 });
  assert.equal(sent.length, 1);

  assert.equal((await del(`/api/follows/${de.category_id}`, auth)).status, 200);
  assert.deepEqual((await get("/api/follows", auth)).body.data, []);
});
