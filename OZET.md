# Trend Paneli — Yapılanlar Özeti

Son güncelleme: 14 Ekim 2026

## Proje fikri

Yurt dışı pazarlarını tarayan fırsat paneli (Helium10 benzeri, ama odak Türkiye'ye taşınabilecek ürünler): hangi ülkede, hangi kategoride ne çok satıyor ya da hızla yükseliyor; bu ürün **Türkiye'de var mı, varsa kaça**. Asıl değer "yurt dışında satıyor, Türkiye'de yok" listesi. Çıkış örneği: yurt dışında gördüğü çocuk eğitim ürününü Türkiye'de üretip rakipsiz satan Trendyol satıcısı. Hedef kullanıcı: girişimciler ve alanında dünyada ne çıktığını izleyenler. Ürüne tıklayan satıldığı siteye gider.

İlk fikir (6 Ekim) genel bir satış istihbaratı paneliydi; 11 Ekim'de hedef yukarıdaki gibi netleşti. Türkiye pazaryerleri artık taranan değil, karşılaştırılan taraf.

## Kapsam

- **Taranan pazarlar:** Amazon ABD ve Almanya (7 kategori, liste başına 30 ürün, ücretsiz doğrudan çekim). AliExpress, Amazon TR, Trendyol listeleri kodda duruyor ama Apify ile ücretli
- **Türkiye karşılaştırması:** amazon.com.tr + Hepsiburada araması (ücretsiz). Trendyol doğrudan erişimi engelliyor
- **Bütçe kısıtı:** Apify ücretsiz planda ($5/ay); ücretli yapay zekâ anahtarı yok, Gemini ve NVIDIA'nın ücretsiz katmanları kullanılıyor
- **Şimdilik yalnız backend;** arayüz en sona
- **Fiyatlandırma (ilk plan):** tek aylık plan + 7 gün deneme, tek limit favori sayısı (50)
- **Satış adedi her zaman "tahmini":** `yorum artışı × kategori katsayısı`
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

### 12. Yurt dışı fırsat paneli: Türkiye karşılaştırması + ücretsiz çekim (11 Ekim 2026)
- **Fizibilite (hepsi ücretsiz denendi):** Trendyol doğrudan çekimi engelliyor (Cloudflare 403; zorlanmadı). amazon.com.tr ve Hepsiburada arama sayfaları doğrudan okunabiliyor. amazon.com / amazon.de Best Sellers ve New Releases sayfaları doğrudan okunabiliyor (ilk 30 ürün; sıra, puan, yorum sayısı, fiyat hazır). Movers & Shakers doğrudan çekimde boş geliyor. Amazon yaklaşık bir düzine art arda istekten sonra bir kez bot doğrulama sayfası döndürdü
- **Ücretsiz liste çekimi:** `worker/amazon-lists.js` + `html.js`; `config.js` `DIRECT_LIST_MARKETPLACES` (amazon_us, amazon_de). `run.js --free` Apify'a hiç gitmez. Engel gelirse liste hata verir, ücretli yola kendiliğinden geçilmez
- **Kur:** `worker/fx.js` TCMB günlük XML → `fx_rates`; API her üründe `price_try` döndürür
- **Türkiye karşılaştırması:** `worker/tr-search.js` (iki sitenin arama ayrıştırıcıları; "sonuç yok" ile "sayfa okunamadı" ayrı), `tr-match.js` (kural katmanı + yapay zekâ katmanı), `llm.js` (Gemini + NVIDIA, işe göre model zinciri, yalnız fetch), `tr-check.js` (iş: aday seçimi, engellenen siteyi bırakma, kota bitince kurala düşme). Sonuçlar `tr_checks` / `tr_matches`
- **Üç katmanlı karar:** kural yalnız "var" diyebilir; yapay zekâ var / benzeri var / bulunamadı der; insan (yönetici) düzeltir ve kararı otomatik kontrolde korunur. Üçü ayrı sütunda, geçerli olan `insan > yapay zekâ > kural`
- **API:** her ürün satırında `price_try` + `tr_status` + `tr_min_price`; `tr=` süzgeci; yeni `GET /api/opportunities` (varsayılan TR'de bulunamayanlar), `GET /api/markets` (ülke → kategori), `PUT /api/products/:id/tr-status` ve `GET /api/tr-review` (yönetici, `users.is_admin`)
- **Ortak kategori:** `categories.group_slug` (ev-mutfak, elektronik, spor-outdoor, oyuncak); yeni Oyuncak kategorileri (amazon_us `toys-games`, amazon_de `oyuncak`); göç `003_tr_checks.sql`
- **Gerçek koşu (ücretsiz):** amazon.com 3 liste + amazon.de 4 liste = 209 ürün, hepsinde yorum sayısı ve sıra var. 6 ürün Türkiye'de arandı: 2'si kural katmanıyla bulundu (Stanley Quencher: yurt dışı 1.386 TL, Türkiye 1.585 TL; AirPods Pro 3: 9.028 TL / 11.499 TL), 4 jenerik ürün "karar yok" (yapay zekâ ya da insan gerekiyor)
- **Ücretli denemeler (12 Ekim, toplam $0.0025, üçü de olumsuz):** genel Apify aktörü Trendyol'da anahtar kelime aramasından yanıt alamadı; arama adresi liste olarak verilince 0 ürün döndü; amazon.com Movers & Shakers sayfasından 0 ürün çıkardı. Sonuç gelmediği için ürün ücreti yazılmadı
- **Yapay zekâ modeli (12 Ekim):** gerçek anahtarla denendi, varsayılan `gemini-3.5-flash-lite` oldu (ücretsiz katmanda dakikada 15, günde 500 istek; çağrı 1-2 sn). Önceki varsayılan `gemini-flash-latest` Gemini 3.8 Flash'a gidiyor: günde 20 istek, çağrıların çoğu HTTP 503. Karşılaştırma tablosu `docs/cron.md` içinde. İlk yapay zekâlı koşu (5 ürün, amazon.de): 2 "var" (Pokémon 30. yıl kutusu: yurt dışı ≈ 2.760 TL, Türkiye 29.999 TL; De'Longhi EcoDecalk), 3 "benzeri var"
- **Yapay zekâ katmanı sağlamlaştırma (13 Ekim):** (1) ürün başına iki arama: yapay zekâ başlıktan marka, model ve Türkçe ürün türünü çıkarır, kod "marka + model" ve "ürün türü" aramalarını kurar (önceden tek arama vardı ve model markayı düşürüyordu). (2) Yapay zekâsız bakılmış ürünler 20 saat sonra yeniden aday. (3) HTTP 500/503'te yeniden deneme + yedek model `gemini-3.1-flash-lite` (asıl model 13 Ekim'deki denemelerde aralıklı olarak HTTP 503 ve zaman aşımı verdi, yedek çalıştı). (4) Yapay zekâ karar veremez ve kural da bulamazsa sonuç yazılmaz (eski kayıt ezilmez). Gerçek koşu: De'Longhi EcoDecalk'ta "aynı ürün" ilanı 1'den 8'e çıktı; Echo Dot Kids yurt dışı 1.656 TL / Türkiye 7.762 TL; Echo Dot 1.656 TL / 5.402 TL
- **İkinci yapay zekâ sağlayıcısı: NVIDIA (14 Ekim):** 9 model aynı testten geçti (10 ürünün arama ifadesi + 26 ilanlık 3 karar testi). İlan kararında Nemotron 3 Super ve GLM 5.3 hatasız (Gemini 2 hata), ama Nemotron'un Türkçe arama ifadeleri bozuk, GLM yavaş (35-75 sn); 6 model 90 sn'de yanıt vermedi ya da kapalıydı. Sonuç: iş başına model zinciri. Arama ifadeleri Gemini > GLM 5.3; ilan kararları Nemotron 3 Super > GLM 5.3 > Gemini. Her hatada sıradaki modele geçilir. Tablo `docs/cron.md` içinde
- `npm test`: **111/111 geçiyor** (+35: liste ve arama ayrıştırıcıları, kural/yapay zekâ katmanı, kur, iş akışı, yeni uçlar, entegrasyon; +5: çift arama, yeniden deneme, model zinciri, NVIDIA istek biçimi)

