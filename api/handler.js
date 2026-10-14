// Panel API: saf istek işleyici. Girdi {method, path, headers, body},
// çıktı {status, body}. HTTP adaptörü api/server.js'de, DB erişimi
// enjekte query(text, params) fonksiyonu üzerinden (test edilebilirlik).
import { hashPassword, verifyPassword, signToken, verifyToken } from "./auth.js";
import { ABROAD_MARKETPLACES } from "../worker/config.js";

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const RANGES = { "7d": 7, "30d": 30 };
const SORTS = new Set(["top", "rising"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FAV_LIMIT = 50;
const PAGE_LIMIT = 50;
// Türkiye karşılaştırması: geçerli durumlar ve elle verilebilen kararlar.
const TR_STATUSES = new Set(["found", "similar", "not_found", "unknown", "unchecked"]);
const HUMAN_STATUSES = new Set(["found", "similar", "not_found"]);
const LIST_SORTS = new Set(["rising", "rank"]);

// Ürün satırına TR durumu + TL fiyatı ekleyen ortak SQL parçaları
// (ürün takma adı p olmalı).
const TR_JOIN = `LEFT JOIN tr_checks tc ON tc.product_id = p.id
         LEFT JOIN LATERAL (SELECT f.try_rate FROM fx_rates f
                            WHERE f.currency = p.currency
                            ORDER BY f.rate_on DESC LIMIT 1) fx ON TRUE`;
const TR_FIELDS = `CASE WHEN p.currency = 'TRY' THEN p.price
                     ELSE ROUND(p.price * fx.try_rate, 2) END AS price_try,
                COALESCE(tc.status, 'unchecked') AS tr_status,
                tc.min_price AS tr_min_price,
                COALESCE(tc.match_count, 0) AS tr_match_count,
                to_char(tc.checked_at, 'YYYY-MM-DD') AS tr_checked_on`;

function required(value, name) {
  if (value === undefined || value === null || value === "") {
    throw new HttpError(400, `${name} gerekli.`);
  }
  return value;
}

function asRange(value) {
  const days = RANGES[value || "7d"];
  if (!days) throw new HttpError(400, "range 7d veya 30d olmalı.");
  return days;
}

function asSort(value) {
  const sort = value || "top";
  if (!SORTS.has(sort)) throw new HttpError(400, "sort top veya rising olmalı.");
  return sort;
}

function asNumber(value, name) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new HttpError(400, `${name} sayı olmalı.`);
  return n;
}

// tr filtresi: boşsa varsayılan; "all" filtreyi kaldırır.
function asTr(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  if (value === "all") return null;
  if (!TR_STATUSES.has(value)) {
    throw new HttpError(400, "tr found, similar, not_found, unknown, unchecked veya all olmalı.");
  }
  return value;
}

function asListSort(value, fallback) {
  const sort = value || fallback;
  if (!LIST_SORTS.has(sort)) throw new HttpError(400, "sort rising veya rank olmalı.");
  return sort;
}

function asLimit(value) {
  if (value === undefined || value === null || value === "") return 20;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > PAGE_LIMIT) {
    throw new HttpError(400, `limit 1-${PAGE_LIMIT} arası olmalı.`);
  }
  return n;
}

