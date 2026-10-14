import test from "node:test";
import assert from "node:assert/strict";
import { parseTcmb, fetchRates, toTry, FX_CURRENCIES } from "./fx.js";

// TCMB today.xml biçimi (9 Ekim 2026), kısaltılmış.
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<Tarih_Date Tarih="09.10.2026" Date="10/09/2026" Bulten_No="2026/191" >
  <Currency CrossOrder="0" Kod="USD" CurrencyCode="USD">
    <Unit>1</Unit><Isim>ABD DOLARI</Isim>
    <ForexBuying>49.1274</ForexBuying><ForexSelling>49.2160</ForexSelling>
  </Currency>
  <Currency CrossOrder="9" Kod="EUR" CurrencyCode="EUR">
    <Unit>1</Unit><ForexBuying>55.1100</ForexBuying><ForexSelling>55.2105</ForexSelling>
  </Currency>
  <Currency CrossOrder="5" Kod="JPY" CurrencyCode="JPY">
    <Unit>100</Unit><ForexBuying>30.9677</ForexBuying><ForexSelling>31.1727</ForexSelling>
  </Currency>
</Tarih_Date>`;

test("parseTcmb: bülten tarihi + döviz satış kuru, birime bölünür", () => {
  assert.deepEqual(parseTcmb(XML, ["USD", "EUR", "JPY", "GBP"]), {
    date: "2026-10-09",
    rates: { USD: 49.216, EUR: 55.2105, JPY: 0.311727 }, // GBP dosyada yok: atlanır
  });
  assert.throws(() => parseTcmb("<html>bakım</html>"), /tanınmadı/);
});

test("fetchRates: pazaryerlerindeki para birimlerini ister; HTTP hatası fırlatır", async () => {
  assert.deepEqual(FX_CURRENCIES, ["USD", "EUR"]);
  const got = await fetchRates({ fetchFn: async () => new Response(XML) });
  assert.deepEqual(got.rates, { USD: 49.216, EUR: 55.2105 });
  await assert.rejects(fetchRates({ fetchFn: async () => new Response("", { status: 500 }) }), /HTTP 500/);
});

test("toTry: TL aynen, kur yoksa null", () => {
  const rates = { USD: 49.216 };
  assert.equal(toTry(8.83, "USD", rates), 434.58);
  assert.equal(toTry(100, "TRY", rates), 100);
  assert.equal(toTry(10, "EUR", rates), null);
  assert.equal(toTry(null, "USD", rates), null);
});
