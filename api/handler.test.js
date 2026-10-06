import test from "node:test";
import assert from "node:assert/strict";
import { createHandler } from "./handler.js";
import { hashPassword, signToken } from "./auth.js";

const SECRET = "test-secret";

// SQL metnindeki ilk eşleşen kalıba göre cevap veren sahte query.
function stubQuery(routes) {
  const calls = [];
  const fn = async (text, params) => {
    calls.push({ text, params });
    const r = routes.find((x) => text.includes(x.match));
    assert.ok(r, `beklenmeyen SQL: ${text.slice(0, 120)}`);
    const rows = typeof r.rows === "function" ? r.rows(params) : (r.rows ?? []);
    return { rows, rowCount: r.rowCount ?? rows.length };
  };
  return { fn, calls };
}

const H = (token) => ({ authorization: `Bearer ${token}` });
const USER = "11111111-1111-4111-8111-111111111111";
const PROD = "22222222-2222-4222-8222-222222222222";
const tokenFor = (sub = USER) => signToken(SECRET, { sub, email: "u@e.c" });

// --- auth ---

test("register: 201 + geçerli token", async () => {
  const { fn } = stubQuery([
    { match: "FROM users WHERE email", rows: [] },
    { match: "INSERT INTO users", rows: [{ id: USER }] },
  ]);
  const handle = createHandler({ query: fn, jwtSecret: SECRET });
  const res = await handle({ method: "POST", path: "/api/auth/register", headers: {}, body: { email: "U@e.c ", password: "12345678" } });
  assert.equal(res.status, 201);
  assert.ok(res.body.token.split(".").length === 3);
});

test("register: hatalı girdi ve çakışma", async () => {
  const { fn } = stubQuery([{ match: "FROM users WHERE email", rows: [{ id: USER }] }]);
  const handle = createHandler({ query: fn, jwtSecret: SECRET });
  const badEmail = await handle({ method: "POST", path: "/api/auth/register", headers: {}, body: { email: "x", password: "12345678" } });
  assert.equal(badEmail.status, 400);
  const short = await handle({ method: "POST", path: "/api/auth/register", headers: {}, body: { email: "a@b.c", password: "123" } });
  assert.equal(short.status, 400);
  const dup = await handle({ method: "POST", path: "/api/auth/register", headers: {}, body: { email: "a@b.c", password: "12345678" } });
  assert.equal(dup.status, 409);
});

test("login: doğru 200, yanlış 401", async () => {
  const hash = await hashPassword("dogru-sifre");
  const { fn } = stubQuery([
    { match: "FROM users WHERE email", rows: [{ id: USER, password_hash: hash }] },
  ]);
  const handle = createHandler({ query: fn, jwtSecret: SECRET });
  const okRes = await handle({ method: "POST", path: "/api/auth/login", headers: {}, body: { email: "u@e.c", password: "dogru-sifre" } });
  assert.equal(okRes.status, 200);
  const bad = await handle({ method: "POST", path: "/api/auth/login", headers: {}, body: { email: "u@e.c", password: "yanlis" } });
  assert.equal(bad.status, 401);
});

// --- categories ---

test("categories: liste + bilinmeyen pazaryeri 404", async () => {
  const { fn, calls } = stubQuery([
    { match: "FROM marketplaces WHERE code", rows: (p) => (p[0] === "amazon_de" ? [{ id: 1 }] : []) },
    { match: "FROM categories c", rows: [{ id: 1, name: "Ev", slug: "ev" }] },
  ]);
  const handle = createHandler({ query: fn, jwtSecret: SECRET });
  const res = await handle({ method: "GET", path: "/api/categories?marketplace=amazon_de", headers: {} });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data, [{ id: 1, name: "Ev", slug: "ev" }]);
  const nf = await handle({ method: "GET", path: "/api/categories?marketplace=yok", headers: {} });
  assert.equal(nf.status, 404);
  const missing = await handle({ method: "GET", path: "/api/categories", headers: {} });
  assert.equal(missing.status, 400);
  assert.ok(calls.length >= 3);
});

// --- products ---

function productRoutes() {
  return stubQuery([
    { match: "FROM categories c", rows: [{ id: 7 }] },
    {
      match: "WITH agg AS",
      rows: [{ id: PROD, title: "X", sales: 100, change_pct: 12.5 }],
    },
  ]);
}

test("products: varsayılan 7d/top, parametreler SQL'e iner", async () => {
  const { fn, calls } = productRoutes();
  const handle = createHandler({ query: fn, jwtSecret: SECRET });
  const res = await handle({ method: "GET", path: "/api/products?marketplace=amazon_de&category=ev-mutfak", headers: {} });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.meta, { range: "7d", sort: "top" });
  const agg = calls.find((c) => c.text.includes("WITH agg AS"));
  // [code, slug, min, max, half, days, recentDays, prevDays]
  assert.deepEqual(agg.params, ["amazon_de", "ev-mutfak", null, null, 3, 7, 3, 4]);
  assert.ok(agg.text.includes("ORDER BY sales DESC"));
});

