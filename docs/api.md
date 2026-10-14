# API Sözleşmesi (MVP)

Tümü JSON. Tarih: YYYY-MM-DD. Hatalar: `{ "error": "mesaj" }` + HTTP kodu.
Korumalı uçlar `Authorization: Bearer <token>` ister (401 yoksa/bozuksa).

## Auth

### POST /api/auth/register
```json
{ "email": "a@b.c", "password": "en-az-8-karakter" }
```
201: `{ "token": "..." }` (7 gün deneme otomatik başlar).
400 geçersiz e-posta/şifre, 409 e-posta kayıtlı.

### POST /api/auth/login
```json
{ "email": "a@b.c", "password": "..." }
```
200: `{ "token": "..." }`. 401 hatalı bilgi.

## Katalog (herkese açık)

Ürün döndüren her uçta ortak alanlar:
- `url`: ürünün satıldığı sayfa (kullanıcı buraya yönlendirilir).
- `price_try`: fiyatın TL karşılığı (TCMB döviz satış kuru, en güncel gün);
  kur henüz yoksa `null`.
- `tr_status`: Türkiye durumu. `found` aynı ürün var, `similar` benzeri var,
  `not_found` aranan sitelerde bulunamadı, `unknown` arandı ama karar
  verilemedi, `unchecked` henüz bakılmadı.
- `tr_min_price`: Türkiye'deki en düşük ilan fiyatı (TL; aynı ürün ilanları
  varsa onlardan, yoksa benzerlerden). `tr_match_count`: eşleşen ilan sayısı.
  `tr_checked_on`: son otomatik kontrol günü.

### GET /api/markets
```json
{ "data": [{
  "code": "amazon_us", "name": "Amazon Amerika", "country": "US", "currency": "USD",
  "website": "https://www.amazon.com", "abroad": true,
  "categories": [{ "id": 12, "name": "Toys & Games", "slug": "toys-games",
                   "group": "oyuncak", "product_count": 30, "last_fetched_on": "2026-10-11" }]
}] }
```
Ülke → kategori gezinmesi için. `group`: aynı tür kategoriyi ülkeler arasında
birleştiren ortak anahtar (`ev-mutfak`, `elektronik`, `spor-outdoor`, `oyuncak`).

### GET /api/categories?marketplace=amazon_de
```json
{ "data": [{ "id": 1, "name": "Ev & Mutfak", "slug": "ev-mutfak" }] }
```
404 bilinmeyen pazaryeri.

### GET /api/products?marketplace=amazon_de&category=ev-mutfak&range=7d&sort=top&min_price=10&max_price=100&tr=
```json
{
  "data": [{
    "id": "uuid", "title": "Örnek ürün", "brand": "X",
    "url": "https://...", "image_url": null, "seller_name": "Y",
    "price": 29.99, "currency": "EUR", "rating": 4.5,
    "review_count": 1234, "bestseller_rank": 3,
    "sales": 420, "best_rank": 2, "change_pct": 18.5,
    "price_try": 1655.76, "tr_status": "found", "tr_min_price": 1999,
    "tr_match_count": 3, "tr_checked_on": "2026-10-11"
  }],
  "meta": { "range": "7d", "sort": "top" }
}
```
- `range`: 7d (varsayılan) | 30d. `sort`: top (varsayılan) | rising.
- `sales`: aralıktaki tahmini satış toplamı. `change_pct`: ikinci yarı/günlük
  ortalamanın ilk yarıya göre değişimi; yeni ürünlerde `null`.
- `rising` sıralaması `change_pct` büyükten küçüğe (`null` en üstte). `top`
  sıralamasında satışı eşit ürünler pazaryerinin kendi sırasına göre dizilir.
- `tr`: Türkiye durumuna göre süzer (`found`, `similar`, `not_found`,
  `unknown`, `unchecked`); verilmezse süzülmez.
- `review_count`: son bilinen yorum sayısı; kaynak hiç sayı vermediyse `null`
  (0 değil). `price` ve `rating` de `null` olabilir. Sayısal alanlar JSON
  sayısıdır (metin değil).
- Liste 50 ürünle sınırlı. 400 hatalı parametre, 404 bilinmeyen kategori.

### GET /api/opportunities?marketplace=&group=&category=&tr=not_found&sort=rank&limit=20
Yurt dışında satan, Türkiye'de bulunamayan ürünler. `/api/explosions` ile aynı
parametreleri ve aynı satır biçimini kullanır; farkı varsayılanlardır:
`tr=not_found`, `sort=rank` (pazaryerinin kendi çok satan sırası).
- `tr=similar`: Türkiye'de yalnız benzeri olanlar. `tr=all`: süzme.
- `group=oyuncak`: tek bir ortak kategori grubu, bütün ülkelerde.
- `meta.tr` ve `meta.sort` uygulanan değerleri gösterir.

