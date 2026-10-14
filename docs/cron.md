# Veri İşleri (Cron)

Üç iş var: **liste taraması** (yurt dışında ne çok satıyor), **Türkiye
karşılaştırması** (o ürün Türkiye'de var mı, kaça) ve **haftalık özet e-postası**.

## 1. Liste taraması (`worker/run.js`)

Her pazaryeri+kategori için Best Sellers listesini çeker, `products` tablosunu
günceller, `product_snapshots` satırı yazar, `category_daily_stats` özetini
tazeler ve günün kurunu (TCMB) kaydeder. Aynı gün tekrar çalışırsa çift satır
yazmaz.

```bash
node worker/run.js --dry-run                 # DB'siz önizleme (mock veri)
node worker/run.js                           # DB'ye MOCK veri yazar (deneme içindir)
REAL_FETCH=1 node worker/run.js --free       # gerçek veri, yalnız ücretsiz kaynaklar
REAL_FETCH=1 node worker/run.js --marketplace=amazon_de   # tek pazaryeri
REAL_FETCH=1 node worker/run.js --abroad     # bütün yurt dışı (AliExpress ücretli!)
```

`REAL_FETCH=1` olmadan çalışan koşu veritabanına **mock** ürün yazar; gerçek
veritabanında yalnız `REAL_FETCH=1` ile çalıştır.

### İki çekim yolu

| Pazaryeri | Yol | Ücret | Liste başına |
|---|---|---|---|
| amazon_us, amazon_de | Doğrudan (liste sayfası okunur) | Yok | 30 ürün |
| amazon_tr, trendyol_tr, aliexpress_global | Apify aktörü | ~$0.33 | 50 ürün |

Hangi pazaryerinin doğrudan çekileceği `worker/config.js` içindeki
`DIRECT_LIST_MARKETPLACES` ile belirlenir. `--free` bayrağı koşuyu bu
pazaryerleriyle sınırlar; o koşuda Apify hiç çağrılmaz.

Doğrudan çekimin sınırları (11 Ekim 2026'da ev bağlantısından ölçüldü):
- Sayfa ilk 30 ürünü verir (kalan 20 sonradan yüklenir). Sıra, puan, yorum
  sayısı ve fiyat sayfada hazır gelir; marka ayrı gelmez (başlığın başındadır).
- Fiyat, sitenin para birimi çerezi (`i18n-prefs`) ile pazaryerinin kendi para
  biriminde istenir; çerez tutmazsa Türkiye'den gelen ziyaretçiye TL gösterilir
  ve para birimi sayfadaki metinden okunur.
- Amazon art arda çok istekte bot doğrulama sayfası döndürebilir. O durumda o
  liste hata verir, yeniden denenmez, **ücretli yola kendiliğinden geçilmez**.
  Sunucu (veri merkezi) adresinden engellenme olasılığı evdekinden yüksektir.
- "Hızla yükselenler" (Movers & Shakers) sayfası alınamıyor: doğrudan çekimde
  boş geldi, Apify aktörü de sayfayı açıp 0 ürün döndürdü (12 Ekim 2026).
  "Yeni çıkanlar" (New Releases) sayfası çalışıyor ama henüz bağlanmadı.
- Sitelerin kullanım şartları otomatik erişimi kısıtlayabilir; hacmi düşük tut.

Zamanlama örneği (her gün 04:00, yalnız ücretsiz kaynaklar):

```cron
0 4 * * * cd /srv/trendpanel && DATABASE_URL=... REAL_FETCH=1 node worker/run.js --free >> /var/log/trendpanel-cron.log 2>&1
```

Günde birden fazla koşma: aynı gün ikinci koşu günün yorum artışını ezer.

## 2. Türkiye karşılaştırması (`worker/tr-check.js`)

Yurt dışı ürünleri Türkiye'deki sitelerde arar ve sonucu `tr_checks` /
`tr_matches` tablolarına yazar. Aramalar ücretsizdir.

```bash
node worker/tr-check.js --dry-run            # bakılacak ürünleri gösterir, çekim yok
node worker/tr-check.js                      # en fazla 20 ürün (TR_CHECK_LIMIT)
node worker/tr-check.js --limit=5 --marketplace=amazon_us
```

Nasıl çalışır:
1. Aday seçimi: yurt dışı pazaryerlerinde, hiç bakılmamış ya da son kontrolü
   30 günden eski ürünler; önce bakılmamışlar, sonra en iyi sıradakiler.
   Yapay zekâ açıkken, daha önce onsuz bakılmış (ve elle karar verilmemiş)
   ürünler de 20 saat sonra yeniden aday olur.
2. Arama ifadesi: yapay zekâ varsa ürün başına iki arama yapılır. Yapay zekâ
   başlıktan markayı, modeli ve Türkçe ürün türünü çıkarır; kod bunlardan
   "marka + model" (model yoksa "marka + ürün türü") ve "ürün türü" aramalarını
   kurar. İlki aynı ürünü, ikincisi benzerlerini bulur. Markasız üründe yalnız
   ürün türü aranır. Yapay zekâ yoksa tek arama: marka + adın ilk kelimeleri.
3. Arama: amazon.com.tr ve Hepsiburada (arama başına site başına ilk 5 ilan;
   iki aramanın ilanları birleştirilir). Ürün başına en fazla 4 sayfa isteği.
   Trendyol kaynaklar arasında yok: doğrudan erişimi engelliyor (HTTP 403) ve
   genel Apify aktörü de sonuç alamıyor (bölüm 4).
4. Karar, üç katman (geçerli olan `insan > yapay zekâ > kural`):
   - **Kural** (her zaman çalışır): ilanda marka + model geçiyorsa "aynı ürün
     var". "Yok" diyemez: yabancı başlık Türkçe ilanla kelime kelime tutmaz.
   - **Yapay zekâ** (`GEMINI_API_KEY` ya da `NVIDIA_API_KEY` varsa): her ilanı aynı / benzer /
     alakasız diye ayırır; hiçbiri tutmuyorsa "bulunamadı".
   - **İnsan**: yönetici API'den düzeltir (`docs/api.md`), otomatik kontrol
     bu kararı ezmez. `GET /api/tr-review` bakılması gerekenleri listeler.

Güvenlik payları:
- Bir site yanıt vermez ya da sayfası tanınmazsa bu "sonuç yok" sayılmaz;
  ürün aday kalır. Bir site ancak ürünün bütün aramalarına yanıt verdiyse
  "arandı" sayılır; hiçbiri tam aranamadıysa sonuç yazılmaz.
- Bot doğrulaması isteyen site o koşunun kalanında bir daha denenmez.
- Yapay zekâ kotası dolarsa kalan ürünler kural katmanıyla işlenir, "yok"
  kararı yazılmaz; bu ürünlere ertesi gün yapay zekâyla yeniden bakılır.
- Yapay zekâ bir ürün için karar veremezse (zaman aşımı, eksik yanıt) ve kural
  katmanı da eşleşme bulamadıysa sonuç yazılmaz: eski kayıt boş sonuçla
  ezilmez, ürün sonraki koşuda yeniden denenir.
- Hangi sitelerde arandığı (`sources`) her zaman kaydedilir.

Bilinen zayıflıklar:
- Kural katmanı aksesuar ya da kitap ilanını "aynı ürün" sanabilir (örnek:
  "Roku Streaming Stick User Guide"). Çok ucuz ilanlar elenir, gerisi yapay
  zekâ ya da insan işidir.
- Yapay zekânın Türkçe sorgusu fazla dar olursa arama boş döner ve ürün yanlış
  "bulunamadı" görünür; bu yüzden "bulunamadı" denen her ürün inceleme
  kuyruğuna düşer.
- Sonuç aramaya çıkan ilk ilanlara bağlıdır ve koşudan koşuya değişebilir:
  yapay zekâ ürün türünü her seferinde biraz farklı yazar. Örnek: Pokémon 30.
  yıl kutusu 12 Ekim'de "pokemon kart seti" aramasıyla bulundu ("var",
  29.999 TL), 13 Ekim'de "pokemon kartlari kutusu" aramasında ilk ilanlarda
  çıkmadı ("benzeri var").
- Marka + model araması yabancı dildeki model adını kullanır ("Top-Trainer-Box
  30 Jahre"); Türkiye'de başka adla satılan ürünü kaçırabilir.
- "Bulunamadı" nadir çıkar: ürün türü araması hemen her zaman benzer bir ürün
  getirir. 16 üründe hiç çıkmadı; yalnız gerçekten yeni türde ürünlerde beklenir.
- Yapay zekâ aynı markanın adı çok yakın modellerini karıştırabiliyor ("JBL
  Vibe Beam 2" için "JBL Wave Beam 2" ilanına "aynı ürün" dedi; istem
  sıkılaştırılınca da düzelmedi).

Yapay zekâ kurulumu (iki sağlayıcı, ikisi de ücretsiz katman; biri yeterli):
1. Gemini: [aistudio.google.com](https://aistudio.google.com) → API anahtarı
   (kart istemez) → `.env` içine `GEMINI_API_KEY=...`.
2. NVIDIA: [build.nvidia.com](https://build.nvidia.com/settings/api-keys) →
   `nvapi-` ile başlayan anahtar → `.env` içine `NVIDIA_API_KEY=...`. Ücretsiz
   erişim deneme/prototip amaçlı sunuluyor; canlıya çıkmadan kullanım
   şartlarına bakılmalı (doğrulanmadı).
3. `npm run llm:check`: hangi anahtarların tanımlı olduğunu yazar, iki
   zincirdeki her modeli küçük bir çağrıyla dener (süresiyle).
4. Her iş kendi model zincirini kullanır (`worker/config.js`, `.env` içinde
   `LLM_QUERY_MODELS=` / `LLM_JUDGE_MODELS=` ile değişir; anahtarı olmayan
   sağlayıcının modelleri atlanır):
   - Arama ifadeleri: Gemini 3.5 Flash Lite > Gemini 3.1 Flash Lite > GLM 5.3.
     Türkçesi iyi ve hızlı olanlar önde.
   - İlan kararları: Nemotron 3 Super > GLM 5.3 > Gemini 3.5 Flash Lite >
     Gemini 3.1 Flash Lite. Karar testinde hatasız olanlar önde.
5. Model yanıt vermezse: HTTP 500/503'te 3 ve 10 saniye bekleyip yeniden
   dener. Düzelmezse ya da zaman aşımı (Gemini 60 sn, NVIDIA 90 sn), kota,
   kapalı model, bozuk yanıt olursa zincirdeki sıradaki modele geçer ve
   başarısız modeli 10 dakika atlar. Hepsi başarısızsa iş kural katmanıyla sürer.
6. Kota: Gemini Flash Lite dakikada 15, günde 500 istek (AI Studio "Rate
   limit" sayfası); NVIDIA hesap başına dakikada yaklaşık 40 istek (resmî
   kaynaktan doğrulanmadı). 20 ürün yaklaşık 21 çağrıdır; Gemini çağrıları
   arasında `LLM_MIN_INTERVAL_MS` beklenir.

NVIDIA model karşılaştırması (14 Ekim 2026; 10 ürünün arama ifadesi + 3 karar
testi: JBL Vibe Beam 2, Roku Streaming Stick HD, TV duvar askısı; toplam 26 ilan):

| Model | Sonuç | Hatalı ilan | Çağrı süresi | Türkçe arama ifadesi |
|---|---|---|---|---|
| Nemotron 3 Super 120B | Çalıştı | 0 | 8-30 sn | Bozuk ("nuha makinesi", "oya masa") |
| GLM 5.3 | Çalıştı (14 Ekim kontrolünde 90 sn'yi aştı) | 0 | 35-75 sn | İyi |
| GPT-OSS 20B | Çalıştı | 3 (başka JBL kulaklıklarına "alakasız") | 8-67 sn | Yabancı kelimeler kaldı |
| Kimi K3, GLM 5.3 Flash, DeepSeek V4.1 Flash, Gemma 4 31B | 90 sn'de yanıt yok | – | – | – |
| Nemotron 3.5 Lightning | Bağlantı koptu | – | – | – |
| Mistral Large 2 | Listede var, HTTP 404 | – | – | – |
| Gemini 3.5 / 3.1 Flash Lite (karşılaştırma) | Çalıştı | 2 (Wave Beam 2'ye "aynı") | 1-20 sn | İyi |

İlk gerçek koşuda (14 Ekim, 5 ürün) Nemotron 3 Super iki karardan sonra
bağlantı hatası verdi, GLM 5.3 zaman aşımına uğradı; kalan kararları Gemini
verdi ve birinde hata yaptı (Bezente balonu için Atom balonuna "aynı ürün").
NVIDIA'nın ücretsiz ucu kararsız; Gemini bu yüzden zincirin sonunda duruyor.

Gemini model seçimi (12 Ekim 2026, ücretsiz katman, bu projenin limit sayfasından):

| Model | Dakikada istek | Günde istek | Sonuç |
|---|---|---|---|
| Gemini 3.5 Flash Lite | 15 | 500 | Asıl model: çağrı 1-2 sn. 12 Ekim'de 25 çağrıda hata yok; 13 Ekim'deki denemelerde aralıklı olarak HTTP 503 ve zaman aşımı verdi |
| Gemini 3.1 Flash Lite | 15 | 500 | Yedek: aynı denemede aynı kararlar, çağrı 8-20 sn; asıl model yanıt vermezken çalıştı |
| Gemini 3.8 Flash (`gemini-flash-latest` buna gider) | 5 | 20 | Yetmez: tek koşu 21 çağrı. Çağrı 6-34 sn, 18 çağrının 12'si HTTP 503 |
| Gemini 2.5 Flash / Flash Lite | 5 / 10 | 20 | HTTP 404: yeni kullanıcılara kapalı |
| Gemma 4 31B | 30 | 14.400 | Bizim istek biçimiyle HTTP 503 / 500, çalışmadı |
| Pro modelleri | 0 | 0 | Ücretsiz katmanda kapalı |

`-latest` takma adları yerine sürüm adı yazılı: takma ad başka modele
kaydırılırsa limit de değişir (yukarıdaki 20/gün örneği). Sürüm kullanımdan
kalkarsa iş uyarı verip zincirdeki sıradaki modele, hiçbiri kalmazsa kural
katmanına düşer; o zaman zincir (`worker/config.js`) güncellenir.

Zamanlama örneği (her gün 04:30, liste taramasından sonra):

```cron
30 4 * * * cd /srv/trendpanel && DATABASE_URL=... GEMINI_API_KEY=... NVIDIA_API_KEY=... node worker/tr-check.js >> /var/log/trendpanel-tr.log 2>&1
```

## 3. Haftalık özet e-postası

Takip edilen kategorilerdeki yükselen ilk 5 ürün, Resend ile gönderilir.
Aynı kullanıcıya haftada 1 kez gider (`email_log` korur); verisi olmayan
kategoriye bölüm açılmaz, hiç verisi olmayan kullanıcıya e-posta gitmez.

```bash
RESEND_API_KEY=... EMAIL_FROM=... DATABASE_URL=... node worker/send-digest.js --dry-run
```

Zamanlama örneği (Pazartesi 09:00, günlük çekimden sonra):

```cron
0 9 * * 1 cd /srv/trendpanel && DATABASE_URL=... RESEND_API_KEY=... EMAIL_FROM=... node worker/send-digest.js >> /var/log/trendpanel-digest.log 2>&1
```

Kurulum: [resend.com](https://resend.com) hesabı aç, API anahtarı al,
gönderen alan adını doğrula. `EMAIL_FROM` mutlaka doğrulanmış alan
adından olmalı, yoksa Resend reddeder.

## 4. Apify ile çekim (ücretli pazaryerleri)

Doğrudan çekilmeyen pazaryerleri `apify/e-commerce-scraping-tool` aktörünü
kullanır (Apify'nin resmi e-ticaret aktörü). Her çağrı ücretlidir.

Aktör çıktısının bilinen sınırları (Ekim 2026 çekimlerinde ölçüldü):
- Sıra alanı gelmez ve öğeler liste sırasıyla dönmez. Amazon'da sıra, ürün
  bağlantısındaki `ref=zg_bs_..._sccl_N` değerinden okunur; bağlantıda yoksa
  veri setindeki sıra yazılır.
- amazon.com.tr liste çekiminde 1000 ve üzeri yorumlu ürünlerde `reviewCount`
  boş gelir (iki çekimde 100 üründen 38'i; amazon.com'da 50'de 1). Bu
  ürünlerin sayısı, ürün sayfası doğrudan verilerek (`detailsUrls`) ikinci bir
  çekimle tamamlanır: `worker/config.js` içindeki
  `REVIEW_BACKFILL_MARKETPLACES` (boş dizi kapatır). Yine alınamazsa sayı
  `NULL` tutulur ve o gün satış tahmini 0 olur.
- Ürün sayfası çekiminden yalnız yorum sayısı alınır: o modda fiyat binlik
  ayracı yüzünden yanlış gelir (1364 TL'lik ürün 1.364 olarak), puan boş gelir.
  Bağlantıya `/-/en/` ya da `?language=en_US` eklemek sonucu değiştirmez.
- Trendyol bu aktörle çekilemiyor (12 Ekim 2026, iki deneme, toplam $0.0013):
  anahtar kelime araması "No response received" ile, arama adresinin liste
  olarak verilmesi 0 ürünle bitti. `trendyol_tr` liste çekimi de büyük
  olasılıkla çalışmaz. AliExpress çıktısı hiç doğrulanmadı.

Adım 1 — Kategori URL'lerini doldur:
1. Tarayıcıda Best Sellers (çok satanlar) sayfasını aç, istediğin kategoriye tıkla.
2. Adres çubuğundaki URL'yi kopyala, `worker/config.js` içindeki
   `LISTING_URLS` tablosuna ilgili pazaryeri+kategori hücresine yapıştır.
3. URL'ler doğrulanmadan gerçek çekim çalışmaz; boş hücrede iş hangi hücrenin
   eksik olduğunu söyleyerek durur.

Adım 2 — Token: [Apify Console → Settings → Integrations](https://console.apify.com/settings/integrations)
adresinden token al, `.env` dosyasına `APIFY_TOKEN=...` yaz.

Adım 3 — Tek pazaryerinde dene:
```bash
REAL_FETCH=1 node worker/run.js --dry-run --marketplace=aliexpress_global
```
Dry-run DB'ye yazmaz ama Apify'yi gerçekten çağırır (ücretli!).
Sonuçlar doğruysa `--dry-run` olmadan çalıştır.

Maliyet notu (ölçülen, Free plan, Ekim 2026): ürün başına ~$0.0067, yani
50 ürünlük liste ≈ $0.33. Free planın aylık kredisi $5'tir. Ücretli planlarda
ürün başı ücret düşer (aktörün fiyat listesi: $0.006 → $0.0015). Fiyatlar
değişebilir, güncel tarifeyi aktörün store sayfasından kontrol et.

Yorum sayısı tamamlama çekimi ayrıca ücretlidir: sayısı boş gelen ürün başına
~$0.009 (ölçülen: 4 ürün $0.036). amazon.com.tr'de ürünlerin yaklaşık %40'ında
gerektiği için 2 kategorilik koşuya ≈ $0.35 ekler.

Trendyol için çalışan yol, Trendyol'a özel bir aktör: `great_saint/trendyol-scraper`
(anahtar kelimeyle arar). 12 Ekim 2026'da tek aramayla denendi, henüz koda
bağlanmadı:
- Girdi `{ query, maxItems }`; 54 saniyede 6 ürün + 1 özet satırı döndü.
- Ücret: başlangıç $0.01 (bellek GB'ı başına; varsayılan 4 GB, koşu
  `?memory=1024` ile 1 GB'ta başlatıldı) + veri satırı başına $0.01. 5 ilan
  istenen arama $0.08 tutacaktı, `maxTotalChargeUsd=0.07` sınırıyla $0.07 yazıldı.
- Alanlar: `brand` (aslında ilan başlığı), `price` ("1.690,02 TL"), `rating`
  ("4.6 (8774)"), `ratingCount`, `link`. Görsel yok.
- İlgi düzeyi zayıf olabilir: "jbl vibe beam 2" aramasında ilk 6 ilanın hepsi
  JBL kulaklıktı ama hiçbiri o model değildi. "Benzeri var" demeye yeter,
  birebir fiyat karşılaştırmasına yetmeyebilir.
Her ürün için kullanmak Free planı hızla bitirir (kalan krediyle ~35 arama).
Mantıklı kullanım: ücretsiz sitelerde "bulunamadı" çıkan ürünleri fırsat
demeden önce Trendyol'da doğrulamak.

## Katsayı kalibrasyonu

`worker/config.js` içindeki `reviewCoefficient` ilk tahmindir (1 yorum ≈ N satış).
Elinde gerçek satış verisi olan birkaç üründe 2-4 hafta karşılaştırıp
pazaryeri bazında güncelle. Katsayıyı değiştirmen geçmiş snapshot'ları
bozmaz, sadece yeni günleri etkiler.