## Henüz yapılmayanlar

- **Frontend:** bilerek en sona bırakıldı (kullanıcı isteği)
- **Üyelik ve ödeme:** deneme bitince erişim kesme + iyzico/Stripe + webhook
- **Sertleştirme:** hız limiti (rate-limit), sağlık kontrolü, loglama
- **Fırsat listesi (`tr=not_found`) hâlâ boş:** 16 üründe "bulunamadı" hiç çıkmadı (5 "var", 7 "benzeri var", 4 "karar yok"). Ürün türü araması hemen her zaman benzer bir ürün getiriyor; "bulunamadı" yalnız gerçekten yeni türde ürünlerde beklenir. Bakılan ürünlerin çoğu bilinen türler (pil, matara, çarşaf). Asıl hedef olan "yurt dışında var, Türkiye'de yok" için ya çok daha fazla ürüne (özellikle oyuncak ve niş kategoriler) bakmak ya da "benzeri var" içinden zayıf eşleşmeleri ayırmak gerekecek; henüz karar verilmedi
- **amazon.com.tr bot doğrulaması (14 Ekim):** gerçek koşunun ilk aramasında amazon.com.tr doğrulama sayfası döndürdü; kod siteyi o koşu için bıraktı, 5 ürün yalnız Hepsiburada'da arandı. Zorlanmadı. Çift arama sitelere giden istek sayısını ikiye katladı (ürün başına 4 sayfa); engelin sürüp sürmediği bir sonraki koşuda görülecek
- **NVIDIA ucu kararsız:** ilk gerçek koşuda Nemotron 3 Super iki karardan sonra bağlantı hatası verdi, GLM 5.3 zaman aşımına uğradı; kalan kararları Gemini verdi ve birinde hata yaptı (Bezente balonu için Atom balonuna "aynı ürün"). Ücretsiz erişim deneme/prototip amaçlı; canlıya çıkmadan kullanım şartlarına bakılmalı
- **Yapay zekâ katmanının açık zayıflıkları:** (1) sonuç aramaya çıkan ilk 5 ilana bağlı ve koşudan koşuya değişebiliyor (Pokémon 30. yıl kutusu 12 Ekim'de "var", 13 Ekim'de "benzeri var"). (2) Aynı markanın adı yakın modellerini "aynı ürün" sayabiliyor (JBL Vibe Beam 2 / Wave Beam 2). (3) Marka + model araması yabancı dildeki model adını kullanıyor, Türkiye'de başka adla satılanı kaçırabilir
- **Trendyol karşılaştırmada yok:** en büyük Türk pazaryeri. Doğrudan erişim engelli, genel Apify aktörü de sonuç alamıyor (`trendyol_tr` liste çekimi de bu yüzden büyük olasılıkla çalışmaz). Çalışan yol Trendyol'a özel aktör `great_saint/trendyol-scraper`: 12 Ekim'de tek aramayla denendi, 54 saniyede 6 ilan döndü (başlık, fiyat, puan, bağlantı), $0.07 tuttu. Koda bağlanmadı. İlk 6 ilan aranan modeli içermiyordu (aynı markanın başka kulaklıkları), yani "benzeri var" demeye yeter ama birebir fiyata yetmeyebilir. Akla yatan kullanım: yalnız ücretsiz sitelerde "bulunamadı" çıkan ürünleri Trendyol'da doğrulamak (ayrıntı `docs/cron.md` bölüm 4)
- **"Hızla yükselenler" alınamıyor:** Movers & Shakers ne doğrudan ne Apify ile geliyor. Ani ivme için elde kalan yol kendi hesabımız: liste taraması artık ücretsiz olduğundan her gün koşulabilir, sıra ve yorum farkı günlük çıkar
- **"Yeni çıkanlar" bağlanmadı:** New Releases doğrudan okunabiliyor; liste türü ayrımı gerekiyor (taslak: `product_list_entries` tablosu)
- **Doğrudan çekim kırılgan:** sayfa yapısı değişirse ya da site engellerse durur; yalnız ev bağlantısından denendi. Sitelerin kullanım şartları otomatik erişimi kısıtlayabilir
- **Kural katmanı kaba:** aksesuar/kitap ilanını "aynı ürün" sanabilir; ürünün Türkiye fiyatını bu yüzden yanlış gösterebilir
- **Bilinen veri sorunları (açık):**
  - Yorum sayısı tamamlama yalnız amazon.com.tr'de ve yalnız 2 üründe doğrulandı; amazon.de (binlik ayracı aynı) hiç gerçek çekilmedi. Maliyeti sayısı boş ürün başına ~$0.009
  - Fırsat (yapılmadı): ürün sayfası çekimi Amazon'un kendi satış sinyalini de döndürüyor (`monthlyPurchaseVolume`: "Geçen ay 600 adetten fazla satın alındı") ve kategori sırasını (`bestsellerRanks`); `yorum × katsayı` tahminini kalibre etmek ya da değiştirmek için kullanılabilir
  - Aynı gün ikinci koşu günün artışını ezer (`--abroad` günde 4 koşuda yalnız son aralık kalır, aynı veriyle tekrar koşu satışı sıfırlar)
  - Listeden çıkıp günler sonra dönen ürünün birikmiş artışı tek güne yazılır
  - `change_pct` pencereleri: 7 gün seçilince 8 gün okunur, eski dönem 5 gün olup 4'e bölünür
  - Trendyol/AliExpress ürün kimliği gerçek çıktıyla doğrulanmadı; AliExpress'te sipariş sayısı yorum gibi × 25 çarpılıyor
  - `REAL_FETCH=1` olmadan çalışan `run.js` gerçek DB'ye mock ürün yazar (belgede uyarı var, kodda engel yok)
  - Aynı ASIN iki kategoride çıkarsa ürün son yazılan kategoriye geçer (amazon.de'de 120 satırdan 1'i)
