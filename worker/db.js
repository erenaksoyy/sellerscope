import pg from "pg";

let pool = null;

export function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL tanımlı değil (.env.example'e bak).");
    }
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  }
  return pool;
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

// Çekim hedefleri DB'den okunur (tek doğruluk kaynağı seed + admin).
export async function loadTargets(client) {
  const { rows } = await client.query(`
    SELECT m.id AS marketplace_id, m.code AS marketplace_code,
           c.id AS category_id, c.slug AS category_slug,
           m.country_code
    FROM categories c
    JOIN marketplaces m ON m.id = c.marketplace_id
    WHERE m.is_active AND c.is_active
    ORDER BY m.code, c.slug`);
  return rows;
}

// Ürünü günceller, önceki yorum sayısını döndürür (delta hesabı için).
export async function upsertProduct(client, mpId, categoryId, country, item) {
  const prev = await client.query(
    `SELECT id, review_count FROM products WHERE marketplace_id = $1 AND external_id = $2`,
    [mpId, item.externalId]
  );
  const prevReviewCount = prev.rowCount ? prev.rows[0].review_count : 0;
  const { rows } = await client.query(
    `INSERT INTO products
       (marketplace_id, category_id, external_id, title, brand, url, image_url,
        seller_name, price, currency, rating, review_count, bestseller_rank,
        country_code, last_seen_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now())
     ON CONFLICT (marketplace_id, external_id) DO UPDATE SET
       category_id = EXCLUDED.category_id, title = EXCLUDED.title,
       brand = EXCLUDED.brand, url = EXCLUDED.url, image_url = EXCLUDED.image_url,
       seller_name = EXCLUDED.seller_name, price = EXCLUDED.price,
       currency = EXCLUDED.currency, rating = EXCLUDED.rating,
       review_count = EXCLUDED.review_count,
       bestseller_rank = EXCLUDED.bestseller_rank, last_seen_at = now()
     RETURNING id`,
    [mpId, categoryId, item.externalId, item.title, item.brand, item.url,
     item.imageUrl, item.sellerName, item.price, item.currency, item.rating,
     item.reviewCount, item.rank, country]
  );
  return { id: rows[0].id, prevReviewCount };
}

// Günlük snapshot (tekrar çalışırsa üzerine yazar, çift satır olmaz).
export async function insertSnapshot(client, productId, item, reviewDelta, estimatedSales) {
  await client.query(
    `INSERT INTO product_snapshots
       (product_id, captured_on, price, review_count, rating,
        bestseller_rank, review_count_delta, estimated_sales_daily)
     VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (product_id, captured_on) DO UPDATE SET
       price = EXCLUDED.price, review_count = EXCLUDED.review_count,
       rating = EXCLUDED.rating, bestseller_rank = EXCLUDED.bestseller_rank,
       review_count_delta = EXCLUDED.review_count_delta,
       estimated_sales_daily = EXCLUDED.estimated_sales_daily`,
    [productId, item.price, item.reviewCount, item.rating,
     item.rank, reviewDelta, estimatedSales]
  );
}

// Kategori günlük özeti (panel hızlı açılsın diye).
export async function refreshCategoryStats(client, mpId, categoryId, country) {
  await client.query(
    `INSERT INTO category_daily_stats
       (marketplace_id, category_id, country_code, stats_on,
        product_count, avg_price, total_estimated_sales, top_product_id)
     SELECT $1, $2, $3, CURRENT_DATE,
            COUNT(*), AVG(s.price)::numeric(12,2),
            COALESCE(SUM(s.estimated_sales_daily), 0),
            (SELECT s2.product_id FROM product_snapshots s2
              JOIN products p2 ON p2.id = s2.product_id
              WHERE p2.marketplace_id = $1 AND p2.category_id = $2
                AND s2.captured_on = CURRENT_DATE
              ORDER BY s2.estimated_sales_daily DESC, s2.bestseller_rank ASC NULLS LAST
              LIMIT 1)
     FROM product_snapshots s
     JOIN products p ON p.id = s.product_id
     WHERE p.marketplace_id = $1 AND p.category_id = $2
       AND s.captured_on = CURRENT_DATE
     ON CONFLICT (marketplace_id, category_id, stats_on) DO UPDATE SET
       product_count = EXCLUDED.product_count, avg_price = EXCLUDED.avg_price,
       total_estimated_sales = EXCLUDED.total_estimated_sales,
       top_product_id = EXCLUDED.top_product_id`,
    [mpId, categoryId, country]
  );
}
