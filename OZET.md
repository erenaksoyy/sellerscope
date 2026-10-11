# Trend Paneli — Yapılanlar Özeti

Son güncelleme: 11 Ekim 2026

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
- `npm test`: **53/53 geçiyor** (+3 handler, +2 run bayrak testi, +3 normalize Trendyol/AliExpress testi)

### 10. Hata düzeltmeleri (7 Ekim 2026)
- **Hata toleransı:** `run.js` (hem `runDry` hem `runLive`) — tek kategori/pazaryeri hatası artık tüm çekimi durdurmuyor; hata loglanıp bir sonraki hedefe geçiliyor, sonunda başarısız hedefler raporlanıyor
- **0-ürün soft hatası:** `fetchers.js` — Apify 0 geçerli ürün döndüğünde artık throw yerine `console.warn` + boş dizi dönüyor
- **`refreshCategoryStats` country_code düzeltmesi:** `db.js` — SQL sorgusundaki WHERE ve alt sorguya `p.country_code = $3` filtresi eklendi, farklı ülkelerin verileri artık karışmıyor
- **Trendyol/AliExpress normalize genişletmesi:** `normalize.js` — `contentId`, `productId`, `merchantName`, `storeInfo`, `ratingScore`, `starRating`, `sellingPrice`, `orders`, `totalOrders`, `brandName`, `imgUrl`, `mainImage` alanları tanınıyor
- **Rank string desteği:** rank `"7"` gibi string geldiğinde artık parseInt ile çözülüyor

### 11. Canlıya engel hatalar + entegrasyon testi (11 Ekim 2026)
- **API açılmıyordu:** `api/server.js` — proje yolunda boşluk olduğu için giriş noktası kontrolü tutmuyor, `npm run api` hiçbir şey dinlemeden çıkıyordu; `fileURLToPath` ile düzeltildi
- **Veri okuyan SQL gerçek Postgres'te hata veriyordu:** `api/handler.js`, `worker/digest.js` — `CURRENT_DATE - $n` tip hatası (`$n::int`), `ROUND(float, int)` (`::numeric`), özet sorgusunda kapsam dışı tablo (JOIN'e çevrildi). `/api/products`, `/api/products/:id`, `/api/explosions` ve haftalık özet hiç çalışmıyordu; sahte query'li testler bunu göremiyordu
- **Sayı/tarih biçimi:** `worker/db.js` NUMERIC'i sayı döndürüyor (fiyat, puan, yüzde metin geliyordu); seri tarihi `YYYY-MM-DD` metni (saat dilimi kayması yok)
- **Yorum sayısı bilinmiyorsa NULL:** aktör amazon.com.tr'de çok yorumlu ürünlerde `reviewCount` döndürmüyor (2 çekimde 38/100 ürün), eskiden 0 yazılıyordu → sayı geldiği gün tamamı o günün satışı sayılırdı. Artık NULL tutuluyor, son bilinen değer ezilmiyor, artış 0 sayılıyor (`normalize.js`, `estimate.js` `reviewDelta`, `db.js`, `run.js`, `migrations/002_nullable_review_count.sql`)
- **Sıra:** aktör sıra döndürmüyor, veri seti sırası da liste sırası değil; sıra artık Best Sellers bağlantısındaki `zg_bs_..._sccl_N` değerinden okunuyor (`rankFromUrl`)
- **Entegrasyon testi:** `db/integration.test.js` — yerel Postgres'te geçici şemada şema + göç + seed, mock cron (2 gün), katalog uçları, üyelik akışı ve haftalık özet uçtan uca; yerel DB yoksa atlanır. `api/server.test.js` sunucunun gerçekten açıldığını doğrular
- **Yorum sayısı tamamlama:** `worker/fetchers.js` `backfillReviewCounts` — liste çekiminde sayısı boş kalan amazon.com.tr ürünleri için ürün sayfasından (`detailsUrls`) ikinci, küçük çekim; yalnız yorum sayısı alınır. Aç/kapa: `config.js` `REVIEW_BACKFILL_MARKETPLACES`. İki ücretli denemeyle bulundu (toplam $0.10): `/-/en/` ve `?language=en_US` etkisiz; ürün sayfası doğrudan verilince liste çekiminde boş gelen 2 üründe sayı geldi (1066 ve 1757). Gerçek 50 ürünlük koşuda henüz denenmedi
- `npm test`: **71/71 geçiyor** (+9 entegrasyon, +1 sunucu, +5 normalize/estimate, +3 fetchers)

## Henüz yapılmayanlar

- **Frontend:** bilerek en sona bırakıldı (kullanıcı isteği)
- **Üyelik ve ödeme:** deneme bitince erişim kesme + iyzico/Stripe + webhook
- **Sertleştirme:** hız limiti (rate-limit), sağlık kontrolü, loglama
- **Bilinen veri sorunları (açık):**
  - Yorum sayısı tamamlama yalnız amazon.com.tr'de ve yalnız 2 üründe doğrulandı; amazon.de (binlik ayracı aynı) hiç gerçek çekilmedi. Maliyeti sayısı boş ürün başına ~$0.009
  - Fırsat (yapılmadı): ürün sayfası çekimi Amazon'un kendi satış sinyalini de döndürüyor (`monthlyPurchaseVolume`: "Geçen ay 600 adetten fazla satın alındı") ve kategori sırasını (`bestsellerRanks`); `yorum × katsayı` tahminini kalibre etmek ya da değiştirmek için kullanılabilir
  - Aynı gün ikinci koşu günün artışını ezer (`--abroad` günde 4 koşuda yalnız son aralık kalır, aynı veriyle tekrar koşu satışı sıfırlar)
  - Listeden çıkıp günler sonra dönen ürünün birikmiş artışı tek güne yazılır
  - `change_pct` pencereleri: 7 gün seçilince 8 gün okunur, eski dönem 5 gün olup 4'e bölünür
  - Trendyol/AliExpress ürün kimliği gerçek çıktıyla doğrulanmadı; AliExpress'te sipariş sayısı yorum gibi × 25 çarpılıyor
  - `docs/cron.md` günlük cron örneğinde `REAL_FETCH=1` yok (o haliyle gerçek DB'ye mock ürün yazar)
- **Kullanıcıya kalan manuel işler:** Apify token + 10 kategori `LISTING_URLS` doldurma, Resend hesabı + alan adı doğrulama, Postgres kurup schema+seed+migration çalıştırma, `reviewCoefficient` kalibrasyonu

## Durum notu

11 Ekim 2026: yerel Postgres (`trendpanel`) kurulu; şema, seed ve 001/002 göçleri uygulanmış durumda. İçinde tek günlük gerçek çekim var (6 Ekim, amazon_tr, 2 kategori, 99 ürün); tek gün olduğu için bütün satış tahminleri henüz 0. API bu klasörden açılıyor ve gerçek veriyle yanıt veriyor. Resend ile gerçek gönderim denenmedi. Sıradaki adım: ikinci bir günün gerçek çekimi (yorum sayısı tamamlamayı 50 ürünlük koşuda doğrular ve ilk satış tahminlerini üretir), ardından **üyelik ve ödeme mi, sertleştirme mi?**
