import test from "node:test";
import assert from "node:assert/strict";
import { normalizeProduct, parsePrice, parseRating, parseCount, parseCustomerReviews, extractExternalId } from "./normalize.js";

test("amazon.com satırı normalize olur", () => {
  const n = normalizeProduct({
    title: "Air Fryer XL",
    url: "https://www.amazon.com/dp/B0C1234567",
    price: "$129.99",
    rating: 4.6,
    reviewsCount: "12,345",
    brand: "Philips",
    image: "https://img/x.jpg",
  }, "amazon_us", 0);
  assert.equal(n.externalId, "B0C1234567");
  assert.equal(n.price, 129.99);
  assert.equal(n.currency, "USD");
  assert.equal(n.rating, 4.6);
  assert.equal(n.reviewCount, 12345);
  assert.equal(n.rank, 1);
});

test("amazon.de virgüllü fiyat ve binlik yorum çözülür", () => {
  const n = normalizeProduct({
    name: "Heißluftfritteuse",
    link: "https://www.amazon.de/dp/B0D7654321",
    price: "129,99 €",
    stars: "4,6",
    ratingsTotal: "1.234",
  }, "amazon_de", 4);
  assert.equal(n.externalId, "B0D7654321");
  assert.equal(n.price, 129.99);
  assert.equal(n.rating, 4.6);
  assert.equal(n.reviewCount, 1234);
  assert.equal(n.rank, 5);
});

test("trendyol tarzı TL fiyat çözülür, eksik yorum 0 olur", () => {
  const n = normalizeProduct({
    title: "Airfryer XL", link: "https://www.trendyol.com/x/y-p-12345",
    price: "4.299 TL", rating: "4.6",
  }, "trendyol_tr", 2);
  assert.equal(n.price, 4299);
  assert.equal(n.currency, "TRY");
  assert.equal(n.reviewCount, 0);
  assert.equal(n.rank, 3);
});

test("başlık veya url yoksa satır elenir", () => {
  assert.equal(normalizeProduct({ price: "$5" }, "amazon_us", 0), null);
  assert.equal(normalizeProduct({ title: "x" }, "amazon_us", 0), null);
  assert.equal(normalizeProduct(null, "amazon_us", 0), null);
});

test("parsePrice: binlik/ondalık ayrımı", () => {
  assert.equal(parsePrice("$1,299.99"), 1299.99);
  assert.equal(parsePrice("1.234,56"), 1234.56);
  assert.equal(parsePrice(42.5), 42.5);
  assert.equal(parsePrice("tükendi"), null);
  assert.equal(parsePrice(null), null);
});

test("parseCount: k soneki ve parantez", () => {
  assert.equal(parseCount("2.3k"), 2300);
  assert.equal(parseCount("(567)"), 567);
  assert.equal(parseCount("puan yok"), null);
});

test("gerçek aktör çıktısı: offers + extraProperties çözülür", () => {
  const n = normalizeProduct({
    image: "https://m.media-amazon.com/images/I/61IQUadfGEL._SX466_.jpg",
    url: "https://www.amazon.com/eos-Cashmere-Moisture-Lightweight-Non-Greasy/dp/B08KT2Z93D/ref=zg_bs_c_beauty_d_sccl_4/141-7429333?th=1",
    inputUrl: "https://www.amazon.com/Best-Sellers/zgbs",
    name: "eos Shea Better Body Lotion - Vanilla Cashmere, 16 fl oz",
    offers: { price: "9.97", priceCurrency: "USD" },
    brand: { slogan: "Amazon Prime Logo" },
    additionalProperties: {
      extraProperties: [
        { name: "manufacturer", value: "\u200E AmazonUs/EOSAW" },
        { name: "asin", value: "\u200E B08KT2Z93D" },
        { name: "best sellers rank", value: "#4 in Beauty & Personal Care (See Top 100) #1 in Body Lotions" },
        { name: "customer reviews", value: "4.7 (67,845)" },
      ],
    },
  }, "amazon_us", 1);
  assert.equal(n.externalId, "B08KT2Z93D");
  assert.equal(n.title, "eos Shea Better Body Lotion - Vanilla Cashmere, 16 fl oz");
  assert.equal(n.price, 9.97);
  assert.equal(n.currency, "USD");
  assert.equal(n.rating, 4.7);
  assert.equal(n.reviewCount, 67845);
  assert.equal(n.brand, "AmazonUs/EOSAW");
  assert.equal(n.rank, 2);
});

test("gerçek aktör çıktısı: yorum satırı yoksa 0 olur, çökmez", () => {
  const n = normalizeProduct({
    name: "HydroJug Polka Dot Traveler 40oz",
    url: "https://www.amazon.com/HydroJug-Traveler-Insulated-Tumbler-Vanilla/dp/B0H2G7NFDN/ref=zg_bs?th=1",
    offers: { price: "44.99", priceCurrency: "USD" },
    brand: { slogan: "HydroJug" },
    additionalProperties: {
      extraProperties: [
        { name: "brand", value: "HydroJug" },
        { name: "material", value: "Stainless Steel" },
      ],
    },
  }, "amazon_us", 2);
  assert.equal(n.externalId, "B0H2G7NFDN");
  assert.equal(n.price, 44.99);
  assert.equal(n.rating, null);
  assert.equal(n.reviewCount, 0);
  assert.equal(n.brand, "HydroJug");
});

test("parseCustomerReviews: TR/AB formatları", () => {
  assert.deepEqual(parseCustomerReviews("4.0 (15,444)"), { rating: 4, reviewCount: 15444 });
  assert.deepEqual(parseCustomerReviews("4,6 (1.234)"), { rating: 4.6, reviewCount: 1234 });
  assert.deepEqual(parseCustomerReviews("yorum yok"), { rating: null, reviewCount: null });
  assert.deepEqual(parseCustomerReviews(null), { rating: null, reviewCount: null });
});

test("extractExternalId: asin yoksa kararlı hash üretir", () => {
  const a = extractExternalId("https://x.com/p/1");
  const b = extractExternalId("https://x.com/p/1");
  const c = extractExternalId("https://x.com/p/2");
  assert.equal(a, b);
  assert.notEqual(a, c);
});
