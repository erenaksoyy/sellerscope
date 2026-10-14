// Türkiye'de arama: bir ürünün TR sitelerindeki ilanlarını getirir. Arama
// sayfaları doğrudan (ücretsiz) çekilir. Ayrıştırıcılar sayfayı tanımazsa
// null döner; "sonuç yok" ile "sayfa okunamadı" ayrı tutulur, çünkü ikincisi
// "Türkiye'de yok" sayılırsa yanlış fırsat üretir.

import { TR_SEARCH_SOURCES, TR_RESULTS_PER_SOURCE } from "./config.js";
import { parsePrice } from "./normalize.js";
import { fetchHtml, decodeEntities, BlockedError } from "./html.js";

const attr = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];

// amazon.com.tr/s?k=... -> [{ source, title, url, price, imageUrl, sellerName }]
export function parseAmazonTrSearch(html) {
  const page = String(html);
  if (!/data-component-type="s-search-results"|s-main-slot/.test(page)) return null;
  const out = [];
  for (const part of page.split(/(?=<div[^>]*data-component-type="s-search-result")/).slice(1)) {
    const open = part.slice(0, part.indexOf(">") + 1);
    const asin = attr(open, "data-asin");
    const title = decodeEntities(part.match(/<h2[^>]*aria-label="([^"]*)"/)?.[1] ?? "").trim();
    if (!asin || !title) continue;
    if (/AdHolder/.test(open) || /^Sponsorlu/i.test(title)) continue; // reklam: aramayla ilgisiz olabilir
    const img = part.match(/<img[^>]*class="s-image"[^>]*>/)?.[0] ?? "";
    out.push({
      source: "amazon_tr",
      title: title.slice(0, 500),
      url: `https://www.amazon.com.tr/dp/${asin}`,
      price: parsePrice(decodeEntities(part.match(/<span class="a-offscreen">([^<]*)<\/span>/)?.[1] ?? "")),
      imageUrl: attr(img, "src") ?? null,
      sellerName: null,
    });
  }
  return out;
}

// hepsiburada.com/ara?q=... Kart başlığı: <h2 aria-label="Sepete ekle, fiyat:
// 2.789 TL, <ad>" data-test-id="title-1"><a title="<ad>" href="/...-pm-HBC...">
export function parseHepsiburadaSearch(html) {
  const page = String(html);
  const out = [];
  const re = /<h2\b([^>]*)>\s*<a\s+([^>]*)>/g;
  let prevEnd = 0;
  for (let m = re.exec(page); m; m = re.exec(page)) {
    if (!/data-test-id="title-/.test(m[1])) continue;
    const label = decodeEntities(attr(m[1], "aria-label") ?? "");
    const title = decodeEntities(attr(m[2], "title") ?? "").trim();
    const href = decodeEntities(attr(m[2], "href") ?? "");
    const images = [...page.slice(prevEnd, m.index).matchAll(/<img[^>]*\bsrc="(https:\/\/productimages\.hepsiburada\.net[^"]*)"/g)];
    prevEnd = re.lastIndex;
    if (!title || !href.startsWith("/")) continue; // reklam yönlendirmeleri tam adres taşır
    out.push({
      source: "hepsiburada_tr",
      title: title.slice(0, 500),
      url: `https://www.hepsiburada.com${href.split("?")[0]}`,
      price: parsePrice(label.match(/fiyat:\s*([\d.,]+)\s*TL/)?.[1] ?? ""),
      imageUrl: images.at(-1)?.[1] ?? null,
      sellerName: null,
    });
  }
  if (out.length > 0) return out;
  // Kart yoksa: sayfa "0 ürün" diyorsa gerçekten sonuç yok, demiyorsa tanınmadı.
  const total = page.match(/"totalProductCount":\s*(\d+)/);
  return total && Number(total[1]) === 0 ? [] : null;
}

export const TR_SITES = {
  amazon_tr: {
    url: (q) => `https://www.amazon.com.tr/s?k=${encodeURIComponent(q)}`,
    parse: parseAmazonTrSearch,
  },
  hepsiburada_tr: {
    url: (q) => `https://www.hepsiburada.com/ara?q=${encodeURIComponent(q)}`,
    parse: parseHepsiburadaSearch,
  },
};

// Dönen: results (site başına en fazla limit ilan), searched (yanıt veren
// siteler), failed ([{ code, blocked, message }]). Hata fırlatmaz.
export async function searchTurkey(query, {
  sources = TR_SEARCH_SOURCES, limit = TR_RESULTS_PER_SOURCE, fetchFn,
} = {}) {
  const results = [];
  const searched = [];
  const failed = [];
  for (const code of sources) {
    const site = TR_SITES[code];
    try {
      if (!site) throw new Error("bilinmeyen TR kaynağı");
      const items = site.parse(await fetchHtml(site.url(query), { fetchFn }));
      if (items === null) throw new Error("arama sayfası tanınmadı");
      results.push(...items.slice(0, limit));
      searched.push(code);
    } catch (err) {
      failed.push({ code, blocked: err instanceof BlockedError, message: err.message });
    }
  }
  return { results, searched, failed };
}
