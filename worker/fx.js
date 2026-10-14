// Günlük kur: TCMB'nin herkese açık XML'i (anahtarsız, ücretsiz).
// Yurt dışı fiyatlarını TL'ye çevirmek için fx_rates tablosuna yazılır.

import { MARKETPLACES } from "./config.js";

const TCMB_URL = "https://www.tcmb.gov.tr/kurlar/today.xml";

// Pazaryerlerinde geçen, TRY dışındaki para birimleri.
export const FX_CURRENCIES = [...new Set(Object.values(MARKETPLACES).map((m) => m.currency))]
  .filter((c) => c !== "TRY");

// XML -> { date: "2026-10-09", rates: { USD: 49.216, EUR: ... } }.
// Kur = döviz satış / birim (JPY gibi 100'lük kotasyonlar için).
export function parseTcmb(xml, currencies = FX_CURRENCIES) {
  const d = String(xml).match(/<Tarih_Date[^>]*\bTarih="(\d{2})\.(\d{2})\.(\d{4})"/);
  if (!d) throw new Error("TCMB kur dosyası tanınmadı (tarih yok).");
  const rates = {};
  for (const code of currencies) {
    const block = String(xml).match(new RegExp(`<Currency[^>]*CurrencyCode="${code}"[^>]*>([\\s\\S]*?)</Currency>`));
    if (!block) continue;
    const unit = Number(block[1].match(/<Unit>\s*(\d+)\s*<\/Unit>/)?.[1]);
    const selling = Number(block[1].match(/<ForexSelling>\s*([\d.]+)\s*<\/ForexSelling>/)?.[1]);
    if (unit > 0 && selling > 0) rates[code] = Math.round((selling / unit) * 1e6) / 1e6;
  }
  return { date: `${d[3]}-${d[2]}-${d[1]}`, rates };
}

export async function fetchRates({ currencies = FX_CURRENCIES, fetchFn = fetch } = {}) {
  const res = await fetchFn(TCMB_URL, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`TCMB kur dosyası alınamadı: HTTP ${res.status}`);
  return parseTcmb(await res.text(), currencies);
}

// 12.5 USD -> TL. TRY aynen döner; kur bilinmiyorsa null.
export function toTry(price, currency, rates) {
  if (price === null || price === undefined) return null;
  if (currency === "TRY") return price;
  const rate = rates?.[currency];
  return rate ? Math.round(price * rate * 100) / 100 : null;
}
