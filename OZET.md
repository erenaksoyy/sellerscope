# Trend Paneli — Yapılanlar Özeti

Son güncelleme: 5 Ekim 2026

## Proje fikri

E-ticaret satıcılarına (dropshipper'lar + yurt dışından Türkiye'ye ürün getirenler) aylık üyelikle satılan trend paneli: Hangi pazaryerinde, hangi ülkede, hangi kategori/ürün en çok satıyor; kaç adet satmış (tahmini). Cimri/Akakçe'de bu fonksiyon yok; farkımız ülke + pazaryeri + kategori filtreli satış istihbaratı.

## MVP kapsamı (kilitlenen)

- **Pazaryerleri:** Amazon TR/US/DE, Trendyol TR, AliExpress global (10 kategori, kategori başına 50 ürün)
- **MVP dışı:** Alibaba B2B, Hepsiburada, N11
- **Fiyatlandırma:** tek aylık plan + 7 gün deneme, tek limit favori sayısı (50)
- **Satış adedi her zaman "tahmini":** `yorum artışı × kategori katsayısı`, panelde etiketli gösterilir
- **Teknik tarz:** frameworksuz sade Node.js, tek bağımlılık `pg`

## Yapılanlar (sırayla)

### 1. Fikir doğrulama + MVP kapsamı
- Rakip analizi: Cimri/Akakçe fiyat karşılaştırma yapıyor, satış adedi istihbaratı vermiyor → boşluk doğrulandı.
- 3 pazaryeri tipi, 4 filtre (ülke/pazaryeri, kategori, 7/30 gün, en çok satan + yükselen, fiyat aralığı), 3 ekran (panel, ürün detay, favoriler).

### 2. Veritabanı şeması (`db/`)
- `schema.sql`: 9 tablo — `marketplaces`, `categories`, `products` (güncel durum), `product_snapshots` (günlük satır), `category_daily_stats` (hızlı panel özeti), `users` (+ `digest_enabled`), `favorites`, `category_follows`, `email_log`
- `seed.sql`: 5 pazaryeri + 10 kategori tohumu
- `migrations/001_digest.sql`: digest için `email_log` + `digest_enabled` (schema.sql'e de işlendi)
- Kural: ilk görülen ürüne 0 satış yazılır (şişirme önleme).

### 3. Günlük veri çekme cron'u (`worker/`)
- `run.js`: `--dry-run` ve `--marketplace=` destekli koşucu; DB upsert + snapshot + kategori özeti yazar
- `fetchers.js`: deterministik mock veri (ücretsiz, DB'siz önizleme)
- `estimate.js`: `estimateDailySales` — yorum artışı × katsayı (15/20/25, kalibre edilecek)
- `db.js`: Postgres erişim katmanı, `config.js`: pazaryeri/kategori/fetch ayarları

### 4. Gerçek çekim — Apify (`worker/apify.js`, `normalize.js`)
- Apify resmi aktörü `apify/e-commerce-scraping-tool` bağlandı; `LISTING_URLS` + normalize katmanı hazır
- Elenenler: `junglee/amazon-bestsellers` (.com.tr yok), `great_saint/trendyol-scraper` (yorum sayısı yok)
- `LISTING_URLS` bilerek **boş** bırakıldı (yanlış URL sessiz yanlış veri üretirdi) → manuel doldurulacak
- Gerçek mod dry-run'da tek çekim yapar (çift çekim 2× ücret yazardı)

### 5. Panel API'si (`api/`)
- 13 endpoint: `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/categories`, `GET /api/products` (top/rising + filtreler), `GET /api/products/:id` (+ satış serisi), `GET /api/explosions` (yurt dışı patlama), favoriler CRUD, kategori takip CRUD
- Auth: `node:crypto` scrypt + HS256 JWT, frameworksuz `node:http` sunucu
- `server.js` pg'yi dinamik import eder (DB'siz smoke çalışsın diye)

### 6. Haftalık e-posta özeti (`worker/digest.js`, `mailer.js`, `send-digest.js`)
- Takip edilen her kategoride son 7 günün yükselen ilk 5 ürünü, Pazartesi sabahı e-postayla
- Spam korumaları: haftada 1 (`email_log`), verisiz kategoriye bölüm yok, verisiz kullanıcıya mail yok, HTML escape'li
- Gönderim: Resend HTTP API (sıfır ek bağımlılık); CLI: `--dry-run`, `--email=` tek-kullanıcı filtresi

### 7. Testler + dokümantasyon
- `npm test`: **37/37 geçiyor** (estimate, apify, normalize, digest, mailer, auth, handler)
- E2E digest provası geçti: 2 e-posta, `email_log` yazıldı, Resend 401 hata yolu doğrulandı
- `docs/api.md` (endpoint sözleşmesi), `docs/cron.md` (Apify kurulum + zamanlama), `README.md`, `.env.example`

### 8. Gerçek Apify çıktısına uyarlama (`worker/normalize.js`)
- 5 ürün console testi yapıldı ($0.03 → ~$0.006/ürün ölçüldü); çıktı formatı görüldü
- `offers.price`/`priceCurrency`, `extraProperties` içindeki `customer reviews` ("4.7 (67,845)") ve marka/üretici çözülüyor; `brand.slogan`daki "Amazon Prime Logo" artığı ve görünmez yön karakterleri temizleniyor
- Yorum satırı olmayan ürünler 0 yorumla alınıyor (çökme yok); sıra = liste sırası
- `npm test`: **45/45 geçiyor** (+3 normalize testi)

### 9. Yurt dışı satış patlaması backend'i (`api/handler.js`, `worker/run.js`, `worker/config.js`)
- `GET /api/explosions`: pazaryerleri arası patlama listesi, varsayılan kapsam yurt dışı (US/DE/AliExpress); `change_pct` + `rank_jump` + `is_new` döndürür, `min_sales`/`min_change`/`limit` filtreli
- `worker/config.js`: `ABROAD_MARKETPLACES` tek doğruluk kaynağı; `run.js --abroad` yalnız yabancı hedefleri çeker (günde 4 kez cron örneği `docs/cron.md`'de)
- `npm test`: **42/42 geçiyor** (+3 handler, +2 run bayrak testi)

## Henüz yapılmayanlar

- **Frontend:** bilerek en sona bırakıldı (kullanıcı isteği)
- **Üyelik ve ödeme:** deneme bitince erişim kesme + iyzico/Stripe + webhook
- **Sertleştirme:** hız limiti (rate-limit), sağlık kontrolü, loglama
- **Kullanıcıya kalan manuel işler:** Apify token + 10 kategori `LISTING_URLS` doldurma, Resend hesabı + alan adı doğrulama, Postgres kurup schema+seed+migration çalıştırma, `reviewCoefficient` kalibrasyonu

## Durum notu

Bu ortamda canlı koşu yapılamadı: Postgres yok, Apify token yok, Resend anahtarı yok, npm registry sertifika hatası verdi (`npm install` kurulamadı). Tüm doğrulamalar DB'siz testler ve mock/E2E provalarıyla yapıldı. Sıradaki adım için sorulan soru: **üyelik ve ödeme mi, sertleştirme mi?**
