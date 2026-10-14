// Amazon liste sayfalarını (Best Sellers, New Releases) doğrudan çeker:
// Apify'sız, ücretsiz. Sayfa ilk 30 ürünü HTML içinde verir (kalanı sonradan
// yüklenir); sıra, puan, yorum sayısı ve fiyat sayfada hazır gelir.

import { MARKETPLACES } from "./config.js";
import { parsePrice, parseRating, parseCount } from "./normalize.js";
import { fetchHtml, decodeEntities } from "./html.js";

const LANGUAGES = { US: "en-US,en;q=0.9", DE: "de-DE,de;q=0.9", TR: "tr-TR,tr;q=0.9" };

function currencyOf(priceText, fallback) {
  if (/\$/.test(priceText)) return "USD";
  if (/€|EUR/.test(priceText)) return "EUR";
  if (/£|GBP/.test(priceText)) return "GBP";
  if (/TRY|TL|₺/.test(priceText)) return "TRY";
  return fallback;
}

// Liste sayfası HTML'i -> normalize ürünler (worker satır şekli). Marka sayfada
// ayrı gelmez (başlığın başındadır), o yüzden null.
export function parseAmazonList(html, marketplaceCode) {
  const mp = MARKETPLACES[marketplaceCode];
  if (!mp) throw new Error(`Bilinmeyen pazaryeri: ${marketplaceCode}`);
  const items = [];
  for (const part of String(html).split(/(?=<div[^>]*id="gridItemRoot")/).slice(1)) {
    const asin = part.match(/data-asin="([A-Z0-9]{10})"/)?.[1];
    const rank = Number(part.match(/zg-bdg-text">#?(\d+)</)?.[1]);
    const title = part.match(/p13n-sc-css-line-clamp-\d+_[^"]*">([^<]+)</)?.[1]
      ?? part.match(/<img[^>]*alt="([^"]+)"/)?.[1];
    if (!asin || !title || !Number.isInteger(rank)) continue;
    // "4.3 out of 5 stars, 1,189 ratings" / "4,5 von 5 Sternen, 10.162 Bewertungen"
    const stars = part.match(/aria-label="([\d.,]+)[^",]*,\s*([\d.,]+)[^"]*"/);
    const priceText = decodeEntities(part.match(/p13n-sc-price[^>]*>([^<]+)</)?.[1] ?? "");
    items.push({
      externalId: asin,
      title: decodeEntities(title).trim().slice(0, 500),
      brand: null,
      url: `${mp.baseUrl}/dp/${asin}`,
      imageUrl: part.match(/<img[^>]*src="([^"]+)"/)?.[1] ?? null,
      sellerName: null,
      price: parsePrice(priceText),
      currency: currencyOf(priceText, mp.currency),
      rating: stars ? parseRating(stars[1]) : null,
      reviewCount: stars ? parseCount(stars[2]) : null,
      rank,
    });
  }
  return items.sort((a, b) => a.rank - b.rank);
}

export async function fetchAmazonList({ url, marketplaceCode, limit, fetchFn }) {
  const mp = MARKETPLACES[marketplaceCode];
  if (!mp) throw new Error(`Bilinmeyen pazaryeri: ${marketplaceCode}`);
  // i18n-prefs: sitenin para birimi seçicisinin çerezi; yoksa Türkiye'den
  // gelen ziyaretçiye fiyat TRY'ye çevrilmiş gösterilir.
  const html = await fetchHtml(url, {
    language: LANGUAGES[mp.country], cookie: `i18n-prefs=${mp.currency}`, fetchFn,
  });
  const items = parseAmazonList(html, marketplaceCode);
  if (items.length === 0) {
    throw new Error("liste sayfasında ürün bulunamadı (sayfa yapısı değişmiş olabilir)");
  }
  return items.slice(0, limit);
}
