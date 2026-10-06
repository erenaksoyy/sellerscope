// Aktör çıktısı -> worker satır şekli. Aktörden aktöre alan adları değişir,
// o yüzden her alan için bilinen takma adlar denenir.

import { MARKETPLACES } from "./config.js";

function first(...vals) {
  for (const v of vals) {
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

// "4.299 TL" -> 4299, "29,99 €" -> 29.99, "$1,299.99" -> 1299.99
export function parsePrice(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  let s = value.replace(/[^\d.,]/g, "");
  if (!s) return null;
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let decSep = null;
  if (lastDot !== -1 && lastComma !== -1) {
    decSep = lastDot > lastComma ? "." : ",";
  } else if (lastComma !== -1) {
    decSep = s.length - lastComma - 1 === 3 ? null : ","; // "4,299" binlik mi ondalık mı?
  } else if (lastDot !== -1) {
    decSep = s.length - lastDot - 1 === 3 ? null : ".";
  }
  if (decSep) {
    const parts = s.split(decSep);
    const intPart = parts.slice(0, -1).join("").replace(/[.,]/g, "");
    s = `${intPart}.${parts[parts.length - 1]}`;
  } else {
    s = s.replace(/[.,]/g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// "4,6" -> 4.6, "4.5 out of 5" -> 4.5
export function parseRating(value) {
  if (typeof value === "number") return value >= 0 && value <= 5 ? value : null;
  if (typeof value !== "string") return null;
  const m = value.replace(",", ".").match(/(\d+(\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 0 && n <= 5 ? Math.round(n * 10) / 10 : null;
}

// "1,234" -> 1234, "2.3k" -> 2300, "(567)" -> 567
export function parseCount(value) {
  if (typeof value === "number") return Number.isInteger(value) && value >= 0 ? value : null;
  if (typeof value !== "string") return null;
  const s = value.trim().toLowerCase();
  const mult = s.endsWith("k") ? 1000 : s.endsWith("m") ? 1000000 : 1;
  const digits = s.replace(/[^\d]/g, "");
  if (!digits) return null;
  // "2.3k" durumu: nokta ondalıktı, rakamlar "23" oldu -> 2.3 * 1000
  if (mult > 1 && /[.,]\d/.test(s)) {
    const n = Number(s.replace(/[^\d.,]/g, "").replace(",", "."));
    return Number.isFinite(n) ? Math.round(n * mult) : null;
  }
  return Number(digits);
}

// Aktörün "customer reviews" hücresi: "4.0 (15,444)" -> { rating: 4, reviewCount: 15444 }
export function parseCustomerReviews(value) {
  const none = { rating: null, reviewCount: null };
  if (typeof value !== "string") return none;
  const m = value.match(/([\d.,]+)\s*\(([^)]+)\)/);
  if (!m) return none;
  return { rating: parseRating(m[1]), reviewCount: parseCount(m[2]) };
}

// additionalProperties.extraProperties listesi -> { "customer reviews": "4.0 (15,444)", ... }
export function extraProps(raw) {
  const list = raw?.additionalProperties?.extraProperties;
  const map = {};
  if (!Array.isArray(list)) return map;
  for (const e of list) {
    if (e && typeof e.name === "string" && typeof e.value === "string") {
      map[stripBidi(e.name).toLowerCase()] = e.value;
    }
  }
  return map;
}

function stripBidi(s) {
  return s.replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, "").trim();
}

function cleanBrand(value) {
  if (typeof value !== "string") return null;
  const s = value.replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, "").trim(); // Amazon'un görünmez yön karakterleri
  if (!s || /logo/i.test(s)) return null; // "Amazon Prime Logo" gibi arayüz artıkları
  return s;
}

export function extractExternalId(url) {
  if (!url) return null;
  const asin = url.match(/\/dp\/([A-Z0-9]{10})(?:[/?]|$)/);
  if (asin) return asin[1];
  const pid = url.match(/[?&](?:id|productId)=([^&]+)/);
  if (pid) return decodeURIComponent(pid[1]).slice(0, 64);
  let h = 2166136261;
  for (let i = 0; i < url.length; i++) {
    h ^= url.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `url-${(h >>> 0).toString(36)}`;
}

// Ham aktör öğesi -> normalize ürün. Geçersizse null (liste dışı bırakılır).
export function normalizeProduct(raw, marketplaceCode, index) {
  if (!raw || typeof raw !== "object") return null;
  const mp = MARKETPLACES[marketplaceCode];
  if (!mp) throw new Error(`Bilinmeyen pazaryeri: ${marketplaceCode}`);

  const title = first(raw.title, raw.name, raw.productTitle, raw.productName);
  const url = first(raw.url, raw.link, raw.productUrl, raw.detailUrl);
  if (!title || !url) return null;

  const rankRaw = first(raw.rank, raw.position, raw.rankPosition, raw.bestsellerRank);
  const rank = Number.isInteger(rankRaw) && rankRaw > 0 ? rankRaw : index + 1;

  const extra = extraProps(raw);
  const cr = parseCustomerReviews(extra["customer reviews"]);
  const slogan = raw.brand && typeof raw.brand === "object" ? raw.brand.slogan : null;

  return {
    externalId: extractExternalId(String(url)),
    title: String(title).slice(0, 500),
    brand: cleanBrand(extra.brand)
      ?? cleanBrand(extra.manufacturer)
      ?? (typeof raw.brand === "string" ? cleanBrand(raw.brand) : null)
      ?? cleanBrand(slogan)
      ?? cleanBrand(raw.manufacturer),
    url: String(url),
    imageUrl: first(raw.imageUrl, raw.image, raw.thumbnail, raw.thumbnailImage, null) ?? null,
    sellerName: first(raw.sellerName, raw.seller, raw.storeName, raw.merchantName, null) ?? null,
    price: parsePrice(first(raw.price, raw.offers?.price, raw.priceValue, raw.currentPrice, raw.salePrice)),
    currency: first(raw.currency, raw.currencyCode, raw.offers?.priceCurrency, mp.currency),
    rating: cr.rating ?? parseRating(first(raw.rating, raw.stars, raw.averageRating)),
    reviewCount: cr.reviewCount
      ?? parseCount(first(raw.reviewsCount, raw.reviewCount, raw.ratingsTotal, raw.ratingsCount, raw.numberOfRatings, raw.totalReviews, raw.review_count))
      ?? 0,
    rank,
  };
}
