// Haftalık özet: takip edilen kategorilerdeki yükselen ürünleri e-postalar.
// runDigest({query, send}) test edilebilir çekirdek; CLI worker/send-digest.js.

export const ITEMS_PER_CATEGORY = 5;

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function changeLabel(change_pct) {
  if (change_pct === null || change_pct === undefined) return "Yeni";
  const sign = change_pct > 0 ? "+" : "";
  return `${sign}${change_pct}%`;
}

function formatPrice(price, currency) {
  if (price === null || price === undefined) return "-";
  return `${price} ${currency || ""}`.trim();
}

// sections: [{marketplace_name, category_name, items:[{title,url,price,currency,sales,change_pct}]}]
export function buildDigest(sections) {
  const total = sections.reduce((n, s) => n + s.items.length, 0);
  const subject = `Haftalık yükselenler: ${sections.length} kategoride ${total} ürün`;

  const textBlocks = sections.map((s) => {
    const head = `== ${s.marketplace_name} / ${s.category_name} ==`;
    const lines = s.items.map((p, i) =>
      `${i + 1}. ${p.title}\n   ${formatPrice(p.price, p.currency)} | tahmini ${p.sales} satış/hafta | ${changeLabel(p.change_pct)}\n   ${p.url}`);
    return [head, ...lines].join("\n");
  });
  const text = `${subject}\n\n${textBlocks.join("\n\n")}\n\nTahminler yorum hareketinden türetilir, gerçek satış adedi değildir.`;

  const htmlBlocks = sections.map((s) => {
    const items = s.items.map((p) =>
      `<li><a href="${escapeHtml(p.url)}">${escapeHtml(p.title)}</a><br>` +
      `${escapeHtml(formatPrice(p.price, p.currency))} | tahmini ${p.sales} satış/hafta | ${escapeHtml(changeLabel(p.change_pct))}</li>`);
    return `<h2>${escapeHtml(s.marketplace_name)} / ${escapeHtml(s.category_name)}</h2><ol>${items.join("")}</ol>`;
  });
  const html = `<h1>${escapeHtml(subject)}</h1>${htmlBlocks.join("")}` +
    `<p><small>Tahminler yorum hareketinden türetilir, gerçek satış adedi değildir.</small></p>`;

  return { subject, text, html };
}

export async function loadPendingFollows(query) {
  const { rows } = await query(
    `SELECT u.id AS user_id, u.email,
            m.code AS marketplace, m.name AS marketplace_name,
            c.id AS category_id, c.name AS category_name
     FROM category_follows f
     JOIN users u ON u.id = f.user_id
     JOIN marketplaces m ON m.id = f.marketplace_id
     JOIN categories c ON c.id = f.category_id
     WHERE u.is_active AND u.digest_enabled AND NOT EXISTS (
       SELECT 1 FROM email_log e
       WHERE e.user_id = u.id AND e.week = date_trunc('week', CURRENT_DATE)::date)
     ORDER BY u.email, m.code, c.name`
  );
  return rows;
}

export async function topRising(query, marketplace, category_id, limit = ITEMS_PER_CATEGORY) {
  const { rows } = await query(
    `WITH agg AS (
       SELECT p.id,
              COALESCE(SUM(s.estimated_sales_daily), 0)::int AS sales,
              COALESCE(SUM(s.estimated_sales_daily)
                FILTER (WHERE s.captured_on > CURRENT_DATE - 3), 0)::int AS sales_recent,
              COALESCE(SUM(s.estimated_sales_daily)
                FILTER (WHERE s.captured_on <= CURRENT_DATE - 3), 0)::int AS sales_prev
       FROM products p
       JOIN marketplaces m ON m.id = p.marketplace_id
       WHERE m.code = $1 AND p.category_id = $2 AND p.is_active
         AND EXISTS (SELECT 1 FROM product_snapshots s
                     WHERE s.product_id = p.id AND s.captured_on >= CURRENT_DATE - 7)
       GROUP BY p.id
     )
     SELECT p.title, p.url, p.price, p.currency, a.sales,
            CASE WHEN a.sales_prev > 0
                 THEN ROUND(((a.sales_recent::float / 3) - (a.sales_prev::float / 4))
                            / (a.sales_prev::float / 4) * 100, 1)
                 WHEN a.sales_recent > 0 THEN NULL ELSE 0 END AS change_pct
     FROM agg a JOIN products p ON p.id = a.id
     ORDER BY change_pct DESC NULLS FIRST, sales DESC
     LIMIT $3`,
    [marketplace, category_id, limit]
  );
  return rows;
}

export async function runDigest({ query, send }) {
  const follows = await loadPendingFollows(query);
  const byUser = new Map();
  for (const f of follows) {
    if (!byUser.has(f.user_id)) byUser.set(f.user_id, { email: f.email, follows: [] });
    byUser.get(f.user_id).follows.push(f);
  }

  let mailed = 0;
  let skipped = 0;
  for (const [user_id, u] of byUser) {
    const sections = [];
    for (const f of u.follows) {
      const items = await topRising(query, f.marketplace, f.category_id);
      if (items.length) {
        sections.push({
          marketplace_name: f.marketplace_name,
          category_name: f.category_name,
          items,
        });
      }
    }
    if (!sections.length) {
      skipped++;
      continue; // veri yoksa e-posta yok (spam yok)
    }
    const { subject, text, html } = buildDigest(sections);
    await send({ to: u.email, subject, text, html });
    const item_count = sections.reduce((n, s) => n + s.items.length, 0);
    await query(
      `INSERT INTO email_log (user_id, week, item_count)
       VALUES ($1, date_trunc('week', CURRENT_DATE)::date, $2)
       ON CONFLICT (user_id, week) DO UPDATE SET sent_at = now(), item_count = EXCLUDED.item_count`,
      [user_id, item_count]
    );
    mailed++;
    console.log(`Özet gönderildi: ${u.email} (${sections.length} kategori, ${item_count} ürün)`);
  }
  console.log(`TOPLAM: ${mailed} e-posta, ${skipped} boş kullanıcı atlandı`);
  return { mailed, skipped };
}
