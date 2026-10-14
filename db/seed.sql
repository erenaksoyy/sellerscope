-- MVP seed: 3 Amazon ülkesi + Trendyol + AliExpress, örnek kategoriler

INSERT INTO marketplaces (code, name, country_code, currency, website) VALUES
  ('amazon_tr', 'Amazon Türkiye', 'TR', 'TRY', 'https://www.amazon.com.tr'),
  ('amazon_us', 'Amazon Amerika', 'US', 'USD', 'https://www.amazon.com'),
  ('amazon_de', 'Amazon Almanya', 'DE', 'EUR', 'https://www.amazon.de'),
  ('trendyol_tr', 'Trendyol', 'TR', 'TRY', 'https://www.trendyol.com'),
  ('aliexpress_global', 'AliExpress', 'GL', 'USD', 'https://www.aliexpress.com')
ON CONFLICT (code) DO NOTHING;

-- Örnek kategoriler (slug'lar sabit kalır, cron bunlara yazar).
-- group_slug: aynı tür kategoriyi ülkeler arasında birleştiren ortak anahtar.
WITH m AS (SELECT id, code FROM marketplaces)
INSERT INTO categories (marketplace_id, name, slug, level, group_slug) VALUES
  ((SELECT id FROM m WHERE code='amazon_de'), 'Ev & Mutfak', 'ev-mutfak', 1, 'ev-mutfak'),
  ((SELECT id FROM m WHERE code='amazon_de'), 'Elektronik', 'elektronik', 1, 'elektronik'),
  ((SELECT id FROM m WHERE code='amazon_de'), 'Spor & Outdoor', 'spor-outdoor', 1, 'spor-outdoor'),
  ((SELECT id FROM m WHERE code='amazon_de'), 'Oyuncak', 'oyuncak', 1, 'oyuncak'),
  ((SELECT id FROM m WHERE code='amazon_us'), 'Home & Kitchen', 'home-kitchen', 1, 'ev-mutfak'),
  ((SELECT id FROM m WHERE code='amazon_us'), 'Electronics', 'electronics', 1, 'elektronik'),
  ((SELECT id FROM m WHERE code='amazon_us'), 'Toys & Games', 'toys-games', 1, 'oyuncak'),
  ((SELECT id FROM m WHERE code='amazon_tr'), 'Ev & Yaşam', 'ev-yasam', 1, 'ev-mutfak'),
  ((SELECT id FROM m WHERE code='amazon_tr'), 'Elektronik', 'elektronik', 1, 'elektronik'),
  ((SELECT id FROM m WHERE code='trendyol_tr'), 'Ev & Mobilya', 'ev-mobilya', 1, 'ev-mutfak'),
  ((SELECT id FROM m WHERE code='trendyol_tr'), 'Elektronik', 'elektronik', 1, 'elektronik'),
  ((SELECT id FROM m WHERE code='aliexpress_global'), 'Home & Garden', 'home-garden', 1, 'ev-mutfak')
ON CONFLICT (marketplace_id, slug) DO NOTHING;
