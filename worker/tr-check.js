// Türkiye karşılaştırma işi: yurt dışı ürünler TR'de var mı, kaça?
//   node worker/tr-check.js --dry-run              -> bakılacak ürünleri gösterir, çekim yapmaz
//   node worker/tr-check.js                         -> TR sitelerinde arar, DB'ye yazar
//   node worker/tr-check.js --limit=10              -> en fazla 10 ürün
//   node worker/tr-check.js --marketplace=amazon_us -> tek pazaryerinin ürünleri
// Aramalar ücretsizdir (sayfalar doğrudan çekilir). GEMINI_API_KEY ya da
// NVIDIA_API_KEY varsa yapay zekâ katmanı da çalışır; yoksa yalnız kural katmanı.

import { fileURLToPath } from "node:url";
import {
  ABROAD_MARKETPLACES, MARKETPLACES, TR_SEARCH_SOURCES, TR_CHECK_LIMIT,
  TR_RECHECK_DAYS, TR_SEARCH_DELAY_MS, LLM_MIN_INTERVAL_MS,
} from "./config.js";
import { searchTurkey } from "./tr-search.js";
import { fold, ruleQuery, ruleMatches, createAi } from "./tr-match.js";
import { QuotaError, llmConfigured } from "./llm.js";
import { toTry } from "./fx.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// db: worker/db.js (loadTrCandidates, latestFxRates, saveTrCheck).
// search / ai enjekte edilebilir (testler); ai null ise yalnız kural katmanı.
export async function runTrCheck({
  db, client,
  codes = ABROAD_MARKETPLACES, limit = TR_CHECK_LIMIT,
  search = searchTurkey, ai = null,
  dryRun = false, delayMs = TR_SEARCH_DELAY_MS, log = console.log,
}) {
  // Yapay zekâ açıkken, daha önce onsuz bakılmış ürünler de yeniden aday olur.
  const products = await db.loadTrCandidates(client, {
    codes, limit, recheckDays: TR_RECHECK_DAYS, retryNoAi: Boolean(ai),
  });
  const tally = { candidates: products.length, found: 0, similar: 0, not_found: 0, unknown: 0, failed: 0 };
  if (dryRun) {
    for (const p of products) {
      log(`${p.marketplace} #${p.bestseller_rank ?? "-"} | ${p.title.slice(0, 70)} -> "${ruleQuery(p)}"`);
    }
    if (ai && products.length) {
      log("Not: gerçek koşuda arama ifadelerini yapay zekâ üretir (ürün başına iki arama).");
    }
    return tally;
  }
  if (products.length === 0) return tally;

  const rates = await db.latestFxRates(client);
  let sources = [...TR_SEARCH_SOURCES];
  let queries = new Map();
  let aiOn = Boolean(ai);
  if (aiOn) {
    try {
      queries = await ai.queries(products);
    } catch (err) {
      aiOn = false;
      log(`UYARI: yapay zekâ kullanılamıyor (${err.message}); yalnız kural katmanı çalışacak.`);
    }
  }

  for (const [n, p] of products.entries()) {
    if (sources.length === 0) {
      log("UYARI: TR sitelerinin hepsi erişimi engelledi; kalan ürünler sonraki koşuya kaldı.");
      break;
    }
    if (n > 0) await sleep(delayMs);
    try {
      const aiQuery = aiOn ? queries.get(p.id) : null;
      // Yapay zekâ varsa iki arama: önce marka + model (aynı ürün), sonra ürün
      // türü (benzerleri). Yoksa tek arama: marka + adın ilk kelimeleri.
      const { exact, generic } = aiQuery ?? {};
      const asked = !aiQuery
        ? [ruleQuery(p)]
        : exact && generic && fold(exact) !== fold(generic) ? [exact, generic] : [exact || generic];
      const byUrl = new Map();
      const answered = new Map(); // site -> yanıt verdiği arama sayısı
      for (const [k, q] of asked.entries()) {
        if (sources.length === 0) break;
        if (k > 0) await sleep(delayMs);
        const found = await search(q, { sources });
        for (const f of found.failed) {
          log(`UYARI: ${f.code} aranamadı: ${f.message}`);
          // Engelleyen site bu koşuda bir daha denenmez.
          if (f.blocked) sources = sources.filter((c) => c !== f.code);
        }
        for (const code of found.searched) answered.set(code, (answered.get(code) ?? 0) + 1);
        for (const r of found.results) if (!byUrl.has(r.url)) byUrl.set(r.url, r);
      }
      // Bir site ancak bütün aramalara yanıt verdiyse "arandı" sayılır.
      const searched = [...answered].filter(([, count]) => count === asked.length).map(([code]) => code);
      const results = [...byUrl.values()];
      const query = asked.join(" | ");
      if (searched.length === 0) {
        tally.failed++;
        continue;
      }
      const ruleIdx = ruleMatches(p, results, toTry(p.price, p.currency, rates));
      let aiStatus = null;
      let kinds = null;
      if (aiQuery) {
        if (results.length === 0) {
          aiStatus = "not_found";
          kinds = [];
        } else {
          try {
            ({ status: aiStatus, kinds } = await ai.judge(p, results));
          } catch (err) {
            if (err instanceof QuotaError) aiOn = false;
            // Kural da bir şey bulamadıysa sonuç yazılmaz: eski kayıt boş sonuçla
            // ezilmez, ürün sonraki koşuda yeniden denenir.
            if (ruleIdx.length === 0) {
              log(`UYARI: yapay zekâ kararı alınamadı (${err.message}); ürün sonraki koşuya kaldı.`);
              tally.failed++;
              continue;
            }
            log(`UYARI: yapay zekâ kararı alınamadı (${err.message}); bu ürün kural katmanıyla işlendi.`);
          }
        }
      }
      const matches = kinds
        ? results.map((r, i) => ({ ...r, kind: kinds[i] })).filter((m) => m.kind !== "different")
        : ruleIdx.map((i) => ({ ...results[i], kind: "same" }));
      const status = await db.saveTrCheck(client, p.id, {
        query, sources: searched, ruleStatus: ruleIdx.length ? "found" : null, aiStatus, matches,
      });
      tally[status]++;
      log(`${p.marketplace} | ${p.title.slice(0, 50)} -> ${status} (${matches.length} ilan, arama: "${query}")`);
    } catch (err) {
      tally.failed++;
      console.error(`HATA [${p.title.slice(0, 40)}]: ${err.message}`);
    }
  }
  return tally;
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  await import("./env.js");
  const argv = process.argv.slice(2);
  const arg = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const marketplace = arg("marketplace") ?? null;
  const limit = arg("limit") === undefined ? TR_CHECK_LIMIT : Number(arg("limit"));
  if (marketplace && !MARKETPLACES[marketplace]) {
    console.error(`Bilinmeyen pazaryeri: ${marketplace}`);
    process.exit(1);
  }
  if (!Number.isInteger(limit) || limit < 1) {
    console.error("--limit pozitif tam sayı olmalı.");
    process.exit(1);
  }
  const dryRun = argv.includes("--dry-run");
  const db = await import("./db.js");
  const client = await db.getPool().connect();
  try {
    const ai = llmConfigured() ? createAi({ pause: () => sleep(LLM_MIN_INTERVAL_MS) }) : null;
    if (!ai && !dryRun) console.log("Yapay zekâ anahtarı yok: yalnız kural katmanı çalışacak (\"yok\" kararı verilmez).");
    const t = await runTrCheck({
      db, client, limit, dryRun, ai,
      codes: marketplace ? [marketplace] : ABROAD_MARKETPLACES,
    });
    console.log(dryRun
      ? `TOPLAM: ${t.candidates} ürüne bakılacak (çekim yapılmadı)`
      : `TOPLAM: ${t.candidates} aday | var ${t.found}, benzeri var ${t.similar}, bulunamadı ${t.not_found}, karar yok ${t.unknown}, aranamadı ${t.failed}`);
  } catch (err) {
    console.error("TR KONTROL HATASI:", err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await db.closePool();
  }
}
