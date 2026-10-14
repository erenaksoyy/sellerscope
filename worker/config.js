// Pazaryeri + kategori yapılandırması (db/seed.sql ile aynı kodlar).
// reviewCoefficient: 1 yeni yorum ≈ kaç satış. İlk tahmindir,
// gerçek veriyle kalibre edilmelidir (docs/cron.md).

export const MARKETPLACES = {
  amazon_tr: { country: "TR", currency: "TRY", baseUrl: "https://www.amazon.com.tr", reviewCoefficient: 20 },
  amazon_us: { country: "US", currency: "USD", baseUrl: "https://www.amazon.com", reviewCoefficient: 20 },
  amazon_de: { country: "DE", currency: "EUR", baseUrl: "https://www.amazon.de", reviewCoefficient: 20 },
  trendyol_tr: { country: "TR", currency: "TRY", baseUrl: "https://www.trendyol.com", reviewCoefficient: 15 },
  aliexpress_global: { country: "GL", currency: "USD", baseUrl: "https://www.aliexpress.com", reviewCoefficient: 25 },
};

export const CATEGORIES = {
  amazon_tr: ["ev-yasam", "elektronik"],
  amazon_us: ["home-kitchen", "electronics", "toys-games"],
  amazon_de: ["ev-mutfak", "elektronik", "spor-outdoor", "oyuncak"],
  trendyol_tr: ["ev-mobilya", "elektronik"],
  aliexpress_global: ["home-garden"],
};

// Kategori başına çekilecek ürün sayısı (Best Sellers ilk sayfası).
export const FETCH_LIMIT = 50;

// Yurt dışı hedefler (TR dışı): "satış patlaması" akışının varsayılan kapsamı.
export const ABROAD_MARKETPLACES = ["amazon_us", "amazon_de", "aliexpress_global"];

// Gerçek çekimde kullanılan Apify aktörü (Apify'nin resmi e-ticaret aktörü).
export const APIFY_ACTOR = "apify/e-commerce-scraping-tool";

// Liste çekiminde yorum sayısı boş gelen ürünlerin sayısı, ürün sayfasından
// ikinci bir çekimle tamamlanır (ürün başına ücretli, docs/cron.md).
// Yalnız gerçek çıktıyla doğrulanan pazaryerleri; boş dizi = kapalı.
export const REVIEW_BACKFILL_MARKETPLACES = ["amazon_tr"];

// Liste sayfası doğrudan (Apify'sız, ücretsiz) çekilen pazaryerleri. Sayfa ilk
// 30 ürünü verir. Amazon bot doğrulaması isterse çekim hata verir; ücretli
// yola kendiliğinden düşülmez. Listeden çıkarılan pazaryeri Apify ile çekilir.
export const DIRECT_LIST_MARKETPLACES = ["amazon_us", "amazon_de"];

// --- Türkiye karşılaştırması (worker/tr-check.js) ---
// Aranan TR siteleri; arama sayfaları doğrudan çekilir (ücretsiz). Trendyol
// doğrudan erişimi engellediği (HTTP 403) için listede yok.
export const TR_SEARCH_SOURCES = ["amazon_tr", "hepsiburada_tr"];
export const TR_RESULTS_PER_SOURCE = 5; // site başına değerlendirilen ilan
export const TR_CHECK_LIMIT = 20; // koşu başına bakılan ürün
export const TR_RECHECK_DAYS = 30; // bu kadar gün sonra yeniden bakılır
export const TR_SEARCH_DELAY_MS = 4000; // ürünler arası bekleme (siteleri yormamak için)

// Yapay zekâ katmanı: iş başına model zinciri ("sağlayıcı:model"), soldan sağa
// denenir; anahtarı olmayan sağlayıcı atlanır. Hiç anahtar yoksa yalnız kural
// katmanı çalışır. .env'de LLM_QUERY_MODELS= / LLM_JUDGE_MODELS= (virgüllü) ile değişir.
// Ölçümler (12-14 Eki 2026, ücretsiz katman, docs/cron.md):
// - Gemini Flash Lite: dakikada 15, günde 500 istek; çağrı 1-20 sn, Türkçesi iyi,
//   ilan kararında yakın model adlarını karıştırıyor. Tam "Flash" günde 20 istek, yetmez.
// - NVIDIA (dakikada ~40 istek): Nemotron 3 Super ve GLM 5.3 ilan kararında hatasız;
//   Nemotron'un Türkçe arama ifadeleri bozuk, GLM yavaş (35-75 sn).
export const LLM_QUERY_MODELS = [
  "gemini:gemini-3.5-flash-lite", "gemini:gemini-3.1-flash-lite", "nvidia:z-ai/glm-5.3",
];
export const LLM_JUDGE_MODELS = [
  "nvidia:nvidia/nemotron-3-super-120b-a12b", "nvidia:z-ai/glm-5.3",
  "gemini:gemini-3.5-flash-lite", "gemini:gemini-3.1-flash-lite",
];
export const LLM_MIN_INTERVAL_MS = 4500; // çağrılar arası bekleme (Gemini: dakikada 15 istek)

// Kategori Best Sellers sayfa URL'leri. Bos olan hedefte gerçek çekim net
// hata verir; tarayıcıda doğrulayıp doldur (docs/cron.md Adım 1).
export const LISTING_URLS = {
  amazon_tr: {
    "ev-yasam": "https://www.amazon.com.tr/gp/bestsellers/home/",
    elektronik: "https://www.amazon.com.tr/gp/bestsellers/electronics/",
  },
  amazon_us: {
    "home-kitchen": "https://www.amazon.com/gp/bestsellers/home-garden/",
    electronics: "https://www.amazon.com/gp/bestsellers/electronics/ref=zg_bs_electronics_sm",
    "toys-games": "https://www.amazon.com/gp/bestsellers/toys-and-games/",
  },
  amazon_de: {
    "ev-mutfak": "https://www.amazon.de/gp/bestsellers/kitchen/",
    elektronik: "https://www.amazon.de/gp/bestsellers/ce-de/",
    "spor-outdoor": "https://www.amazon.de/gp/bestsellers/sports/",
    oyuncak: "https://www.amazon.de/gp/bestsellers/toys/",
  },
  trendyol_tr: {
    "ev-mobilya": "https://www.trendyol.com/ev-ve-mobilya-x-c145704?sst=BEST_SELLER",
    elektronik: "https://www.trendyol.com/elektronik-x-c104024?sst=BEST_SELLER",
  },
  aliexpress_global: {
    "home-garden": "https://www.aliexpress.com/category/15/home-garden.html?SortType=total_tranpro_desc",
  },
};
