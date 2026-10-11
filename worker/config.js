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
  amazon_us: ["home-kitchen", "electronics"],
  amazon_de: ["ev-mutfak", "elektronik", "spor-outdoor"],
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
  },
  amazon_de: {
    "ev-mutfak": "https://www.amazon.de/gp/bestsellers/kitchen/",
    elektronik: "https://www.amazon.de/gp/bestsellers/ce-de/",
    "spor-outdoor": "https://www.amazon.de/gp/bestsellers/sports/",
  },
  trendyol_tr: {
    "ev-mobilya": "https://www.trendyol.com/ev-ve-mobilya-x-c145704?sst=BEST_SELLER",
    elektronik: "https://www.trendyol.com/elektronik-x-c104024?sst=BEST_SELLER",
  },
  aliexpress_global: {
    "home-garden": "https://www.aliexpress.com/category/15/home-garden.html?SortType=total_tranpro_desc",
  },
};
