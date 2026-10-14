import pg from "pg";

// pg NUMERIC'i (fiyat, puan, yüzde) metin döndürür; API sözleşmesi sayı ister.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, parseFloat);

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
// Ürün yeniyse ya da sayı hiç bilinmediyse null döner. Bugünkü sayı
// bilinmiyorsa (null) son bilinen değer korunur, üzerine yazılmaz.
export async function upsertProduct(client, mpId, categoryId, country, item) {
  const prev = await client.query(
    `SELECT id, review_count FROM products WHERE marketplace_id = $1 AND external_id = $2`,
    [mpId, item.externalId]
  );
  const prevReviewCount = prev.rowCount ? prev.rows[0].review_count : null;
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
       review_count = COALESCE(EXCLUDED.review_count, products.review_count),
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
                AND p2.country_code = $3
                AND s2.captured_on = CURRENT_DATE
              ORDER BY s2.estimated_sales_daily DESC, s2.bestseller_rank ASC NULLS LAST
              LIMIT 1)
     FROM product_snapshots s
     JOIN products p ON p.id = s.product_id
     WHERE p.marketplace_id = $1 AND p.category_id = $2
       AND p.country_code = $3
       AND s.captured_on = CURRENT_DATE
     ON CONFLICT (marketplace_id, category_id, stats_on) DO UPDATE SET
       country_code = EXCLUDED.country_code,
       product_count = EXCLUDED.product_count, avg_price = EXCLUDED.avg_price,
       total_estimated_sales = EXCLUDED.total_estimated_sales,
       top_product_id = EXCLUDED.top_product_id`,
    [mpId, categoryId, country]
  );
}

// --- kur ---

// rates: { USD: 49.216, EUR: ... } (1 birim = kaç TL), rateOn: "YYYY-MM-DD".
export async function upsertFxRates(client, rateOn, rates) {
  for (const [currency, rate] of Object.entries(rates)) {
    await client.query(
      `INSERT INTO fx_rates (rate_on, currency, try_rate) VALUES ($1, $2, $3)
       ON CONFLICT (rate_on, currency) DO UPDATE SET try_rate = EXCLUDED.try_rate`,
      [rateOn, currency, rate]
    );
  }
}

// Para birimi başına en güncel kur.
export async function latestFxRates(client) {
  const { rows } = await client.query(
    `SELECT DISTINCT ON (currency) currency, try_rate
     FROM fx_rates ORDER BY currency, rate_on DESC`
  );
  return Object.fromEntries(rows.map((r) => [r.currency, r.try_rate]));
}

// --- Türkiye karşılaştırması ---

// Bakılacak ürünler: verilen pazaryerlerinde, hiç bakılmamış ya da son
// kontrolü recheckDays günden eski. Önce bakılmamışlar, sonra en iyi sıra.
// retryNoAi: yapay zekâsız bakılmış (anahtar yokken ya da kota bitince) ve
// elle karar verilmemiş ürünler de aday olur; günlük kota sıfırlansın diye
// en erken 20 saat sonra.
export async function loadTrCandidates(client, { codes, limit, recheckDays, retryNoAi = false }) {
  const { rows } = await client.query(
    `SELECT p.id, p.title, p.brand, p.price, p.currency, p.bestseller_rank,
            m.code AS marketplace
     FROM products p
     JOIN marketplaces m ON m.id = p.marketplace_id
     LEFT JOIN tr_checks t ON t.product_id = p.id
     WHERE m.code = ANY($1) AND m.is_active AND p.is_active
       AND (t.checked_at IS NULL
            OR t.checked_at < now() - make_interval(days => $2::int)
            OR ($4::boolean AND t.ai_status IS NULL AND t.human_status IS NULL
                AND t.checked_at < now() - interval '20 hours'))
     ORDER BY (t.checked_at IS NULL) DESC, p.bestseller_rank ASC NULLS LAST, p.last_seen_at DESC
     LIMIT $3`,
    [codes, recheckDays, limit, retryNoAi]
  );
  return rows;
}

// Otomatik kontrolün sonucunu yazar, geçerli durumu döndürür. Elle verilmiş
// karar (human_status) korunur; yalnız kural/yapay zekâ sütunları ve ilanlar
// yenilenir. matches: [{ source, title, url, imageUrl, sellerName, price, kind }].
export async function saveTrCheck(client, productId, { query, sources, ruleStatus, aiStatus, matches }) {
  const unique = [...new Map(matches.map((m) => [m.url, m])).values()];
  const priced = (kind) => unique.filter((m) => m.kind === kind && m.price !== null && m.price !== undefined);
  // En düşük fiyat: aynı ürün ilanları varsa onlardan, yoksa benzerlerden.
  const comparable = priced("same").length ? priced("same") : priced("similar");
  const minPrice = comparable.length ? Math.min(...comparable.map((m) => m.price)) : null;
  await client.query("BEGIN");
  try {
    const { rows } = await client.query(
      `INSERT INTO tr_checks
         (product_id, query, sources, rule_status, ai_status, status,
          match_count, min_price, checked_at)
       VALUES ($1, $2, $3, $4, $5, COALESCE($5, $4, 'unknown'), $6, $7, now())
       ON CONFLICT (product_id) DO UPDATE SET
         query = EXCLUDED.query, sources = EXCLUDED.sources,
         rule_status = EXCLUDED.rule_status, ai_status = EXCLUDED.ai_status,
         status = COALESCE(tr_checks.human_status, EXCLUDED.ai_status,
                           EXCLUDED.rule_status, 'unknown'),
         match_count = EXCLUDED.match_count, min_price = EXCLUDED.min_price,
         checked_at = now()
       RETURNING status`,
      [productId, query, sources, ruleStatus, aiStatus, unique.length, minPrice]
    );
    await client.query(`DELETE FROM tr_matches WHERE product_id = $1`, [productId]);
    for (const m of unique) {
      await client.query(
        `INSERT INTO tr_matches
           (product_id, source, title, url, image_url, seller_name, price, kind)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [productId, m.source, m.title, m.url, m.imageUrl ?? null, m.sellerName ?? null, m.price ?? null, m.kind]
      );
    }
    await client.query("COMMIT");
    return rows[0].status;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}
