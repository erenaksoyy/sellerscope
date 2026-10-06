# Günlük Veri Çekme (Cron)

Her gün 1 kez çalışır: her pazaryeri+kategori için Best Sellers ilk 50 ürünü
çeker, `products` tablosunu günceller, `product_snapshots` satırı yazar ve
`category_daily_stats` özetini tazeler. Tekrar çalışırsa çift satır yazmaz.

## Çalıştırma

```bash
npm install              # sadece gerçek koşu için (pg)
node worker/run.js --dry-run   # DB'siz önizleme
node worker/run.js              # DB'ye yazar (DATABASE_URL gerekli)
node worker/run.js --marketplace=amazon_de  # tek pazaryeri
node worker/run.js --abroad     # yalnız yurt dışı (US/DE/AliExpress)
```

Zamanlama örneği (her gün 04:00):

```cron
0 4 * * * cd /srv/trendpanel && DATABASE_URL=... node worker/run.js >> /var/log/trendpanel-cron.log 2>&1
```

Yurt dışı patlama takibi için sık çekim (günde 4 kez, yalnız yabancı hedefler):

```cron
0 0,6,12,18 * * * cd /srv/trendpanel && DATABASE_URL=... REAL_FETCH=1 node worker/run.js --abroad >> /var/log/trendpanel-abroad.log 2>&1
```

Not: her Apify çağrısı ücretlidir; `--abroad` 6 hedef çeker (tam koşu 10 hedef).
Sık çekim günlük maliyeti katlar, önce tek `--dry-run` ile ölç (aşağıda Adım 3).

## Haftalık özet e-postası

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

## Mock -> gerçek geçiş (Apify)

Varsayılan mod mock veridir (`REAL_FETCH` tanımsız). Gerçek çekim
`apify/e-commerce-scraping-tool` aktörünü kullanır (Apify'nin resmi
e-ticaret aktörü, Best Sellers listeleme sayfalarını sıra bilgisiyle çeker).

Adım 1 — Kategori URL'lerini doldur:
1. Tarayıcıda Amazon/Trendyol/AliExpress Best Sellers (çok satanlar)
   sayfasını aç, istediğin kategoriye tıkla.
2. Adres çubuğundaki URL'yi kopyala, `worker/config.js` içindeki
   `LISTING_URLS` tablosuna ilgili pazaryeri+kategori hücresine yapıştır.
3. URL'ler elle doğrulanmadan gerçek çekim çalışmaz; boş hücrede cron
   hangi hücrenin eksik olduğunu söyleyerek durur.

Adım 2 — Token: [Apify Console → Settings → Integrations](https://console.apify.com/settings/integrations)
adresinden token al, `.env` dosyasına `APIFY_TOKEN=...` yaz.

Adım 3 — Tek pazaryerinde dene:
```bash
REAL_FETCH=1 node worker/run.js --dry-run --marketplace=amazon_de
```
Dry-run DB'ye yazmaz ama Apify'yi gerçekten çağırır (ücretli!).
Sonuçlar doğruysa `--dry-run` olmadan çalıştır.

Maliyet notu (ölçülen, Free plan, Ekim 2026): ürün başına ~$0.006.
5 ürün test ≈ $0.03, 1 kategori (50 ürün) ≈ $0.30, tam koşu
(10 kategori x 50 ürün = ~500 sonuç) ≈ $3. $5 krediyle testler +
1 tam koşu çıkar. Fiyatlar değişebilir, güncel tarifeyi aktörün
store sayfasından kontrol et.

Alternatifler (gerekirse): Amazon için `junglee/amazon-bestsellers`
(.com.tr yok), Trendyol için `great_saint/trendyol-scraper`
(anahtar kelime bazlı, yorum sayısı döndürmez).

## Katsayı kalibrasyonu

`worker/config.js` içindeki `reviewCoefficient` ilk tahmindir (1 yorum ≈ N satış).
Elinde gerçek satış verisi olan birkaç üründe 2-4 hafta karşılaştırıp
pazaryeri bazında güncelle. Katsayıyı değiştirmen geçmiş snapshot'ları
bozmaz, sadece yeni günleri etkiler.