test("products: 30d/rising + fiyat filtresi", async () => {
  const { fn, calls } = productRoutes();
  const handle = createHandler({ query: fn, jwtSecret: SECRET });
  const res = await handle({
    method: "GET",
    path: "/api/products?marketplace=amazon_de&category=ev&range=30d&sort=rising&min_price=10&max_price=99.5",
    headers: {},
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.meta, { range: "30d", sort: "rising" });
  const agg = calls.find((c) => c.text.includes("WITH agg AS"));
  assert.deepEqual(agg.params, ["amazon_de", "ev", 10, 99.5, 15, 30, 15, 15]);
  assert.ok(agg.text.includes("ORDER BY change_pct DESC NULLS FIRST"));
});

test("products: doğrulama hataları 400", async () => {
  const { fn } = productRoutes();
  const handle = createHandler({ query: fn, jwtSecret: SECRET });
  for (const path of [
    "/api/products?category=ev",
    "/api/products?marketplace=m",
    "/api/products?marketplace=m&category=c&range=90d",
    "/api/products?marketplace=m&category=c&sort=ucuz",
    "/api/products?marketplace=m&category=c&min_price=100&max_price=10",
    "/api/products?marketplace=m&category=c&min_price=abc",
  ]) {
    const res = await handle({ method: "GET", path, headers: {} });
    assert.equal(res.status, 400, path);
  }
});

test("productDetail: seri + 404/400", async () => {
  const { fn } = stubQuery([
    { match: "FROM products p", rows: (p) => (p[0] === PROD ? [{ id: PROD, title: "X" }] : []) },
    { match: "FROM product_snapshots", rows: [{ date: "2026-10-01", price: 10, sales: 5, rank: 3 }] },
  ]);
  const handle = createHandler({ query: fn, jwtSecret: SECRET });
  const res = await handle({ method: "GET", path: `/api/products/${PROD}?range=30d`, headers: {} });
  assert.equal(res.status, 200);
  assert.equal(res.body.series.length, 1);
  assert.deepEqual(res.body.meta, { range: "30d" });
  const nf = await handle({ method: "GET", path: "/api/products/33333333-3333-4333-8333-333333333333", headers: {} });
  assert.equal(nf.status, 404);
  const bad = await handle({ method: "GET", path: "/api/products/bozuk", headers: {} });
  assert.equal(bad.status, 400);
});

// --- favorites ---

test("favorites: auth şart, limit 409, ekleme 201/200", async () => {
  const t = tokenFor();
  const { fn } = stubQuery([
    { match: "FROM products WHERE id", rows: [{ id: PROD }] },
    { match: "COUNT(*)::int AS n", rows: [{ n: 50 }] },
    { match: "FROM favorites WHERE user_id", rows: [] },
    { match: "INSERT INTO favorites", rows: [{ product_id: PROD }], rowCount: 1 },
  ]);
  const handle = createHandler({ query: fn, jwtSecret: SECRET });
  const anon = await handle({ method: "POST", path: "/api/favorites", headers: {}, body: { product_id: PROD } });
  assert.equal(anon.status, 401);
  const full = await handle({ method: "POST", path: "/api/favorites", headers: H(t), body: { product_id: PROD } });
  assert.equal(full.status, 409);

  const ok2 = stubQuery([
    { match: "FROM products WHERE id", rows: [{ id: PROD }] },
    { match: "COUNT(*)::int AS n", rows: [{ n: 49 }] },
    { match: "FROM favorites WHERE user_id", rows: [] },
    { match: "INSERT INTO favorites", rows: [{ product_id: PROD }], rowCount: 1 },
  ]);
  const h2 = createHandler({ query: ok2.fn, jwtSecret: SECRET });
  const created = await h2({ method: "POST", path: "/api/favorites", headers: H(t), body: { product_id: PROD } });
  assert.equal(created.status, 201);

  const again = stubQuery([
    { match: "FROM products WHERE id", rows: [{ id: PROD }] },
    { match: "COUNT(*)::int AS n", rows: [{ n: 50 }] },
    { match: "FROM favorites WHERE user_id", rows: [{ "?column?": 1 }] },
    { match: "INSERT INTO favorites", rows: [], rowCount: 0 },
  ]);
  const h3 = createHandler({ query: again.fn, jwtSecret: SECRET });
  const dup = await h3({ method: "POST", path: "/api/favorites", headers: H(t), body: { product_id: PROD } });
  assert.equal(dup.status, 200); // zaten favoride: limit takılmaz
});

test("favorites: listele + sil", async () => {
  const t = tokenFor();
  const { fn } = stubQuery([
    { match: "FROM favorites f JOIN products", rows: [{ id: PROD, title: "X" }] },
    { match: "DELETE FROM favorites", rows: [] },
  ]);
  const handle = createHandler({ query: fn, jwtSecret: SECRET });
  const list = await handle({ method: "GET", path: "/api/favorites", headers: H(t) });
  assert.equal(list.status, 200);
  assert.equal(list.body.data.length, 1);
  const del = await handle({ method: "DELETE", path: `/api/favorites/${PROD}`, headers: H(t) });
  assert.equal(del.status, 200);
});

// --- follows + 404 ---

test("follows: ekle/listele/sil", async () => {
  const t = tokenFor();
  const { fn } = stubQuery([
    { match: "FROM categories c", rows: [{ id: 7 }] },
    { match: "INSERT INTO category_follows", rows: [{ category_id: 7 }], rowCount: 1 },
    { match: "FROM category_follows f", rows: [{ marketplace: "amazon_de", category_id: 7, name: "Ev", slug: "ev" }] },
    { match: "DELETE FROM category_follows", rows: [] },
  ]);
  const handle = createHandler({ query: fn, jwtSecret: SECRET });
  const add = await handle({ method: "POST", path: "/api/follows", headers: H(t), body: { marketplace: "amazon_de", category_id: 7 } });
  assert.equal(add.status, 201);
  const list = await handle({ method: "GET", path: "/api/follows", headers: H(t) });
  assert.equal(list.body.data.length, 1);
  const del = await handle({ method: "DELETE", path: "/api/follows/7", headers: H(t) });
  assert.equal(del.status, 200);
});

test("explosions: varsayılan kapsam yurt dışı, limit 20", async () => {
  const { fn, calls } = stubQuery([
    {
      match: "AS is_new",
      rows: [{ id: PROD, marketplace: "amazon_us", sales_recent: 100, change_pct: 250, is_new: false }],
    },
  ]);
  const handle = createHandler({ query: fn, jwtSecret: SECRET });
  const res = await handle({ method: "GET", path: "/api/explosions", headers: {} });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.meta, {
    range: "7d",
    marketplaces: ["amazon_us", "amazon_de", "aliexpress_global"],
    category: null,
    min_sales: null,
    min_change: null,
  });
  const q = calls.find((c) => c.text.includes("AS is_new"));
  assert.deepEqual(q.params, [
    ["amazon_us", "amazon_de", "aliexpress_global"], null, null, null, 3, 7, 3, 4, null, null,
  ]);
  assert.ok(q.text.includes("ORDER BY t.change_pct DESC NULLS FIRST"));
  assert.ok(q.text.includes("LIMIT 20"));
});

