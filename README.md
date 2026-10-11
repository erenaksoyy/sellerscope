# SellerScope (MVP)

Aylık üyelikle satılan ürün trend paneli. Hedef kullanıcı: dropshipper + yurt dışından Türkiye'ye ürün getiren satıcı.

## Kapsam (MVP)
- Pazaryerleri: Amazon TR/US/DE, Trendyol TR, AliExpress global
- Filtreler: ülke/pazaryeri, kategori, son 7/30 gün, en çok satan + en hızlı yükselen, fiyat aralığı
- 3 ekran: panel, ürün detay, favoriler

## Veri modeli
- `db/schema.sql`: 9 tablo (marketplaces, categories, products, product_snapshots, category_daily_stats, users, favorites, category_follows, email_log)
- `db/seed.sql`: MVP pazaryeri + kategori tohumları
- `db/migrations/`: mevcut kurulumu güncel şemaya taşıyan dosyalar (sıfır kurulumda gerekmez)
- Satış adedi her zaman **tahmini**dir: `yorum artışı x kategori katsayısı`. Gerçek adet gibi gösterilmez.
- Yorum sayısı alınamayan üründe sayı `NULL` (bilinmiyor) tutulur, 0 yazılmaz; o gün için satış tahmini 0'dır.

## Kurulum
```bash
# Postgres 15+ gerekli
createdb trendpanel
psql trendpanel -f db/schema.sql
psql trendpanel -f db/seed.sql

# Daha önce kurulmuş veritabanında: eksik göçleri sırayla uygula
psql trendpanel -f db/migrations/001_digest.sql
psql trendpanel -f db/migrations/002_nullable_review_count.sql
```

## Çalıştırma
```bash
npm install              # pg bağımlılığı (canlı koşu + entegrasyon testi için)
npm test                 # tüm testler
node worker/run.js --dry-run   # cron önizleme (DB'siz, ücretsiz mock)
DATABASE_URL=... JWT_SECRET=... npm run api   # panel API (:3000)
```

`npm test` birim testlerini DB'siz koşar. `db/integration.test.js` ise gerçek
Postgres ister: `DATABASE_URL` yerel (localhost) bir sunucuyu gösteriyorsa ya da
`TEST_DATABASE_URL` tanımlıysa orada geçici bir şema açar, şema + göç + seed +
cron + API sorgularını uçtan uca dener ve şemayı siler (mevcut tablolara
dokunmaz, Apify çağırmaz). İkisi de yoksa bu testler atlanır.

## Klasör yapısı
```
api/       # panel API (handler + auth + server)
db/        # schema + seed + göçler + entegrasyon testi
docs/      # API sözleşmesi + cron rehberi
worker/    # günlük veri çekme (Apify/mock)
```

## MVP'de YOK
- Alibaba B2B, Hepsiburada, N11
- Mobil uygulama, gelişmiş grafikler, çoklu paket
