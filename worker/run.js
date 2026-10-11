// Günlük veri çekme işi.
//   node worker/run.js --dry-run                 -> DB'siz önizleme (mock veri)
//   node worker/run.js                            -> DB'ye yazar (mock veri)
//   REAL_FETCH=1 node worker/run.js               -> gerçek çekim (Apify, ücretli)
//   node worker/run.js --marketplace=amazon_de    -> tek pazaryerine indirgeme
//   node worker/run.js --abroad                   -> yalnız yurt dışı hedefler (sık çekim için)

import "./env.js";
import { MARKETPLACES, CATEGORIES, FETCH_LIMIT, ABROAD_MARKETPLACES } from "./config.js";
import { fetchCategoryProducts } from "./fetchers.js";
import { estimateDailySales, reviewDelta } from "./estimate.js";

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const abroadOnly = argv.includes("--abroad");
const onlyArg = argv.find((a) => a.startsWith("--marketplace="));
const onlyMarketplace = onlyArg ? onlyArg.split("=")[1] : null;
const dayIndex = Math.floor(Date.now() / 86400000);

if (onlyMarketplace && !MARKETPLACES[onlyMarketplace]) {
  console.error(`Bilinmeyen pazaryeri: ${onlyMarketplace}`);
  process.exit(1);
}
if (onlyMarketplace && abroadOnly && !ABROAD_MARKETPLACES.includes(onlyMarketplace)) {
  console.error(`--abroad ile yalnız yurt dışı pazaryeri seçilebilir: ${onlyMarketplace}`);
  process.exit(1);
}

function targets() {
  // Dry-run: DB yok, config'den hedef listesi. Gerçek koşu: DB'den okunur.
  const codes = onlyMarketplace
    ? [onlyMarketplace]
    : abroadOnly ? [...ABROAD_MARKETPLACES] : Object.keys(MARKETPLACES);
  return codes.flatMap((code) =>
    CATEGORIES[code].map((slug) => ({ marketplace_code: code, category_slug: slug }))
  );
}

async function runDry() {
  const realMode = process.env.REAL_FETCH === "1";
  let totalProducts = 0;
  let totalSales = 0;
  const failures = [];
  for (const t of targets()) {
    try {
      const mp = MARKETPLACES[t.marketplace_code];
      const today = await fetchCategoryProducts({
        marketplaceCode: t.marketplace_code,
        categorySlug: t.category_slug,
        limit: FETCH_LIMIT,
        dayIndex,
      });
      totalProducts += today.length;
      if (realMode) {
        // Gerçek modda ikinci çekim hem ücretli hem anlamsız (aynı veri);
        // satış tahmini DB'deki dünkü veriyle canlı koşuda hesaplanır.
        const sample = today.slice(0, 3).map((p) => `"${p.title.slice(0, 40)}..."`).join(", ");
        console.log(`${t.marketplace_code} / ${t.category_slug}: ${today.length} ürün çekildi. Örnek: ${sample}`);
        continue;
      }
      const yesterday = await fetchCategoryProducts({
        marketplaceCode: t.marketplace_code,
        categorySlug: t.category_slug,
        limit: FETCH_LIMIT,
        dayIndex: dayIndex - 1,
      });
      const prevById = new Map(yesterday.map((p) => [p.externalId, p.reviewCount]));
      let catSales = 0;
      for (const p of today) {
        const delta = p.reviewCount - (prevById.get(p.externalId) ?? 0);
        catSales += estimateDailySales(delta, mp.reviewCoefficient);
      }
      totalSales += catSales;
      console.log(`${t.marketplace_code} / ${t.category_slug}: ${today.length} ürün, tahmini ${catSales} satış/gün`);
    } catch (err) {
      const label = `${t.marketplace_code}/${t.category_slug}`;
      console.error(`HATA [${label}]: ${err.message}`);
      failures.push(label);
    }
  }
  if (realMode) {
    console.log(`TOPLAM: ${totalProducts} ürün çekildi (DB'ye yazılmadı, satış tahmini canlı koşuda)`);
  } else {
    console.log(`TOPLAM: ${totalProducts} ürün, tahmini ${totalSales} satış/gün (DB'ye yazılmadı)`);
  }
  if (failures.length > 0) {
    console.error(`BAŞARISIZ (${failures.length}): ${failures.join(", ")}`);
  }
}

async function runLive() {
  const db = await import("./db.js");
  const pool = db.getPool();
  const client = await pool.connect();
  try {
    let targets = await db.loadTargets(client);
    if (onlyMarketplace) targets = targets.filter((t) => t.marketplace_code === onlyMarketplace);
    if (abroadOnly) targets = targets.filter((t) => ABROAD_MARKETPLACES.includes(t.marketplace_code));
    if (targets.length === 0) {
      console.error("Aktif hedef bulunamadı (marketplaces/categories seed edildi mi?)");
      process.exit(1);
    }
    let totalProducts = 0;
    let totalSales = 0;
    const failures = [];
    for (const t of targets) {
      try {
        const mp = MARKETPLACES[t.marketplace_code];
        const items = await fetchCategoryProducts({
          marketplaceCode: t.marketplace_code,
          categorySlug: t.category_slug,
          limit: FETCH_LIMIT,
          dayIndex,
        });
        await client.query("BEGIN");
        try {
          let catSales = 0;
          for (const item of items) {
            const { id, prevReviewCount } = await db.upsertProduct(
              client, t.marketplace_id, t.category_id, t.country_code, item
            );
            // İlk görülen ya da sayısı bilinmeyen üründe delta 0 -> 0 satış.
            const delta = reviewDelta(prevReviewCount, item.reviewCount);
            const sales = estimateDailySales(delta, mp.reviewCoefficient);
            await db.insertSnapshot(client, id, item, Math.max(0, delta), sales);
            catSales += sales;
          }
          await db.refreshCategoryStats(client, t.marketplace_id, t.category_id, t.country_code);
          await client.query("COMMIT");
          totalProducts += items.length;
          totalSales += catSales;
          console.log(`${t.marketplace_code} / ${t.category_slug}: ${items.length} ürün yazıldı, tahmini ${catSales} satış/gün`);
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        }
      } catch (err) {
        const label = `${t.marketplace_code}/${t.category_slug}`;
        console.error(`HATA [${label}]: ${err.message}`);
        failures.push(label);
      }
    }
    console.log(`TOPLAM: ${totalProducts} ürün, tahmini ${totalSales} satış/gün`);
    if (failures.length > 0) {
      console.error(`BAŞARISIZ (${failures.length}/${targets.length}): ${failures.join(", ")}`);
    }
  } finally {
    client.release();
    await db.closePool();
  }
}

try {
  if (dryRun) await runDry();
  else await runLive();
} catch (err) {
  console.error("CRON HATASI:", err.message);
  process.exit(1);
}