- **Kullanıcıya kalan manuel işler:** bir kullanıcıyı yönetici yapmak (`UPDATE users SET is_admin = TRUE WHERE email = '...'`), Resend hesabı + alan adı doğrulama, `reviewCoefficient` kalibrasyonu

## Durum notu

14 Ekim 2026: yerel Postgres (`trendpanel`) kurulu; şema, seed ve 001/002/003 göçleri uygulanmış durumda. İçinde gerçek veri var: amazon_us 90 ürün ve amazon_de 119 ürün (11 Ekim, ücretsiz çekim), amazon_tr 99 ürün (6 Ekim, Apify), günün kuru, 20 ürünün Türkiye karşılaştırması (8 "var", 8 "benzeri var", 4 "karar yok"; 6'sı yalnız kural katmanıyla, 14'ü yapay zekâyla; 14 Ekim). Her pazaryerinde tek günlük veri olduğu için satış tahminleri henüz 0; ikinci günün taraması ilk tahminleri üretir. Kod `firsat-paneli` dalında; bölüm 12'nin değişiklikleri henüz commit edilmedi. Apify bu dönem (5 Eki – 4 Kas) $5'in $2.21'ini harcadı; bölüm 12'nin dört ücretli denemesi toplam $0.07 tuttu (üçü sonuçsuz $0.0025, Trendyol'a özel aktör $0.07).

Sıradaki adımlar: (1) amazon.com.tr engelinin sürüp sürmediğine bakmak, sürerse aramaları yavaşlatmak; 209 ürünün kalan 189'una bakmak (koşu başına 20 ürün; her gün `node worker/tr-check.js`) ve "bulunamadı" çıkıp çıkmadığını görmek, (2) birkaç gün `--free` taraması biriktirip ivme uçlarını gerçek veriyle görmek, (3) "yeni çıkanlar" listesini bağlamak, (4) Trendyol doğrulamasını (arama başına ≈ $0.07) "bulunamadı" çıkan ürünler için koda bağlamak; yapay zekâ katmanı açılmadan anlamı yok.
