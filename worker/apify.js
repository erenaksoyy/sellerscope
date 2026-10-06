// Minimal Apify API istemcisi: aktör çalıştır -> bitmesini bekle -> dataset'i oku.
// Ek bağımlılık yok (global fetch). Testlerde fetchFn enjekte edilir.

const DEFAULT_API_BASE = "https://api.apify.com";
const TERMINAL = new Set(["SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED"]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function checkedJson(res, what) {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Apify ${what} başarısız: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json();
}

export async function runActorAndGetItems({
  actorId,
  input,
  token,
  apiBase = DEFAULT_API_BASE,
  maxItems = 50,
  pollIntervalMs = 5000,
  timeoutMs = 20 * 60 * 1000,
  fetchFn = fetch,
}) {
  if (!token) throw new Error("APIFY_TOKEN tanımlı değil (.env.example'e bak).");
  if (!actorId) throw new Error("actorId gerekli.");
  // Apify API, kullanıcı/aktör ayracı olarak URL yolunda "~" bekler ("a/b" -> "a~b").
  const actorPath = actorId.replace("/", "~");

  const started = await checkedJson(
    await fetchFn(`${apiBase}/v2/acts/${actorPath}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(input ?? {}),
    }),
    "run başlatma"
  );
  const runId = started?.data?.id;
  if (!runId) throw new Error(`Apify run başlatılamadı (${actorId}).`);

  const t0 = Date.now();
  for (;;) {
    const st = await checkedJson(
      await fetchFn(`${apiBase}/v2/actor-runs/${runId}`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      "run durumu"
    );
    const status = st?.data?.status;
    if (status === "SUCCEEDED") {
      const datasetId = st.data.defaultDatasetId;
      if (!datasetId) throw new Error(`Apify run sonuçsuz bitti: ${runId}`);
      return readDatasetItems({ fetchFn, apiBase, token, datasetId, maxItems });
    }
    if (TERMINAL.has(status)) {
      throw new Error(`Apify run ${status}: ${runId}`);
    }
    if (Date.now() - t0 > timeoutMs) {
      throw new Error(`Apify run zaman aşımı (${Math.round(timeoutMs / 1000)} sn): ${runId}`);
    }
    await sleep(pollIntervalMs);
  }
}

async function readDatasetItems({ fetchFn, apiBase, token, datasetId, maxItems }) {
  const items = [];
  let offset = 0;
  for (;;) {
    const pageSize = Math.min(1000, maxItems - items.length);
    const page = await checkedJson(
      await fetchFn(
        `${apiBase}/v2/datasets/${datasetId}/items?format=json&offset=${offset}&limit=${pageSize}`,
        { headers: { Authorization: `Bearer ${token}` } }
      ),
      "dataset okuma"
    );
    if (!Array.isArray(page) || page.length === 0) break;
    items.push(...page);
    if (page.length < pageSize || items.length >= maxItems) break;
    offset += page.length;
  }
  return items.slice(0, maxItems);
}
