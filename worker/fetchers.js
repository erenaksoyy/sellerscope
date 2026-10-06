import { MARKETPLACES, APIFY_ACTOR, LISTING_URLS } from "./config.js";
import { runActorAndGetItems } from "./apify.js";
import { normalizeProduct } from "./normalize.js";

// Deterministik mock veri: aynı pazaryeri+kategori+gün için hep aynı sonuç,
// gün değişince yorum sayıları artar (delta/satış hesabı test edilebilsin diye).

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BRANDS = ["Nordhaus", "Verda", "Klint", "Oppla", "Marstek", "Luvin", "Trevon", "Elsida"];

export function mockCategoryProducts({ marketplaceCode, categorySlug, limit, dayIndex }) {
  const mp = MARKETPLACES[marketplaceCode];
  if (!mp) throw new Error(`Bilinmeyen pazaryeri: ${marketplaceCode}`);
  const rand = mulberry32(hashSeed(`${marketplaceCode}:${categorySlug}`));
  const items = [];
  for (let i = 0; i < limit; i++) {
    const baseReviews = 50 + Math.floor(rand() * 5000);
    const dailyGrowth = Math.floor(rand() * 30); // 0-29 yorum/gün
    const price = Math.round((5 + rand() * 195) * 100) / 100;
    const rating = Math.round((3.5 + rand() * 1.5) * 10) / 10;
    const brand = BRANDS[Math.floor(rand() * BRANDS.length)];
    const externalId = `mock-${marketplaceCode}-${categorySlug}-${String(i + 1).padStart(3, "0")}`;
    items.push({
      externalId,
      title: `${brand} ${categorySlug} ürünü ${i + 1} (örnek veri)`,
      brand,
      url: `${mp.baseUrl}/dp/${externalId}`,
      imageUrl: null,
      sellerName: `${brand} Store`,
      price,
      currency: mp.currency,
      rating,
      reviewCount: baseReviews + dailyGrowth * dayIndex,
      rank: i + 1,
    });
  }
  return items;
}

async function realFetchCategoryProducts({ marketplaceCode, categorySlug, limit }) {
  const url = LISTING_URLS[marketplaceCode]?.[categorySlug];
  if (!url) {
    throw new Error(`LISTING_URLS eksik: ${marketplaceCode}/${categorySlug} (docs/cron.md Adım 1).`);
  }
  const rawItems = await runActorAndGetItems({
    actorId: APIFY_ACTOR,
    input: { listingUrls: [{ url }], maxProductResults: limit },
    token: process.env.APIFY_TOKEN,
    maxItems: limit,
  });
  const items = [];
  for (let i = 0; i < rawItems.length; i++) {
    const n = normalizeProduct(rawItems[i], marketplaceCode, i);
    if (n) items.push(n);
  }
  if (items.length === 0) {
    throw new Error(`Apify 0 geçerli ürün döndü: ${marketplaceCode}/${categorySlug}.`);
  }
  return items;
}

export async function fetchCategoryProducts(opts) {
  if (process.env.REAL_FETCH === "1") return realFetchCategoryProducts(opts);
  return mockCategoryProducts(opts);
}
