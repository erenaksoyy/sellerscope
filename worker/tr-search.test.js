import test from "node:test";
import assert from "node:assert/strict";
import { parseAmazonTrSearch, parseHepsiburadaSearch, searchTurkey } from "./tr-search.js";

// Gerçek sayfa yapıları (11 Ekim 2026), kısaltılmış.
const amazonItem = ({ asin, title, price, ad = false }) => `
<div role="listitem" data-asin="${asin}" data-index="3" data-component-type="s-search-result" class="sg-col s-result-item s-asin${ad ? " AdHolder" : ""}">
<img class="s-image" src="https://m.media-amazon.com/images/I/${asin}.jpg" alt="x"/>
<h2 aria-label="${title}" class="a-size-base-plus"><span>${title}</span></h2>
${price ? `<span class="a-price"><span class="a-offscreen">${price}</span></span><span class="a-price a-text-price"><span class="a-offscreen">9.999,00&nbsp;TL</span></span>` : ""}
</div>`;
const amazonPage = (items) => `<html><body><div class="s-main-slot s-result-list" data-component-type="s-search-results">${items.join("")}</div></body></html>`;

const hbItem = ({ n, title, price, href }) => `
<a href="${href}"><img src="https://productimages.hepsiburada.net/s/777/222-222/${n}.jpg"/></a>
<h2 class="title-module_titleRoot__dNDiZ" id="product-title-${n}" aria-label="Sepete ekle, fiyat: ${price} TL, ${title}" data-test-id="title-${n}" tabindex="0"><a title="${title}" href="${href}">${title}</a></h2>`;
const hbPage = (items, total) => `<html><body>${items.join("")}<script type="mime/invalid" id="reduxStore">{"dynamicVariables":{"totalProductCount":${total},"keyword":"x"}}</script></body></html>`;

test("parseAmazonTrSearch: başlık, fiyat, bağlantı; reklamlar atlanır", () => {
  const out = parseAmazonTrSearch(amazonPage([
    amazonItem({ asin: "B0REKLAM01", title: "Sponsorlu Reklam - Başka ürün", price: "799,00&nbsp;TL", ad: true }),
    amazonItem({ asin: "B0HBCFCRJ9", title: "JBL Vibe Beam2 TWS Kablosuz Kulak İçi Kulaklık &amp; Kutu", price: "2.699,00&nbsp;TL" }),
    amazonItem({ asin: "B0DHL76W5V", title: "Fiyatı olmayan ilan", price: null }),
  ]));
  assert.deepEqual(out, [
    {
      source: "amazon_tr", title: "JBL Vibe Beam2 TWS Kablosuz Kulak İçi Kulaklık & Kutu",
      url: "https://www.amazon.com.tr/dp/B0HBCFCRJ9", price: 2699,
      imageUrl: "https://m.media-amazon.com/images/I/B0HBCFCRJ9.jpg", sellerName: null,
    },
    {
      source: "amazon_tr", title: "Fiyatı olmayan ilan", url: "https://www.amazon.com.tr/dp/B0DHL76W5V",
      price: null, imageUrl: "https://m.media-amazon.com/images/I/B0DHL76W5V.jpg", sellerName: null,
    },
  ]);
});

test("parseAmazonTrSearch: sonuçsuz sayfa [] döner, tanınmayan sayfa null", () => {
  assert.deepEqual(parseAmazonTrSearch(amazonPage([])), []);
  assert.equal(parseAmazonTrSearch("<html><body>bambaşka bir sayfa</body></html>"), null);
});

test("parseHepsiburadaSearch: kart başlığından ad, fiyat, bağlantı, görsel", () => {
  const out = parseHepsiburadaSearch(hbPage([
    hbItem({ n: 1, title: "JBL Vibe Beam2 TWS Kulaklık - Pembe", price: "2.789", href: "/jbl-vibe-beam2-pm-HBC0000DI6WFV?magaza=X" }),
    hbItem({ n: 2, title: "Powermaster Askı Aparatı", price: "491,89", href: "/powermaster-aski-pm-HBC1" }),
    hbItem({ n: 3, title: "Reklam ilanı", price: "10", href: "https://adservice.hepsiburada.com/click?x=1" }),
  ], 2));
  assert.deepEqual(out, [
    {
      source: "hepsiburada_tr", title: "JBL Vibe Beam2 TWS Kulaklık - Pembe",
      url: "https://www.hepsiburada.com/jbl-vibe-beam2-pm-HBC0000DI6WFV", price: 2789,
      imageUrl: "https://productimages.hepsiburada.net/s/777/222-222/1.jpg", sellerName: null,
    },
    {
      source: "hepsiburada_tr", title: "Powermaster Askı Aparatı",
      url: "https://www.hepsiburada.com/powermaster-aski-pm-HBC1", price: 491.89,
      imageUrl: "https://productimages.hepsiburada.net/s/777/222-222/2.jpg", sellerName: null,
    },
  ]);
});

test("parseHepsiburadaSearch: '0 ürün' [] döner; kart yok ama sayı varsa/bilinmiyorsa null", () => {
  assert.deepEqual(parseHepsiburadaSearch(hbPage([], 0)), []);
  assert.equal(parseHepsiburadaSearch(hbPage([], 4)), null); // sayfa yapısı değişmiş
  assert.equal(parseHepsiburadaSearch("<html><body>giriş yap</body></html>"), null);
});

test("searchTurkey: site başına limit; engellenen ve tanınmayan site 'aranamadı' sayılır", async () => {
  const fetchFn = async (url) => {
    if (url.includes("amazon.com.tr")) {
      return new Response(amazonPage([1, 2, 3].map((n) => amazonItem({ asin: `B0AAAAAAA${n}`, title: `Ürün ${n}`, price: "10,00 TL" }))));
    }
    return new Response("<html>Sorry, you have been blocked</html>", { status: 403 });
  };
  const res = await searchTurkey("jbl vibe beam 2", { sources: ["amazon_tr", "hepsiburada_tr"], limit: 2, fetchFn });
  assert.deepEqual(res.results.map((r) => r.title), ["Ürün 1", "Ürün 2"]);
  assert.deepEqual(res.searched, ["amazon_tr"]);
  assert.deepEqual(res.failed.map((f) => [f.code, f.blocked]), [["hepsiburada_tr", true]]);

  const odd = await searchTurkey("x", { sources: ["amazon_tr"], fetchFn: async () => new Response("<html>bakım</html>") });
  assert.deepEqual([odd.searched, odd.failed[0].blocked, odd.failed[0].message], [[], false, "arama sayfası tanınmadı"]);
});

test("searchTurkey: arama ifadesi adrese kodlanarak yazılır", async () => {
  const urls = [];
  const fetchFn = async (url) => {
    urls.push(url);
    return new Response(url.includes("amazon") ? amazonPage([]) : hbPage([], 0));
  };
  const res = await searchTurkey("tv askı aparatı", { sources: ["amazon_tr", "hepsiburada_tr"], fetchFn });
  assert.deepEqual(urls, [
    "https://www.amazon.com.tr/s?k=tv%20ask%C4%B1%20aparat%C4%B1",
    "https://www.hepsiburada.com/ara?q=tv%20ask%C4%B1%20aparat%C4%B1",
  ]);
  assert.deepEqual([res.results, res.searched, res.failed], [[], ["amazon_tr", "hepsiburada_tr"], []]);
});
