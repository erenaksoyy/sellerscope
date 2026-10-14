-- 003: Türkiye karşılaştırması (yurt dışı ürün TR'de var mı, kaça), günlük kur,
-- ülkeler arası ortak kategori, yönetici bayrağı, Oyuncak kategorileri.
-- Mevcut kurulumlar: psql trendpanel -f db/migrations/003_tr_checks.sql
-- (Sıfır kurulumda db/schema.sql + db/seed.sql zaten bunları içerir.)

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS group_slug TEXT;

CREATE TABLE IF NOT EXISTS fx_rates (
  rate_on   DATE NOT NULL,
  currency  CHAR(3) NOT NULL,
  try_rate  NUMERIC(14,6) NOT NULL,
  PRIMARY KEY (rate_on, currency)
);

CREATE TABLE IF NOT EXISTS tr_checks (
  product_id   UUID PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  query        TEXT,
  sources      TEXT[] NOT NULL DEFAULT '{}',
  rule_status  TEXT CHECK (rule_status IN ('found')),
  ai_status    TEXT CHECK (ai_status IN ('found', 'similar', 'not_found')),
  human_status TEXT CHECK (human_status IN ('found', 'similar', 'not_found')),
  human_note   TEXT,
  human_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  human_at     TIMESTAMPTZ,
  status       TEXT NOT NULL CHECK (status IN ('found', 'similar', 'not_found', 'unknown')),
  match_count  INT NOT NULL DEFAULT 0,
  min_price    NUMERIC(12,2),
  checked_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_tr_checks_status ON tr_checks(status);

CREATE TABLE IF NOT EXISTS tr_matches (
  id          BIGSERIAL PRIMARY KEY,
  product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  source      TEXT NOT NULL,
  title       TEXT NOT NULL,
  url         TEXT NOT NULL,
  image_url   TEXT,
  seller_name TEXT,
  price       NUMERIC(12,2),
  kind        TEXT NOT NULL CHECK (kind IN ('same', 'similar')),
  UNIQUE (product_id, url)
);

-- Mevcut kategorilere ortak kategori anahtarı.
UPDATE categories SET group_slug = CASE
    WHEN slug IN ('ev-mutfak', 'home-kitchen', 'ev-yasam', 'ev-mobilya', 'home-garden') THEN 'ev-mutfak'
    WHEN slug IN ('elektronik', 'electronics') THEN 'elektronik'
    WHEN slug = 'spor-outdoor' THEN 'spor-outdoor'
    WHEN slug IN ('oyuncak', 'toys-games') THEN 'oyuncak'
  END
WHERE group_slug IS NULL;

-- Yeni yurt dışı kategorileri: Oyuncak (çocuk eğitim ürünleri bunun altında).
INSERT INTO categories (marketplace_id, name, slug, level, group_slug)
SELECT m.id, v.name, v.slug, 1, 'oyuncak'
FROM (VALUES ('amazon_us', 'Toys & Games', 'toys-games'),
             ('amazon_de', 'Oyuncak', 'oyuncak')) AS v(code, name, slug)
JOIN marketplaces m ON m.code = v.code
ON CONFLICT (marketplace_id, slug) DO NOTHING;