### GET /api/explosions?marketplace=&category=&group=&range=7d&min_price=&max_price=&min_sales=&min_change=&tr=&sort=rising&limit=20
```json
{
  "data": [{
    "id": "uuid", "marketplace": "amazon_us", "category": "electronics",
    "title": "Örnek ürün", "price": 29.99, "currency": "USD",
    "sales": 420, "sales_recent": 350, "sales_prev": 70,
    "best_rank": 2, "rank_recent": 2, "rank_prev": 25, "rank_jump": 23,
    "change_pct": 400.0, "is_new": false, "group": "elektronik",
    "price_try": 1475.99, "tr_status": "unchecked", "tr_min_price": null,
    "tr_match_count": 0, "tr_checked_on": null
  }],
  "meta": {
    "range": "7d", "marketplaces": ["amazon_us", "amazon_de", "aliexpress_global"],
    "category": null, "group": null, "min_sales": null, "min_change": null,
    "tr": "all", "sort": "rising"
  }
}
```
- `marketplace` verilmezse kapsam **yurt dışıdır** (US/DE/AliExpress); `category` opsiyoneldir.
- `change_pct`: ikinci yarı günlük ortalamanın ilk yarıya göre değişimi; yeni ürünlerde `null` (`is_new: true`).
- `min_change` filtresi yeni ürünleri elemez (en güçlü patlama sinyali sayılır).
- Sıralama: `change_pct` büyükten küçüğe (`null` en üstte), sonra `sales_recent`, sonra `rank_jump`.
- `sort`: rising (varsayılan) | rank. `tr`: Türkiye durumu süzgeci (varsayılan yok).
- `limit` varsayılan 20, en fazla 50. `range`: 7d (varsayılan) | 30d.
- 400 hatalı parametre, 404 bilinmeyen pazaryeri.

### GET /api/products/:id?range=30d
```json
{
  "id": "uuid", "title": "Örnek ürün", "marketplace": "amazon_de",
  "price": 29.99, "currency": "EUR", "price_try": 1655.76,
  "tr": {
    "status": "found", "query": "JBL Vibe Beam 2 | kablosuz kulak içi kulaklık",
    "sources": ["amazon_tr", "hepsiburada_tr"], "checked_on": "2026-10-11",
    "rule_status": "found", "ai_status": null, "human_status": null,
    "human_note": null, "min_price": 2699,
    "matches": [{ "source": "amazon_tr", "kind": "same", "title": "JBL Vibe Beam2 ...",
                  "url": "https://www.amazon.com.tr/dp/...", "image_url": "https://...",
                  "seller_name": null, "price": 2699 }]
  },
  "series": [{ "date": "2026-09-28", "price": 29.99, "sales": 15, "rank": 5 }],
  "meta": { "range": "30d" }
}
```
- `tr.matches`: Türkiye'deki ilanlar (önce aynı ürün, sonra fiyata göre);
  `kind`: same | similar. Henüz bakılmamış üründe `tr` yalnızca
  `{ "status": "unchecked", "matches": [] }` olur.
- `tr.sources`: aramanın yapılabildiği siteler. "Türkiye'de yok" yerine
  "şu sitelerde bulunamadı" demek için kullanılır.
- `tr.query`: aranan ifade. İki arama yapıldıysa ` | ` ile ayrılır
  (önce marka + model, sonra ürün türü).

400 bozuk id, 404 yok.

## Türkiye durumu: elle karar (yönetici)

Yönetici: `users.is_admin = TRUE` olan kullanıcı
(`UPDATE users SET is_admin = TRUE WHERE email = '...'`). Değilse 403.

### PUT /api/products/:id/tr-status
```json
{ "status": "found", "note": "Trendyol'da gördüm" }
```
200: `{ "ok": true, "tr_status": "found" }`. `status`: found | similar |
not_found; `null` elle kararı kaldırır (otomatik sonuca dönülür). Elle karar
otomatik kontrolün önüne geçer ve yeniden kontrolde silinmez.
400 bozuk id/status, 404 bilinmeyen ürün.

### GET /api/tr-review?limit=20
İnsanın bakması gereken ürünler: yapay zekâ "bulunamadı" dedi
(`reason: "ai_not_found"`) ya da kural "var" derken yapay zekâ aksini söyledi
(`reason: "conflict"`). Elle karar verilenler listeden çıkar.

## Favoriler (auth)

- `GET /api/favorites` → `{ "data": [...] }`
- `POST /api/favorites` `{ "product_id": "uuid" }` → 201 yeni, 200 zaten
  var. Limit 50: dolunca 409. 404 bilinmeyen ürün.
- `DELETE /api/favorites/:productId` → `{ "ok": true }`

## Kategori takipleri (auth, haftalık e-posta)

- `GET /api/follows` → `{ "data": [{ "marketplace": "amazon_de", "category_id": 7, "name": "Ev", "slug": "ev" }] }`
- `POST /api/follows` `{ "marketplace": "amazon_de", "category_id": 7 }` → 201/200.
- `DELETE /api/follows/:categoryId` → `{ "ok": true }`

## Çalıştırma

```bash
npm install
DATABASE_URL=... JWT_SECRET=... npm run api   # :3000, PORT ile değişir
```
