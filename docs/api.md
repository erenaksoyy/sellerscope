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

### GET /api/categories?marketplace=amazon_de
```json
{ "data": [{ "id": 1, "name": "Ev & Mutfak", "slug": "ev-mutfak" }] }
```
404 bilinmeyen pazaryeri.

### GET /api/products?marketplace=amazon_de&category=ev-mutfak&range=7d&sort=top&min_price=10&max_price=100
```json
{
  "data": [{
    "id": "uuid", "title": "Örnek ürün", "brand": "X",
    "url": "https://...", "image_url": null, "seller_name": "Y",
    "price": 29.99, "currency": "EUR", "rating": 4.5,
    "review_count": 1234, "bestseller_rank": 3,
    "sales": 420, "best_rank": 2, "change_pct": 18.5
  }],
  "meta": { "range": "7d", "sort": "top" }
}
```
- `range`: 7d (varsayılan) | 30d. `sort`: top (varsayılan) | rising.
- `sales`: aralıktaki tahmini satış toplamı. `change_pct`: ikinci yarı/günlük
  ortalamanın ilk yarıya göre değişimi; yeni ürünlerde `null`.
- `rising` sıralaması `change_pct` büyükten küçüğe (`null` en üstte).
- `review_count`: son bilinen yorum sayısı; kaynak hiç sayı vermediyse `null`
  (0 değil). `price` ve `rating` de `null` olabilir. Sayısal alanlar JSON
  sayısıdır (metin değil).
- Liste 50 ürünle sınırlı. 400 hatalı parametre, 404 bilinmeyen kategori.

### GET /api/explosions?marketplace=&category=&range=7d&min_price=&max_price=&min_sales=&min_change=&limit=20
```json
{
  "data": [{
    "id": "uuid", "marketplace": "amazon_us", "category": "electronics",
    "title": "Örnek ürün", "price": 29.99, "currency": "USD",
    "sales": 420, "sales_recent": 350, "sales_prev": 70,
    "best_rank": 2, "rank_recent": 2, "rank_prev": 25, "rank_jump": 23,
    "change_pct": 400.0, "is_new": false
  }],
  "meta": {
    "range": "7d", "marketplaces": ["amazon_us", "amazon_de", "aliexpress_global"],
    "category": null, "min_sales": null, "min_change": null
  }
}
```
- `marketplace` verilmezse kapsam **yurt dışıdır** (US/DE/AliExpress); `category` opsiyoneldir.
- `change_pct`: ikinci yarı günlük ortalamanın ilk yarıya göre değişimi; yeni ürünlerde `null` (`is_new: true`).
- `min_change` filtresi yeni ürünleri elemez (en güçlü patlama sinyali sayılır).
- Sıralama: `change_pct` büyükten küçüğe (`null` en üstte), sonra `sales_recent`, sonra `rank_jump`.
- `limit` varsayılan 20, en fazla 50. `range`: 7d (varsayılan) | 30d.
- 400 hatalı parametre, 404 bilinmeyen pazaryeri.

### GET /api/products/:id?range=30d
```json
{
  "id": "uuid", "title": "Örnek ürün", "marketplace": "amazon_de",
  "series": [{ "date": "2026-09-28", "price": 29.99, "sales": 15, "rank": 5 }],
  "meta": { "range": "30d" }
}
```
400 bozuk id, 404 yok.

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
