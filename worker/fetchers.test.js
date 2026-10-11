import test from "node:test";
import assert from "node:assert/strict";
import { backfillReviewCounts } from "./fetchers.js";

const item = (externalId, reviewCount) => ({
  externalId, title: "Örnek", price: 1364, currency: "TRY", rating: 4.4, reviewCount, rank: 1,
});

test("backfillReviewCounts: yalnız sayısı boş ürünler ürün sayfasından tamamlanır", async () => {
  const items = [
    item("B0BN9JL2W9", null),
    item("B0FJ1R7WSS", 269),
    item("B0DWXM21GT", null),
    item("url-1x2y3z", null), // ASIN değil: ürün sayfası adresi kurulamaz
  ];
  const calls = [];
  // Gerçek çıktı biçimi (11 Ekim 2026): sayı doğru; fiyat binlik ayracı
  // yüzünden yanlış, puan boş.
  const runActor = async (opts) => {
    calls.push(opts);
    return [
      {
        url: "https://www.amazon.com.tr/dp/B0BN9JL2W9", inputUrl: "https://www.amazon.com.tr/dp/B0BN9JL2W9",
        reviewCount: 1066, rating: null, offers: { price: 1.364, priceCurrency: "TL" },
      },
      {
        url: "https://www.amazon.com.tr/dp/B0DWXM21GT", inputUrl: "https://www.amazon.com.tr/dp/B0DWXM21GT",
        reviewCount: null, rating: null,
      },
    ];
  };
  assert.equal(await backfillReviewCounts(items, "amazon_tr", runActor), 1);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].input, {
    detailsUrls: [
      { url: "https://www.amazon.com.tr/dp/B0BN9JL2W9" },
      { url: "https://www.amazon.com.tr/dp/B0DWXM21GT" },
    ],
    additionalProperties: true,
    maxProductResults: 2,
  });
  assert.equal(calls[0].maxItems, 2);
  assert.deepEqual(items.map((p) => p.reviewCount), [1066, 269, null, null]);
  // Fiyat ve puan liste çekiminden kalır.
  assert.deepEqual([items[0].price, items[0].currency, items[0].rating], [1364, "TRY", 4.4]);
});

test("backfillReviewCounts: eksik sayı yoksa ya da pazaryeri kapalıysa çekim yapılmaz", async () => {
  const runActor = async () => assert.fail("çekim yapılmamalıydı");
  assert.equal(await backfillReviewCounts([item("B0FJ1R7WSS", 269)], "amazon_tr", runActor), 0);
  const other = [item("B0BN9JL2W9", null)];
  assert.equal(await backfillReviewCounts(other, "trendyol_tr", runActor), 0);
  assert.equal(other[0].reviewCount, null);
});

test("backfillReviewCounts: çekim hata verirse sayılar boş kalır, akış durmaz", async () => {
  const items = [item("B0BN9JL2W9", null)];
  const runActor = async () => {
    throw new Error("Apify run FAILED: x");
  };
  assert.equal(await backfillReviewCounts(items, "amazon_tr", runActor), 0);
  assert.equal(items[0].reviewCount, null);
});
