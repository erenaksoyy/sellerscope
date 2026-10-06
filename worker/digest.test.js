import test from "node:test";
import assert from "node:assert/strict";
import { buildDigest, runDigest, topRising } from "./digest.js";

const sections = [
  {
    marketplace_name: "Amazon Almanya", category_name: "Ev",
    items: [
      { title: "Airfryer", url: "https://x/1", price: 129.99, currency: "EUR", sales: 40, change_pct: 25.5 },
      { title: "Kötü <script>alert(1)</script>", url: "https://x/2?a=1&b=2", price: 10, currency: "EUR", sales: 5, change_pct: null },
    ],
  },
];

test("buildDigest: konu + metin + html", () => {
  const d = buildDigest(sections);
  assert.equal(d.subject, "Haftalık yükselenler: 1 kategoride 2 ürün");
  assert.ok(d.text.includes("Airfryer"));
  assert.ok(d.text.includes("+25.5%"));
  assert.ok(d.text.includes("Yeni")); // change_pct null
  assert.ok(d.text.includes("gerçek satış adedi değildir"));
  assert.ok(!d.html.includes("<script>alert"));
  assert.ok(d.html.includes("&lt;script&gt;"));
  assert.ok(d.html.includes("a=1&amp;b=2"));
});

test("runDigest: kullanıcı başına 1 e-posta, boş kullanıcı atlanır, log yazılır", async () => {
  const calls = [];
  const query = async (text, params) => {
    calls.push({ text, params });
    if (text.includes("FROM category_follows f")) {
      return { rows: [
        { user_id: "u1", email: "a@x.c", marketplace: "amazon_de", marketplace_name: "DE", category_id: 1, category_name: "Ev" },
        { user_id: "u1", email: "a@x.c", marketplace: "amazon_de", marketplace_name: "DE", category_id: 2, category_name: "Spor" },
        { user_id: "u2", email: "b@x.c", marketplace: "amazon_us", marketplace_name: "US", category_id: 3, category_name: "Home" },
      ], rowCount: 3 };
    }
    if (text.includes("WITH agg AS")) {
      const items = params[1] === 2
        ? [{ title: "T", url: "https://x", price: 5, currency: "EUR", sales: 10, change_pct: 3.1 }]
        : [];
      return { rows: items, rowCount: items.length };
    }
    if (text.includes("INSERT INTO email_log")) return { rows: [], rowCount: 1 };
    throw new Error(`beklenmeyen SQL: ${text.slice(0, 60)}`);
  };
  const sent = [];
  const res = await runDigest({ query, send: async (m) => { sent.push(m); } });

  assert.equal(sent.length, 1); // u2 boş, e-posta almadı
  assert.equal(sent[0].to, "a@x.c");
  assert.ok(sent[0].subject.includes("1 kategoride 1 ürün")); // boş kategori bölüme girmedi
  assert.deepEqual(res, { mailed: 1, skipped: 1 });
  const log = calls.find((c) => c.text.includes("INSERT INTO email_log"));
  assert.deepEqual(log.params, ["u1", 1]);
});

test("topRising: parametreler ve limit", async () => {
  let seen;
  await topRising(async (text, params) => {
    seen = { text, params };
    return { rows: [], rowCount: 0 };
  }, "amazon_de", 7, 3);
  assert.deepEqual(seen.params, ["amazon_de", 7, 3]);
  assert.ok(seen.text.includes("ORDER BY change_pct DESC NULLS FIRST"));
});