test("explosions: açık filtreler SQL'e iner", async () => {
  const { fn, calls } = stubQuery([
    { match: "FROM marketplaces WHERE code", rows: [{ id: 2 }] },
    { match: "AS is_new", rows: [] },
  ]);
  const handle = createHandler({ query: fn, jwtSecret: SECRET });
  const res = await handle({
    method: "GET",
    path: "/api/explosions?marketplace=amazon_us&category=electronics&range=30d&min_price=5&max_price=500&min_sales=50&min_change=100&limit=10",
    headers: {},
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.meta, {
    range: "30d",
    marketplaces: ["amazon_us"],
    category: "electronics",
    min_sales: 50,
    min_change: 100,
  });
  const q = calls.find((c) => c.text.includes("AS is_new"));
  assert.deepEqual(q.params, [
    ["amazon_us"], "electronics", 5, 500, 15, 30, 15, 15, 50, 100,
  ]);
  assert.ok(q.text.includes("LIMIT 10"));
});

test("explosions: doğrulama hataları 400, bilinmeyen pazaryeri 404", async () => {
  const { fn } = stubQuery([
    { match: "FROM marketplaces WHERE code", rows: (p) => (p[0] === "amazon_us" ? [{ id: 2 }] : []) },
    { match: "AS is_new", rows: [] },
  ]);
  const handle = createHandler({ query: fn, jwtSecret: SECRET });
  for (const path of [
    "/api/explosions?range=90d",
    "/api/explosions?limit=abc",
    "/api/explosions?limit=0",
    "/api/explosions?limit=51",
    "/api/explosions?min_price=100&max_price=10",
    "/api/explosions?min_sales=-1",
    "/api/explosions?min_change=bozuk",
  ]) {
    const res = await handle({ method: "GET", path, headers: {} });
    assert.equal(res.status, 400, path);
  }
  const nf = await handle({ method: "GET", path: "/api/explosions?marketplace=yok", headers: {} });
  assert.equal(nf.status, 404);
});

test("bilinmeyen yol 404", async () => {
  const { fn } = stubQuery([]);
  const handle = createHandler({ query: fn, jwtSecret: SECRET });
  const res = await handle({ method: "GET", path: "/api/yok", headers: {} });
  assert.equal(res.status, 404);
});
