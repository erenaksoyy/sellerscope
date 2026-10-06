# SellerScope (MVP)

Aylık üyelikle satılan ürün trend paneli. Hedef kullanıcı: dropshipper + yurt dışından Türkiye'ye ürün getiren satıcı.

## Kapsam (MVP)
- Pazaryerleri: Amazon TR/US/DE, Trendyol TR, AliExpress global
- Filtreler: ülke/pazaryeri, kategori, son 7/30 gün, en çok satan + en hızlı yükselen, fiyat aralığı
- 3 ekran: panel, ürün detay, favoriler

## Veri modeli
- `db/schema.sql`: 8 tablo (marketplaces, categories, products, product_snapshots, category_daily_stats, users, favorites, category_follows)
- `db/seed.sql`: MVP pazaryeri + kategori tohumları
- Satış adedi her zaman **tahmini**dir: `yorum artışı x kategori katsayısı`. Gerçek adet gibi gösterilmez.

## Kurulum
```bash
# Postgres 15+ gerekli
createdb trendpanel
psql trendpanel -f db/schema.sql
psql trendpanel -f db/seed.sql
```

## Çalıştırma
```bash
npm install              # pg bağımlılığı (canlı koşu için)
npm test                 # tüm testler (DB'siz)
node worker/run.js --dry-run   # cron önizleme (DB'siz, ücretsiz mock)
DATABASE_URL=... JWT_SECRET=... npm run api   # panel API (:3000)
```

## Klasör yapısı
```
api/       # panel API (handler + auth + server)
db/        # schema + seed
docs/      # API sözleşmesi + cron rehberi
worker/    # günlük veri çekme (Apify/mock)
```

## MVP'de YOK
- Alibaba B2B, Hepsiburada, N11
- Mobil uygulama, gelişmiş grafikler, çoklu paket
