import test from "node:test";
import assert from "node:assert/strict";
import { parseAmazonList, fetchAmazonList } from "./amazon-lists.js";
import { BlockedError } from "./html.js";

// Gerçek sayfa yapısı (11 Ekim 2026, amazon.com / amazon.de Best Sellers), kısaltılmış.
const card = ({ asin, rank, title, stars, price }) => `
<div id="gridItemRoot" class="a-column"><div id="p13n-asin-index-0" class="a-cardui">
<div data-asin="${asin}" class="_cDEzb_iveVideoWrapper_JJ34T">
<div class="a-section zg-bdg-ctr"><span class="zg-bdg-text">#${rank}</span></div>
<a class="a-link-normal aok-block" href="/x/dp/${asin}/ref=zg_bs_g_toys_d_sccl_${rank}/141-1?psc=1">
<img alt="${title.slice(0, 20)}" src="https://images-na.ssl-images-amazon.com/images/I/${asin}.jpg" class="p13n-product-image"/></a>
<a class="a-link-normal aok-block" href="/x/dp/${asin}/"><span><div class="_cDEzb_p13n-sc-css-line-clamp-3_g3dy1">${title}</div></span></a>
${stars ? `<a aria-label="${stars}" class="a-link-normal" href="/product-reviews/${asin}/"><i class="a-icon"></i></a>` : ""}
${price ? `<span class="a-color-secondary">11 offers from <span><span class="p13n-sc-price">${price}</span></span></span>` : ""}
</div></div></div>`;

test("parseAmazonList: sıra, puan, yorum sayısı, fiyat ve para birimi", () => {
  const html = `<html><body>${[
    card({ asin: "B0BBBBBBB2", rank: 2, title: "30 Pack Squishy Toys", stars: "4.6 out of 5 stars, 5,430 ratings", price: "$9.99" }),
    card({ asin: "B0AAAAAAA1", rank: 1, title: "Horizon Group USA Slimygloop &amp; Gels", stars: "4.3 out of 5 stars, 1,189 ratings", price: "$1,299.00" }),
    card({ asin: "B0CCCCCCC3", rank: 3, title: "Henüz puanı olmayan ürün", stars: null, price: null }),
  ].join("")}</body></html>`;
  const items = parseAmazonList(html, "amazon_us");
  assert.deepEqual(items.map((p) => p.rank), [1, 2, 3]); // sayfadaki sıraya değil rozete göre
  assert.deepEqual(items[0], {
    externalId: "B0AAAAAAA1", title: "Horizon Group USA Slimygloop & Gels", brand: null,
    url: "https://www.amazon.com/dp/B0AAAAAAA1",
    imageUrl: "https://images-na.ssl-images-amazon.com/images/I/B0AAAAAAA1.jpg",
    sellerName: null, price: 1299, currency: "USD", rating: 4.3, reviewCount: 1189, rank: 1,
  });
  assert.deepEqual([items[2].price, items[2].rating, items[2].reviewCount], [null, null, null]);
});

test("parseAmazonList: Almanca sayfa (virgüllü puan, noktalı binlik, euro)", () => {
  const html = card({
    asin: "B0FD44RDQV", rank: 2, title: "Echo Dot Kids", stars: "4,5 von 5 Sternen, 10.162 Bewertungen", price: "29,99&nbsp;€",
  });
  const [p] = parseAmazonList(html, "amazon_de");
  assert.deepEqual([p.rating, p.reviewCount, p.price, p.currency, p.url],
    [4.5, 10162, 29.99, "EUR", "https://www.amazon.de/dp/B0FD44RDQV"]);
  // Çerez tutmazsa fiyat TL gösterilir: para birimi metinden okunur.
  const [tl] = parseAmazonList(card({ asin: "B0FD44RDQV", rank: 1, title: "X", stars: null, price: "2.763,04 TRY" }), "amazon_de");
  assert.deepEqual([tl.price, tl.currency], [2763.04, "TRY"]);
});

test("fetchAmazonList: para birimi çereziyle çeker, limit uygular", async () => {
  const calls = [];
  const fetchFn = async (url, opts) => {
    calls.push({ url, opts });
    return new Response([1, 2, 3].map((n) => card({ asin: `B0AAAAAAA${n}`, rank: n, title: `Ürün ${n}`, stars: null, price: "9,99 €" })).join(""));
  };
  const items = await fetchAmazonList({ url: "https://www.amazon.de/gp/bestsellers/toys/", marketplaceCode: "amazon_de", limit: 2, fetchFn });
  assert.deepEqual(items.map((p) => p.externalId), ["B0AAAAAAA1", "B0AAAAAAA2"]);
  assert.equal(calls[0].opts.headers.Cookie, "i18n-prefs=EUR");
  assert.match(calls[0].opts.headers["Accept-Language"], /^de-DE/);
});

test("fetchAmazonList: bot doğrulaması ve boş sayfa hata verir (ürün uydurulmaz)", async () => {
  const challenge = async () => new Response(`<html><meta http-equiv="refresh" content="5; URL='/s?bm-verify=AAQ'"/></html>`);
  await assert.rejects(
    fetchAmazonList({ url: "https://www.amazon.com/x", marketplaceCode: "amazon_us", limit: 30, fetchFn: challenge }),
    BlockedError
  );
  const empty = async () => new Response("<html><body>Sorry, there are no items</body></html>");
  await assert.rejects(
    fetchAmazonList({ url: "https://www.amazon.com/x", marketplaceCode: "amazon_us", limit: 30, fetchFn: empty }),
    /ürün bulunamadı/
  );
});
