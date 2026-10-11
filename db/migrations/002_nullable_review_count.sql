-- 002: yorum sayısı bilinmiyorsa NULL tutulur (0 değil).
-- Mevcut kurulumlar: psql trendpanel -f db/migrations/002_nullable_review_count.sql
-- (Sıfır kurulumda db/schema.sql zaten bunları içerir.)
-- Neden: aktör bazı ürünlerde yorum sayısı döndürmüyor. 0 yazılırsa sayı
-- geri geldiği gün tamamı o günün artışı sayılır (sahte satış patlaması).

ALTER TABLE products ALTER COLUMN review_count DROP NOT NULL;
ALTER TABLE products ALTER COLUMN review_count DROP DEFAULT;
ALTER TABLE product_snapshots ALTER COLUMN review_count DROP NOT NULL;
ALTER TABLE product_snapshots ALTER COLUMN review_count DROP DEFAULT;

-- Puanı olduğu halde 0 yorum yazılmış satırlar: sayı aslında bilinmiyordu.
UPDATE products SET review_count = NULL WHERE review_count = 0 AND rating IS NOT NULL;
UPDATE product_snapshots SET review_count = NULL WHERE review_count = 0 AND rating IS NOT NULL;