export function createHandler({ query, jwtSecret }) {
  if (typeof query !== "function") throw new Error("query fonksiyonu gerekli.");
  if (!jwtSecret) throw new Error("JWT_SECRET gerekli.");

  function user(headers) {
    const h = headers?.authorization ?? headers?.Authorization ?? "";
    const m = h.match(/^Bearer (.+)$/);
    const payload = m ? verifyToken(m[1], jwtSecret) : null;
    if (!payload) throw new HttpError(401, "Geçersiz veya eksik token.");
    return payload;
  }

  async function ok(body, status = 200) {
    return { status, body };
  }

  async function admin(headers) {
    const u = user(headers);
    const { rows } = await query(`SELECT is_admin FROM users WHERE id = $1 AND is_active`, [u.sub]);
    if (!rows[0]?.is_admin) throw new HttpError(403, "Bu işlem için yönetici yetkisi gerekli.");
    return u;
  }

  // Pazaryerleri arası ürün listesi (explosions + opportunities ortak gövdesi).
  // marketplace verilmezse kapsam yurt dışıdır.
  async function abroadList(search, { defaultTr, defaultSort }) {
    const marketplace = search.get("marketplace") || null;
    const category = search.get("category") || null;
    const group = search.get("group") || null;
    const days = asRange(search.get("range"));
    const min = asNumber(search.get("min_price"), "min_price");
    const max = asNumber(search.get("max_price"), "max_price");
    if (min !== null && max !== null && min > max) {
      throw new HttpError(400, "min_price max_price'tan büyük olamaz.");
    }
    const minSales = asNumber(search.get("min_sales"), "min_sales");
    if (minSales !== null && minSales < 0) {
      throw new HttpError(400, "min_sales 0 veya büyük olmalı.");
    }
    const minChange = asNumber(search.get("min_change"), "min_change");
    const limit = asLimit(search.get("limit"));
    const tr = asTr(search.get("tr"), defaultTr);
    const sort = asListSort(search.get("sort"), defaultSort);

    let codes;
    if (marketplace) {
      const mp = await query(`SELECT id FROM marketplaces WHERE code = $1 AND is_active`, [marketplace]);
      if (!mp.rowCount) throw new HttpError(404, "Pazaryeri bulunamadı.");
      codes = [marketplace];
    } else {
      codes = [...ABROAD_MARKETPLACES];
    }

    const recentDays = Math.floor(days / 2);
    const prevDays = days - recentDays;
    const order = sort === "rank"
      ? "ORDER BY t.bestseller_rank ASC NULLS LAST, t.sales_recent DESC"
      : `ORDER BY t.change_pct DESC NULLS FIRST, t.sales_recent DESC,
                  t.rank_jump DESC NULLS LAST`;
    const { rows } = await query(
      `SELECT * FROM (
         SELECT p.id, m.code AS marketplace, c.slug AS category, c.group_slug AS "group",
                p.title, p.brand, p.url, p.image_url, p.seller_name,
                p.price, p.currency, p.rating, p.review_count, p.bestseller_rank,
                a.sales, a.sales_recent, a.sales_prev, a.best_rank,
                a.rank_recent, a.rank_prev,
                (a.rank_prev - a.rank_recent) AS rank_jump,
                CASE WHEN a.sales_prev > 0
                     THEN ROUND((((a.sales_recent::float / $7) - (a.sales_prev::float / $8))
                                 / (a.sales_prev::float / $8) * 100)::numeric, 1)
                     WHEN a.sales_recent > 0 THEN NULL ELSE 0 END AS change_pct,
                (a.sales_prev = 0 AND a.sales_recent > 0) AS is_new,
                ${TR_FIELDS}
         FROM (
           SELECT p2.id,
                  COALESCE(SUM(s.estimated_sales_daily), 0)::int AS sales,
                  COALESCE(SUM(s.estimated_sales_daily)
                    FILTER (WHERE s.captured_on > CURRENT_DATE - $5::int), 0)::int AS sales_recent,
                  COALESCE(SUM(s.estimated_sales_daily)
                    FILTER (WHERE s.captured_on <= CURRENT_DATE - $5::int), 0)::int AS sales_prev,
                  MIN(s.bestseller_rank) AS best_rank,
                  MIN(s.bestseller_rank)
                    FILTER (WHERE s.captured_on > CURRENT_DATE - $5::int) AS rank_recent,
                  MIN(s.bestseller_rank)
                    FILTER (WHERE s.captured_on <= CURRENT_DATE - $5::int) AS rank_prev
           FROM products p2
           JOIN marketplaces m2 ON m2.id = p2.marketplace_id
           JOIN categories c2 ON c2.id = p2.category_id
           LEFT JOIN product_snapshots s
             ON s.product_id = p2.id AND s.captured_on >= CURRENT_DATE - $6::int
           WHERE m2.code = ANY($1) AND m2.is_active AND p2.is_active
             AND ($2::text IS NULL OR c2.slug = $2)
             AND ($3::numeric IS NULL OR p2.price >= $3)
             AND ($4::numeric IS NULL OR p2.price <= $4)
             AND ($11::text IS NULL OR c2.group_slug = $11)
           GROUP BY p2.id
         ) a
         JOIN products p ON p.id = a.id
         JOIN marketplaces m ON m.id = p.marketplace_id
         JOIN categories c ON c.id = p.category_id
         ${TR_JOIN}
       ) t
       WHERE ($9::int IS NULL OR t.sales_recent >= $9)
         AND ($10::numeric IS NULL OR t.is_new OR t.change_pct >= $10)
         AND ($12::text IS NULL OR t.tr_status = $12)
       ${order}
       LIMIT ${limit}`,
      [codes, category, min, max, recentDays, days, recentDays, prevDays, minSales, minChange, group, tr]
    );
    return ok({
      data: rows,
      meta: {
        range: `${days}d`, marketplaces: codes, category, group,
        min_sales: minSales, min_change: minChange, tr: tr ?? "all", sort,
      },
    });
  }

  const routes = {
    // POST /api/auth/register {email, password} -> 201 {token}
    async register({ body }) {
      const email = String(required(body?.email, "email")).trim().toLowerCase();
      if (!EMAIL_RE.test(email)) throw new HttpError(400, "Geçersiz e-posta.");
      if (!body?.password || String(body.password).length < 8) {
        throw new HttpError(400, "Şifre en az 8 karakter olmalı.");
      }
      const exists = await query(`SELECT id FROM users WHERE email = $1`, [email]);
      if (exists.rowCount) throw new HttpError(409, "Bu e-posta kayıtlı.");
      const password_hash = await hashPassword(String(body.password));
      const created = await query(
        `INSERT INTO users (email, password_hash, trial_ends_at)
         VALUES ($1, $2, now() + interval '7 days') RETURNING id`,
        [email, password_hash]
      );
      const sub = created.rows[0].id;
      return ok({ token: signToken(jwtSecret, { sub, email }) }, 201);
    },

    // POST /api/auth/login {email, password} -> 200 {token}
    async login({ body }) {
      const email = String(required(body?.email, "email")).trim().toLowerCase();
      required(body?.password, "password");
      const found = await query(
        `SELECT id, password_hash FROM users WHERE email = $1 AND is_active`,
        [email]
      );
      if (!found.rowCount) throw new HttpError(401, "E-posta veya şifre hatalı.");
      const valid = await verifyPassword(String(body.password), found.rows[0].password_hash);
      if (!valid) throw new HttpError(401, "E-posta veya şifre hatalı.");
      return ok({ token: signToken(jwtSecret, { sub: found.rows[0].id, email }) });
    },

    // GET /api/categories?marketplace=amazon_de
    async categories({ search }) {
      const code = required(search.get("marketplace"), "marketplace");
      const mp = await query(`SELECT id FROM marketplaces WHERE code = $1 AND is_active`, [code]);
      if (!mp.rowCount) throw new HttpError(404, "Pazaryeri bulunamadı.");
      const { rows } = await query(
        `SELECT c.id, c.name, c.slug FROM categories c
         JOIN marketplaces m ON m.id = c.marketplace_id
         WHERE m.code = $1 AND c.is_active ORDER BY c.name`,
        [code]
      );
      return ok({ data: rows });
    },

    // GET /api/products?marketplace=&category=&range=&sort=&min_price=&max_price=
    async products({ search }) {
      const code = required(search.get("marketplace"), "marketplace");
      const slug = required(search.get("category"), "category");
      const days = asRange(search.get("range"));
      const sort = asSort(search.get("sort"));
      const min = asNumber(search.get("min_price"), "min_price");
      const max = asNumber(search.get("max_price"), "max_price");
      if (min !== null && max !== null && min > max) {
        throw new HttpError(400, "min_price max_price'tan büyük olamaz.");
      }
      const target = await query(
        `SELECT c.id FROM categories c
         JOIN marketplaces m ON m.id = c.marketplace_id
         WHERE m.code = $1 AND c.slug = $2 AND m.is_active AND c.is_active`,
        [code, slug]
      );
      if (!target.rowCount) throw new HttpError(404, "Pazaryeri/kategori bulunamadı.");

      const recentDays = Math.floor(days / 2);
      const prevDays = days - recentDays;
      const tr = asTr(search.get("tr"));
      // Eşit satışta (ilk günlerde hepsi 0) pazaryerinin kendi sırası belirler.
      const order =
        sort === "rising"
          ? "ORDER BY change_pct DESC NULLS FIRST, sales DESC"
          : "ORDER BY sales DESC, p.bestseller_rank ASC NULLS LAST";
      const { rows } = await query(
        `WITH agg AS (
           SELECT p.id,
                  COALESCE(SUM(s.estimated_sales_daily), 0)::int AS sales,
                  COALESCE(SUM(s.estimated_sales_daily)
                    FILTER (WHERE s.captured_on > CURRENT_DATE - $5::int), 0)::int AS sales_recent,
                  COALESCE(SUM(s.estimated_sales_daily)
                    FILTER (WHERE s.captured_on <= CURRENT_DATE - $5::int), 0)::int AS sales_prev,
                  MIN(s.bestseller_rank) AS best_rank
           FROM products p
           JOIN marketplaces m ON m.id = p.marketplace_id
           JOIN categories c ON c.id = p.category_id
           LEFT JOIN product_snapshots s
             ON s.product_id = p.id AND s.captured_on >= CURRENT_DATE - $6::int
           WHERE m.code = $1 AND c.slug = $2 AND p.is_active
             AND ($3::numeric IS NULL OR p.price >= $3)
             AND ($4::numeric IS NULL OR p.price <= $4)
           GROUP BY p.id
         )
         SELECT p.id, p.title, p.brand, p.url, p.image_url, p.seller_name,
                p.price, p.currency, p.rating, p.review_count, p.bestseller_rank,
                a.sales, a.best_rank,
                CASE WHEN a.sales_prev > 0
                     THEN ROUND((((a.sales_recent::float / $7) - (a.sales_prev::float / $8))
                                 / (a.sales_prev::float / $8) * 100)::numeric, 1)
                     WHEN a.sales_recent > 0 THEN NULL ELSE 0 END AS change_pct,
                ${TR_FIELDS}
         FROM agg a JOIN products p ON p.id = a.id
         ${TR_JOIN}
         WHERE ($9::text IS NULL OR COALESCE(tc.status, 'unchecked') = $9)
         ${order} LIMIT ${PAGE_LIMIT}`,
        [code, slug, min, max, recentDays, days, recentDays, prevDays, tr]
      );
      return ok({ data: rows, meta: { range: `${days}d`, sort } });
    },

    // GET /api/products/:id?range=30d
    async productDetail({ search, params }) {
      const id = params[0];
      if (!UUID_RE.test(id || "")) throw new HttpError(400, "Geçersiz ürün id.");
      const days = search.get("range") ? asRange(search.get("range")) : 30;
      const found = await query(
        `SELECT p.id, p.title, p.brand, p.url, p.image_url, p.seller_name,
                p.price, p.currency, p.rating, p.review_count, p.bestseller_rank,
                m.code AS marketplace, c.slug AS category,
                CASE WHEN p.currency = 'TRY' THEN p.price
                     ELSE ROUND(p.price * fx.try_rate, 2) END AS price_try
         FROM products p
         JOIN marketplaces m ON m.id = p.marketplace_id
         LEFT JOIN categories c ON c.id = p.category_id
         LEFT JOIN LATERAL (SELECT f.try_rate FROM fx_rates f
                            WHERE f.currency = p.currency
                            ORDER BY f.rate_on DESC LIMIT 1) fx ON TRUE
         WHERE p.id = $1`,
        [id]
      );
      if (!found.rowCount) throw new HttpError(404, "Ürün bulunamadı.");
      const check = await query(
        `SELECT status, query, sources, rule_status, ai_status, human_status, human_note,
                min_price, to_char(checked_at, 'YYYY-MM-DD') AS checked_on
         FROM tr_checks WHERE product_id = $1`,
        [id]
      );
      const matches = await query(
        `SELECT source, kind, title, url, image_url, seller_name, price
         FROM tr_matches WHERE product_id = $1
         ORDER BY (kind = 'same') DESC, price ASC NULLS LAST`,
        [id]
      );
      const tr = check.rowCount
        ? { ...check.rows[0], matches: matches.rows }
        : { status: "unchecked", matches: [] };
      const series = await query(
        `SELECT to_char(captured_on, 'YYYY-MM-DD') AS date, price,
                estimated_sales_daily AS sales, bestseller_rank AS rank
         FROM product_snapshots
         WHERE product_id = $1 AND captured_on >= CURRENT_DATE - $2::int
         ORDER BY captured_on`,
        [id, days]
      );
      return ok({ ...found.rows[0], tr, series: series.rows, meta: { range: `${days}d` } });
    },

    // GET /api/explosions?marketplace=&category=&group=&range=&min_price=&max_price=&min_sales=&min_change=&tr=&sort=&limit=
    // Pazaryerleri arası "satış patlaması" listesi. marketplace verilmezse
    // varsayılan kapsam yurt dışıdır (amazon_us, amazon_de, aliexpress_global).
    async explosions({ search }) {
      return abroadList(search, { defaultTr: null, defaultSort: "rising" });
    },

    // GET /api/opportunities?... (explosions ile aynı parametreler)
    // Yurt dışında satan, Türkiye'de bulunamayan ürünler: varsayılan
    // tr=not_found, sıralama pazaryerinin kendi sırası.
    async opportunities({ search }) {
      return abroadList(search, { defaultTr: "not_found", defaultSort: "rank" });
    },

    // GET /api/markets -> pazaryerleri (ülke, para birimi) + kategorileri
    async markets() {
      const { rows } = await query(
        `SELECT m.code, m.name, m.country_code, m.currency, m.website,
                c.id AS category_id, c.name AS category_name, c.slug, c.group_slug,
                (SELECT COUNT(*)::int FROM products p
                  WHERE p.category_id = c.id AND p.is_active) AS product_count,
                (SELECT to_char(MAX(st.stats_on), 'YYYY-MM-DD') FROM category_daily_stats st
                  WHERE st.category_id = c.id) AS last_fetched_on
         FROM marketplaces m
         LEFT JOIN categories c ON c.marketplace_id = m.id AND c.is_active
         WHERE m.is_active
         ORDER BY m.code, c.name`
      );
      const byCode = new Map();
      for (const r of rows) {
        if (!byCode.has(r.code)) {
          byCode.set(r.code, {
            code: r.code, name: r.name, country: r.country_code, currency: r.currency,
            website: r.website, abroad: ABROAD_MARKETPLACES.includes(r.code), categories: [],
          });
        }
        if (r.category_id !== null) {
          byCode.get(r.code).categories.push({
            id: r.category_id, name: r.category_name, slug: r.slug, group: r.group_slug,
            product_count: r.product_count, last_fetched_on: r.last_fetched_on,
          });
        }
      }
      return ok({ data: [...byCode.values()] });
    },

    // PUT /api/products/:id/tr-status {status, note} (yönetici)
    // Elle karar: otomatik kontrolün önüne geçer. status: null kararı kaldırır.
    async trStatus({ headers, body, params }) {
      const u = await admin(headers);
      const id = params[0];
      if (!UUID_RE.test(id || "")) throw new HttpError(400, "Geçersiz ürün id.");
      const status = body?.status ?? null;
      if (status !== null && !HUMAN_STATUSES.has(status)) {
        throw new HttpError(400, "status found, similar, not_found veya null olmalı.");
      }
      const note = body?.note ? String(body.note).slice(0, 500) : null;
      const prod = await query(`SELECT id FROM products WHERE id = $1`, [id]);
      if (!prod.rowCount) throw new HttpError(404, "Ürün bulunamadı.");
      if (status === null) {
        // Hiç otomatik bakılmamış satır tümüyle silinir (yeniden "unchecked").
        await query(`DELETE FROM tr_checks WHERE product_id = $1 AND checked_at IS NULL`, [id]);
        await query(
          `UPDATE tr_checks SET human_status = NULL, human_note = NULL, human_by = NULL,
                  human_at = NULL, status = COALESCE(ai_status, rule_status, 'unknown')
           WHERE product_id = $1`,
          [id]
        );
      } else {
        await query(
          `INSERT INTO tr_checks (product_id, human_status, human_note, human_by, human_at, status)
           VALUES ($1, $2, $3, $4, now(), $2)
           ON CONFLICT (product_id) DO UPDATE SET
             human_status = EXCLUDED.human_status, human_note = EXCLUDED.human_note,
             human_by = EXCLUDED.human_by, human_at = now(), status = EXCLUDED.human_status`,
          [id, status, note, u.sub]
        );
      }
      const now = await query(`SELECT status FROM tr_checks WHERE product_id = $1`, [id]);
      return ok({ ok: true, tr_status: now.rows[0]?.status ?? "unchecked" });
    },

    // GET /api/tr-review?limit= (yönetici)
    // İnsanın bakması gerekenler: yapay zekâ "yok" dedi (fırsat iddiası) ya da
    // kural "var" derken yapay zekâ aksini söyledi. Elle karar verilenler çıkmaz.
    async trReview({ headers, search }) {
      await admin(headers);
      const limit = asLimit(search.get("limit"));
      const { rows } = await query(
        `SELECT p.id, m.code AS marketplace, p.title, p.url, p.image_url,
                p.price, p.currency, p.bestseller_rank,
                tc.query, tc.sources, tc.rule_status, tc.ai_status, tc.status,
                tc.match_count, tc.min_price,
                to_char(tc.checked_at, 'YYYY-MM-DD') AS checked_on,
                CASE WHEN tc.rule_status = 'found' AND tc.ai_status <> 'found'
                     THEN 'conflict' ELSE 'ai_not_found' END AS reason
         FROM tr_checks tc
         JOIN products p ON p.id = tc.product_id
         JOIN marketplaces m ON m.id = p.marketplace_id
         WHERE tc.human_status IS NULL AND p.is_active
           AND (tc.ai_status = 'not_found'
                OR (tc.rule_status = 'found' AND tc.ai_status <> 'found'))
         ORDER BY p.bestseller_rank ASC NULLS LAST, tc.checked_at DESC
         LIMIT ${limit}`
      );
      return ok({ data: rows });
    },

    // GET /api/favorites (auth)
    async favList({ headers }) {
      const u = user(headers);
      const { rows } = await query(
        `SELECT p.id, p.title, p.price, p.currency, p.image_url, p.url,
                p.rating, p.review_count, f.created_at
         FROM favorites f JOIN products p ON p.id = f.product_id
         WHERE f.user_id = $1 ORDER BY f.created_at DESC`,
        [u.sub]
      );
      return ok({ data: rows });
    },

    // POST /api/favorites {product_id} (auth) -> 201 yeni, 200 zaten var, 409 limit
    async favAdd({ headers, body }) {
      const u = user(headers);
      const product_id = required(body?.product_id, "product_id");
      if (!UUID_RE.test(String(product_id))) throw new HttpError(400, "Geçersiz ürün id.");
      const prod = await query(`SELECT id FROM products WHERE id = $1`, [product_id]);
      if (!prod.rowCount) throw new HttpError(404, "Ürün bulunamadı.");
      const count = await query(`SELECT COUNT(*)::int AS n FROM favorites WHERE user_id = $1`, [u.sub]);
      const already = await query(
        `SELECT 1 FROM favorites WHERE user_id = $1 AND product_id = $2`, [u.sub, product_id]
      );
      if (!already.rowCount && count.rows[0].n >= FAV_LIMIT) {
        throw new HttpError(409, `Favori limiti (${FAV_LIMIT}) doldu.`);
      }
      const ins = await query(
        `INSERT INTO favorites (user_id, product_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING RETURNING product_id`,
        [u.sub, product_id]
      );
      return ok({ ok: true }, ins.rowCount ? 201 : 200);
    },

    // DELETE /api/favorites/:productId (auth)
    async favDel({ headers, params }) {
      const u = user(headers);
      await query(`DELETE FROM favorites WHERE user_id = $1 AND product_id = $2`, [u.sub, params[0]]);
      return ok({ ok: true });
    },

    // GET /api/follows (auth)
    async followList({ headers }) {
      const u = user(headers);
      const { rows } = await query(
        `SELECT m.code AS marketplace, c.id AS category_id, c.name, c.slug
         FROM category_follows f
         JOIN marketplaces m ON m.id = f.marketplace_id
         JOIN categories c ON c.id = f.category_id
         WHERE f.user_id = $1 ORDER BY m.code, c.name`,
        [u.sub]
      );
      return ok({ data: rows });
    },

    // POST /api/follows {marketplace, category_id} (auth)
    async followAdd({ headers, body }) {
      const u = user(headers);
      const code = required(body?.marketplace, "marketplace");
      const category_id = required(body?.category_id, "category_id");
      if (!Number.isInteger(category_id)) throw new HttpError(400, "category_id sayı olmalı.");
      const target = await query(
        `SELECT c.id FROM categories c
         JOIN marketplaces m ON m.id = c.marketplace_id
         WHERE m.code = $1 AND c.id = $2`,
        [code, category_id]
      );
      if (!target.rowCount) throw new HttpError(404, "Pazaryeri/kategori bulunamadı.");
      const ins = await query(
        `INSERT INTO category_follows (user_id, marketplace_id, category_id)
         SELECT $1, m.id, $3 FROM marketplaces m WHERE m.code = $2
         ON CONFLICT DO NOTHING RETURNING category_id`,
        [u.sub, code, category_id]
      );
      return ok({ ok: true }, ins.rowCount ? 201 : 200);
    },

    // DELETE /api/follows/:categoryId (auth)
    async followDel({ headers, params }) {
      const u = user(headers);
      await query(`DELETE FROM category_follows WHERE user_id = $1 AND category_id = $2`, [
        u.sub,
        Number(params[0]),
      ]);
      return ok({ ok: true });
    },
  };

  return async function handle(req) {
    try {
      const url = new URL(req.path, "http://local");
      const seg = url.pathname.split("/").filter(Boolean);
      const ctx = { search: url.searchParams, headers: req.headers || {}, body: req.body, params: [] };
      if (seg[0] !== "api") throw new HttpError(404, "Bulunamadı.");
      const [, r1, r2, r3] = seg;

      if (r1 === "auth" && req.method === "POST" && r2 === "register" && !r3) return await routes.register(ctx);
      if (r1 === "auth" && req.method === "POST" && r2 === "login" && !r3) return await routes.login(ctx);
      if (r1 === "categories" && req.method === "GET" && !r2) return await routes.categories(ctx);
      if (r1 === "products" && req.method === "GET" && !r2) return await routes.products(ctx);
      if (r1 === "products" && req.method === "GET" && r2 && !r3) {
        ctx.params = [r2];
        return await routes.productDetail(ctx);
      }
      if (r1 === "products" && req.method === "PUT" && r2 && r3 === "tr-status" && !seg[4]) {
        ctx.params = [r2];
        return await routes.trStatus(ctx);
      }
      if (r1 === "explosions" && req.method === "GET" && !r2) return await routes.explosions(ctx);
      if (r1 === "opportunities" && req.method === "GET" && !r2) return await routes.opportunities(ctx);
      if (r1 === "markets" && req.method === "GET" && !r2) return await routes.markets(ctx);
      if (r1 === "tr-review" && req.method === "GET" && !r2) return await routes.trReview(ctx);
      if (r1 === "favorites" && req.method === "GET" && !r2) return await routes.favList(ctx);
      if (r1 === "favorites" && req.method === "POST" && !r2) return await routes.favAdd(ctx);
      if (r1 === "favorites" && req.method === "DELETE" && r2 && !r3) {
        ctx.params = [r2];
        return await routes.favDel(ctx);
      }
      if (r1 === "follows" && req.method === "GET" && !r2) return await routes.followList(ctx);
      if (r1 === "follows" && req.method === "POST" && !r2) return await routes.followAdd(ctx);
      if (r1 === "follows" && req.method === "DELETE" && r2 && !r3) {
        ctx.params = [r2];
        return await routes.followDel(ctx);
      }
      throw new HttpError(404, "Bulunamadı.");
    } catch (err) {
      if (err instanceof HttpError) return { status: err.status, body: { error: err.message } };
      throw err;
    }
  };
}
