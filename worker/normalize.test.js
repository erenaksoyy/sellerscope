import test from "node:test";
import assert from "node:assert/strict";
import { normalizeProduct, parsePrice, parseRating, parseCount, parseCustomerReviews, extractExternalId, rankFromUrl } from "./normalize.js";

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

test("trendyol tarzı TL fiyat çözülür, eksik yorum null (bilinmiyor) olur", () => {
  const n = normalizeProduct({
    title: "Airfryer XL", link: "https://www.trendyol.com/x/y-p-12345",
    price: "4.299 TL", rating: "4.6",
  }, "trendyol_tr", 2);
  assert.equal(n.price, 4299);
  assert.equal(n.currency, "TRY");
  assert.equal(n.reviewCount, null);
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
  assert.equal(n.rank, 4); // bağlantıdaki sccl_4 (= "#4 in Beauty"), veri seti sırası değil
});

test("gerçek aktör çıktısı: yorum satırı yoksa null olur, çökmez", () => {
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
  assert.equal(n.reviewCount, null);
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

test("trendyol: contentId, merchantName, ratingScore, sellingPrice çözülür", () => {
  const n = normalizeProduct({
    title: "Xiaomi Robot Süpürge",
    url: "https://www.trendyol.com/xiaomi/robot-supurge-p-98765432",
    contentId: "98765432",
    merchantName: "Xiaomi Resmi Mağaza",
    sellingPrice: "8.499,00 TL",
    ratingScore: "4,8",
    reviewsCount: "2.345",
    brandName: "Xiaomi",
    imgUrl: "https://cdn.trendyol.com/img/x.jpg",
  }, "trendyol_tr", 0);
  assert.equal(n.externalId, "98765432");
  assert.equal(n.sellerName, "Xiaomi Resmi Mağaza");
  assert.equal(n.price, 8499);
  assert.equal(n.rating, 4.8);
  assert.equal(n.reviewCount, 2345);
  assert.equal(n.brand, "Xiaomi");
  assert.equal(n.imageUrl, "https://cdn.trendyol.com/img/x.jpg");
  assert.equal(n.rank, 1);
});

test("aliexpress: productId, storeInfo, orders, starRating çözülür", () => {
  const n = normalizeProduct({
    title: "Portable Blender USB Rechargeable",
    url: "https://www.aliexpress.com/item/1005006123456.html",
    productId: "1005006123456",
    storeInfo: { storeName: "KONKA Official", name: "KONKA" },
    price: 12.99,
    currency: "USD",
    starRating: "4.5",
    orders: "5.2k",
    brand: "KONKA",
    mainImage: "https://ae01.alicdn.com/img/x.jpg",
  }, "aliexpress_global", 3);
  assert.equal(n.externalId, "1005006123456");
  assert.equal(n.sellerName, "KONKA Official");
  assert.equal(n.price, 12.99);
  assert.equal(n.rating, 4.5);
  assert.equal(n.reviewCount, 5200);
  assert.equal(n.brand, "KONKA");
  assert.equal(n.imageUrl, "https://ae01.alicdn.com/img/x.jpg");
  assert.equal(n.rank, 4);
});

test("rank string olarak gelse de doğru çözülür", () => {
  const n = normalizeProduct({
    title: "Test Ürün", url: "https://x.com/p/1",
    rank: "7", price: 10,
  }, "amazon_us", 0);
  assert.equal(n.rank, 7);
});

// 6 Ekim 2026 amazon.com.tr liste çekiminden iki ham öğe (açıklama kısaltıldı).
test("gerçek liste çıktısı (amazon_tr): yorum sayısı null gelirse bilinmiyor kalır, sıra bağlantıdan", () => {
  const n = normalizeProduct({
    url: "https://www.amazon.com.tr/Vileda-Turbo-Wring-Yedek-Paspas/dp/B007CTYVRK/ref=zg_bs_g_home_d_sccl_6/705-9230371-4949421?th=1",
    name: "Vileda Turbo&Easy Wring Yedek Paspas",
    offers: { price: "161.99", priceCurrency: "TRY" },
    brand: { slogan: "Vileda" },
    image: "https://m.media-amazon.com/images/I/713sNCscd7L._AC_SX679_.jpg",
    description: "Vileda Turbo Yedek Paspas",
    reviewCount: null,
    rating: 4.7,
    inputUrl: "https://www.amazon.com.tr/gp/bestsellers/home/",
  }, "amazon_tr", 0);
  assert.equal(n.externalId, "B007CTYVRK");
  assert.equal(n.price, 161.99);
  assert.equal(n.currency, "TRY");
  assert.equal(n.rating, 4.7);
  assert.equal(n.reviewCount, null);
  assert.equal(n.brand, "Vileda");
  assert.equal(n.rank, 6);
});

test("gerçek liste çıktısı (amazon_tr): üst seviye reviewCount sayısı alınır", () => {
  const n = normalizeProduct({
    url: "https://www.amazon.com.tr/Orret-Home-Pantolon-Gardrop-Plastik/dp/B0D3HLNGT8/ref=zg_bs_g_home_d_sccl_12/705-9230371-4949421?th=1",
    name: "Orret Home 20 Adet Dolap İçi Elbise Askısı",
    offers: { price: "189.0", priceCurrency: "TRY" },
    brand: { slogan: "Orret Home" },
    reviewCount: 629,
    rating: 3.7,
  }, "amazon_tr", 2);
  assert.equal(n.reviewCount, 629);
  assert.equal(n.rating, 3.7);
  assert.equal(n.rank, 12);
});

test("rankFromUrl: yalnız Best Sellers bağlantısındaki sıra", () => {
  assert.equal(rankFromUrl("https://www.amazon.com/x/dp/B08KT2Z93D/ref=zg_bs_c_beauty_d_sccl_4/141-7429333?th=1"), 4);
  assert.equal(rankFromUrl("https://www.amazon.com.tr/x/dp/B007CTYVRK/ref=zg_bs_g_home_d_sccl_88/705?th=1"), 88);
  // Öneri şeridinden gelen ürün (çok satanlar listesi değil)
  assert.equal(rankFromUrl("https://www.amazon.com.tr/x/dp/B0ABCDEF12/ref=pd_rhf_ee_s_pd_crcd_d_sccl_2_5/705?th=1"), null);
  assert.equal(rankFromUrl("https://www.amazon.com/x/dp/B0H2G7NFDN/ref=zg_bs?th=1"), null);
  assert.equal(rankFromUrl("https://www.trendyol.com/x/y-p-12345"), null);
  assert.equal(rankFromUrl(null), null);
});
