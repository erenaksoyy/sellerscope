# SellerScope (MVP)

Yurt dışı pazarlarını tarayan fırsat paneli: hangi ülkede, hangi kategoride ne
çok satıyor ya da hızla yükseliyor; bu ürün **Türkiye'de var mı, varsa kaça**.
Hedef kullanıcı: yurt dışında tutan bir ürünü Türkiye'ye getirmek ya da burada
üretmek isteyen girişimci. Şimdilik yalnız backend (API + veri işleri).

## Kapsam (MVP)
- Taranan pazarlar: Amazon ABD ve Almanya (ücretsiz, doğrudan çekim);
  AliExpress, Amazon TR ve Trendyol listeleri Apify ile (ücretli, isteğe bağlı)
- Türkiye karşılaştırması: amazon.com.tr ve Hepsiburada aramaları (ücretsiz)
- Filtreler: ülke/pazaryeri, kategori, ortak kategori grubu, son 7/30 gün,
  en çok satan + en hızlı yükselen, fiyat aralığı, Türkiye durumu
- Ürün bağlantısı her uçta döner (kullanıcı satıldığı siteye gider)

## Veri modeli
- `db/schema.sql`: 12 tablo (marketplaces, categories, products, product_snapshots,
  category_daily_stats, users, favorites, category_follows, email_log, fx_rates,
  tr_checks, tr_matches)
- `db/seed.sql`: pazaryeri + kategori tohumları
- `db/migrations/`: mevcut kurulumu güncel şemaya taşıyan dosyalar (sıfır kurulumda gerekmez)
- Satış adedi her zaman **tahmini**dir: `yorum artışı x kategori katsayısı`. Gerçek adet gibi gösterilmez.
- Yorum sayısı alınamayan üründe sayı `NULL` (bilinmiyor) tutulur, 0 yazılmaz; o gün için satış tahmini 0'dır.
- Türkiye durumu üç katmanın kararıdır, geçerli olan `insan > yapay zekâ > kural`:
  `found` (aynı ürün var), `similar` (benzeri var), `not_found`, `unknown`
  (karar verilemedi), `unchecked` (henüz bakılmadı). "Yok" kanıtlanamaz;
  hangi sitelerde arandığı her zaman kayıtlıdır.

## Kurulum
```bash
# Postgres 15+ gerekli
createdb trendpanel
psql trendpanel -f db/schema.sql
psql trendpanel -f db/seed.sql

# Daha önce kurulmuş veritabanında: eksik göçleri sırayla uygula
psql trendpanel -f db/migrations/001_digest.sql
psql trendpanel -f db/migrations/002_nullable_review_count.sql
psql trendpanel -f db/migrations/003_tr_checks.sql
```

## Çalıştırma
```bash
npm install              # pg bağımlılığı (canlı koşu + entegrasyon testi için)
npm test                 # tüm testler
node worker/run.js --dry-run                 # liste çekimi önizleme (DB'siz, mock)
REAL_FETCH=1 node worker/run.js --free       # gerçek tarama, yalnız ücretsiz kaynaklar
node worker/tr-check.js --dry-run            # Türkiye'de aranacak ürünler (çekim yok)
node worker/tr-check.js                      # Türkiye karşılaştırması (ücretsiz)
DATABASE_URL=... JWT_SECRET=... npm run api  # panel API (:3000)
```
Ayrıntı: `docs/cron.md` (veri işleri, maliyet, sınırlar), `docs/api.md` (uçlar).

`npm test` birim testlerini DB'siz koşar. `db/integration.test.js` ise gerçek
Postgres ister: `DATABASE_URL` yerel (localhost) bir sunucuyu gösteriyorsa ya da
`TEST_DATABASE_URL` tanımlıysa orada geçici bir şema açar, şema + göç + seed +
cron + Türkiye karşılaştırması + API sorgularını uçtan uca dener ve şemayı siler
(mevcut tablolara dokunmaz, dış servis çağırmaz). İkisi de yoksa bu testler atlanır.

## Klasör yapısı
```
api/       # panel API (handler + auth + server)
db/        # schema + seed + göçler + entegrasyon testi
docs/      # API sözleşmesi + veri işleri rehberi
worker/    # liste çekimi, kur, Türkiye karşılaştırması, haftalık özet
```

## MVP'de YOK
- Arayüz (frontend), ödeme
- Trendyol'da arama (site doğrudan erişimi engelliyor, genel Apify aktörü de sonuç alamıyor; ayrıntı `docs/cron.md`)
- Alibaba B2B, N11; mobil uygulama, gelişmiş grafikler, çoklu paket
