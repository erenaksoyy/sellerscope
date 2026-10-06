-- MVP seed: 3 Amazon ülkesi + Trendyol + AliExpress, örnek kategoriler

INSERT INTO marketplaces (code, name, country_code, currency, website) VALUES
  ('amazon_tr', 'Amazon Türkiye', 'TR', 'TRY', 'https://www.amazon.com.tr'),
  ('amazon_us', 'Amazon Amerika', 'US', 'USD', 'https://www.amazon.com'),
  ('amazon_de', 'Amazon Almanya', 'DE', 'EUR', 'https://www.amazon.de'),
  ('trendyol_tr', 'Trendyol', 'TR', 'TRY', 'https://www.trendyol.com'),
  ('aliexpress_global', 'AliExpress', 'GL', 'USD', 'https://www.aliexpress.com')
ON CONFLICT (code) DO NOTHING;

-- Örnek kategoriler (slug'lar sabit kalır, cron bunlara yazar)
WITH m AS (SELECT id, code FROM marketplaces)
INSERT INTO categories (marketplace_id, name, slug, level) VALUES
  ((SELECT id FROM m WHERE code='amazon_de'), 'Ev & Mutfak', 'ev-mutfak', 1),
  ((SELECT id FROM m WHERE code='amazon_de'), 'Elektronik', 'elektronik', 1),
  ((SELECT id FROM m WHERE code='amazon_de'), 'Spor & Outdoor', 'spor-outdoor', 1),
  ((SELECT id FROM m WHERE code='amazon_us'), 'Home & Kitchen', 'home-kitchen', 1),
  ((SELECT id FROM m WHERE code='amazon_us'), 'Electronics', 'electronics', 1),
  ((SELECT id FROM m WHERE code='amazon_tr'), 'Ev & Yaşam', 'ev-yasam', 1),
  ((SELECT id FROM m WHERE code='amazon_tr'), 'Elektronik', 'elektronik', 1),
  ((SELECT id FROM m WHERE code='trendyol_tr'), 'Ev & Mobilya', 'ev-mobilya', 1),
  ((SELECT id FROM m WHERE code='trendyol_tr'), 'Elektronik', 'elektronik', 1),
  ((SELECT id FROM m WHERE code='aliexpress_global'), 'Home & Garden', 'home-garden', 1)
ON CONFLICT (marketplace_id, slug) DO NOTHING;
