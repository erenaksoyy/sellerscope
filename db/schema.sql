-- E-ticaret Trend Paneli - MVP veritabanı şeması (PostgreSQL 15+)
-- Odak: Amazon TR/US/DE + Trendyol TR + AliExpress global
-- Tahmini satış = sinyalden türetilir, gerçek adet değildir.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Pazaryerleri
CREATE TABLE IF NOT EXISTS marketplaces (
  id            SMALLSERIAL PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,          -- amazon_tr, amazon_us, amazon_de, trendyol_tr, aliexpress_global
  name          TEXT NOT NULL,                 -- Amazon Almanya
  country_code  CHAR(2) NOT NULL,              -- TR, US, DE, GB(->global için US kullanma, 'GL' özel)
  currency      CHAR(3) NOT NULL DEFAULT 'TRY',
  website       TEXT NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Kategoriler (pazaryerine özgü ağaç)
CREATE TABLE IF NOT EXISTS categories (
  id             SERIAL PRIMARY KEY,
  marketplace_id SMALLINT NOT NULL REFERENCES marketplaces(id) ON DELETE CASCADE,
  external_id    TEXT,                          -- pazaryerindeki kategori id/url parçası
  name           TEXT NOT NULL,                 -- Ev & Mutfak
  slug           TEXT NOT NULL,                 -- ev-mutfak
  parent_id      INT REFERENCES categories(id) ON DELETE SET NULL,
  level          SMALLINT NOT NULL DEFAULT 1,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (marketplace_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_categories_marketplace ON categories(marketplace_id);

-- 3. Ürünler (güncel durum)
CREATE TABLE IF NOT EXISTS products (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  marketplace_id SMALLINT NOT NULL REFERENCES marketplaces(id) ON DELETE CASCADE,
  category_id    INT REFERENCES categories(id) ON DELETE SET NULL,
  external_id    TEXT NOT NULL,                 -- ASIN, Trendyol id, AliExpress id
  title          TEXT NOT NULL,
  brand          TEXT,
  url            TEXT NOT NULL,
  image_url      TEXT,
  seller_name    TEXT,
  price          NUMERIC(12,2),
  currency       CHAR(3),
  rating         NUMERIC(2,1),                  -- 0.0 - 5.0
  review_count   INT NOT NULL DEFAULT 0,
  bestseller_rank INT,                          -- kategorideki anlık sıra
  country_code   CHAR(2) NOT NULL,              -- ürünün satıldığı ülke
  first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (marketplace_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_products_filter
  ON products(marketplace_id, country_code, category_id, bestseller_rank);
CREATE INDEX IF NOT EXISTS idx_products_last_seen ON products(last_seen_at DESC);

-- 4. Günlük ürün snapshot'ları (cron her gün 1 satır yazar)
CREATE TABLE IF NOT EXISTS product_snapshots (
  id                    BIGSERIAL PRIMARY KEY,
  product_id            UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  captured_on           DATE NOT NULL DEFAULT CURRENT_DATE,
  price                 NUMERIC(12,2),
  review_count          INT NOT NULL DEFAULT 0,
  rating                NUMERIC(2,1),
  bestseller_rank       INT,
  review_count_delta    INT NOT NULL DEFAULT 0,   -- düne göre yorum artışı
  estimated_sales_daily INT NOT NULL DEFAULT 0,   -- review_delta x kategori katsayısı
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, captured_on)
);
CREATE INDEX IF NOT EXISTS idx_snapshots_product_date
  ON product_snapshots(product_id, captured_on DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_date_sales
  ON product_snapshots(captured_on DESC, estimated_sales_daily DESC);

-- 5. Kategori günlük özetleri (panel hızlı açılsın diye)
CREATE TABLE IF NOT EXISTS category_daily_stats (
  id                   BIGSERIAL PRIMARY KEY,
  marketplace_id       SMALLINT NOT NULL REFERENCES marketplaces(id) ON DELETE CASCADE,
  category_id          INT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  country_code         CHAR(2) NOT NULL,
  stats_on             DATE NOT NULL DEFAULT CURRENT_DATE,
  product_count        INT NOT NULL DEFAULT 0,
  avg_price            NUMERIC(12,2),
  total_estimated_sales INT NOT NULL DEFAULT 0,
  top_product_id       UUID REFERENCES products(id) ON DELETE SET NULL,
  UNIQUE (marketplace_id, category_id, stats_on)
);
CREATE INDEX IF NOT EXISTS idx_catstats_lookup
  ON category_daily_stats(marketplace_id, country_code, stats_on DESC);

-- 6. Kullanıcılar (tek planlı üyelik)
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  plan          TEXT NOT NULL DEFAULT 'monthly',
  trial_ends_at TIMESTAMPTZ,
  digest_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. Favori ürünler (limit: 50)
CREATE TABLE IF NOT EXISTS favorites (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, product_id)
);

-- 8. Kategori takipleri (haftalık e-posta için)
CREATE TABLE IF NOT EXISTS category_follows (
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  marketplace_id SMALLINT NOT NULL REFERENCES marketplaces(id) ON DELETE CASCADE,
  category_id    INT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, marketplace_id, category_id)
);

-- 9. Haftalık özet gönderim kaydı (aynı kullanıcıya haftada 1 kez)
CREATE TABLE IF NOT EXISTS email_log (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week       DATE NOT NULL,                     -- date_trunc('week', CURRENT_DATE)
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  item_count INT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, week)
);

-- MVP örnek sorgu: Amazon DE, Ev kategorisi, son 7 gün en hızlı yükselen 10 ürün
-- SELECT p.title, p.price, SUM(s.estimated_sales_daily) AS sales_7d,
--        MIN(s.bestseller_rank) AS best_rank
-- FROM products p
-- JOIN product_snapshots s ON s.product_id = p.id
-- JOIN marketplaces m ON m.id = p.marketplace_id
-- WHERE m.code = 'amazon_de' AND s.captured_on >= CURRENT_DATE - 7
-- GROUP BY p.id ORDER BY sales_7d DESC LIMIT 10;
