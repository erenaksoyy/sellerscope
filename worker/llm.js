// Yapay zekâ sağlayıcıları (Google Gemini ve NVIDIA, ikisi de ücretsiz katman),
// yalnız fetch ile. Çağıranlar yalnız { system, prompt, schema, task } -> nesne
// sözleşmesini bilir; hangi modelin yanıt verdiği zincirden seçilir.
//   node worker/llm.js --check   -> anahtarları ve zincirdeki her modeli dener

import { fileURLToPath } from "node:url";
import { LLM_QUERY_MODELS, LLM_JUDGE_MODELS } from "./config.js";

// Kota doldu (HTTP 429, zincirin son modelinde): çağıran yapay zekâ katmanını
// koşunun kalanında kapatır.
export class QuotaError extends Error {}

// Geçici sunucu hatası ("model yoğun"): bu sürelerle beklenip yeniden denenir.
const RETRY_STATUSES = new Set([500, 503]);
const RETRY_WAITS_MS = [3000, 10000];
// Başarısız model, zincirde sırada model varsa bu süre atlanır.
const COOLDOWN_MS = 10 * 60 * 1000;
const coolingUntil = new Map();

// Gemini şema biçimi (büyük harfli türler) -> standart JSON Schema.
function toJsonSchema(s) {
  const out = { type: s.type.toLowerCase() };
  if (s.enum) out.enum = s.enum;
  if (s.properties) {
    out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, toJsonSchema(v)]));
    out.required = s.required ?? Object.keys(s.properties);
    out.additionalProperties = false;
  }
  if (s.items) out.items = toJsonSchema(s.items);
  return out;
}

const PROVIDERS = {
  gemini: {
    keyName: "GEMINI_API_KEY",
    timeoutMs: 60000,
    url: (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    headers: (key) => ({ "x-goog-api-key": key }),
    body: (model, { system, prompt, schema }) => ({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: schema },
    }),
    text: (data) => (data?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join(""),
  },
  // OpenAI uyumlu uç. Düşünen modeller yavaş: GLM 5.3 çağrısı 75 sn sürebiliyor.
  nvidia: {
    keyName: "NVIDIA_API_KEY",
    timeoutMs: 90000,
    url: () => "https://integrate.api.nvidia.com/v1/chat/completions",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
    body: (model, { system, prompt, schema }) => ({
      model, temperature: 0, max_tokens: 4096,
      messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
      response_format: { type: "json_schema", json_schema: { name: "result", strict: true, schema: toJsonSchema(schema) } },
    }),
    // Düşünme bölümü ve kod çiti atlanır, ilk "{" ile son "}" arası alınır.
    text: (data) => {
      const raw = String(data?.choices?.[0]?.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "");
      return raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
    },
  },
};

// "sağlayıcı:model"; öneksiz ad Gemini sayılır.
function parseSpec(spec) {
  const i = spec.indexOf(":");
  const provider = i > 0 ? spec.slice(0, i) : "gemini";
  if (!PROVIDERS[provider]) throw new Error(`bilinmeyen yapay zekâ sağlayıcısı: ${spec}`);
  return { provider, model: i > 0 ? spec.slice(i + 1) : spec };
}

const envKeys = () => Object.fromEntries(
  Object.entries(PROVIDERS).map(([name, p]) => [name, process.env[p.keyName]])
);

export function llmConfigured() {
  return Object.values(envKeys()).some(Boolean);
}

// task: "queries" (arama ifadeleri) | "judge" (ilan kararı). .env ile değişir.
export function llmModels(task) {
  const fromEnv = process.env[task === "judge" ? "LLM_JUDGE_MODELS" : "LLM_QUERY_MODELS"];
  const list = fromEnv ? fromEnv.split(",").map((s) => s.trim()) : task === "judge" ? LLM_JUDGE_MODELS : LLM_QUERY_MODELS;
  return [...new Set(list.filter(Boolean))];
}

// schema: Gemini responseSchema biçimi ({ type: "OBJECT", properties: ... });
// NVIDIA için standart JSON Schema'ya çevrilir.
export async function askJson({
  system, prompt, schema, task,
  models = llmModels(task),
  keys = envKeys(),
  fetchFn = fetch,
  retryWaitsMs = RETRY_WAITS_MS,
  log = console.warn,
}) {
  const usable = models.filter((spec) => keys[parseSpec(spec).provider]);
  if (usable.length === 0) {
    throw new Error("yapay zekâ anahtarı tanımlı değil (GEMINI_API_KEY ya da NVIDIA_API_KEY; .env.example'e bak).");
  }

  const ask = async (spec) => {
    const { provider, model } = parseSpec(spec);
    const p = PROVIDERS[provider];
    const payload = JSON.stringify(p.body(model, { system, prompt, schema }));
    let res;
    for (let attempt = 0; ; attempt++) {
      res = await fetchFn(p.url(model), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...p.headers(keys[provider]) },
        body: payload,
        signal: AbortSignal.timeout(p.timeoutMs),
      });
      if (!RETRY_STATUSES.has(res.status) || attempt >= retryWaitsMs.length) break;
      await new Promise((r) => setTimeout(r, retryWaitsMs[attempt]));
    }
    if (res.status === 429) throw new QuotaError("yapay zekâ kotası doldu (HTTP 429)");
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`yapay zekâ çağrısı başarısız: HTTP ${res.status} ${body.slice(0, 200)}`);
    }
    try {
      return JSON.parse(p.text(await res.json()));
    } catch {
      throw new Error("yapay zekâ yanıtı JSON değil");
    }
  };

  // Her türlü hatada (yoğunluk, zaman aşımı, kota, kapalı model, bozuk yanıt)
  // sıradaki modele geçilir; hepsi başarısızsa son hata fırlatılır.
  const ready = usable.filter((spec) => (coolingUntil.get(spec) ?? 0) <= Date.now());
  const order = ready.length ? ready : usable;
  let lastError;
  for (const [n, spec] of order.entries()) {
    try {
      return await ask(spec);
    } catch (err) {
      lastError = err;
      coolingUntil.set(spec, Date.now() + COOLDOWN_MS);
      const next = order[n + 1];
      if (next) log(`UYARI: yapay zekâ modeli ${spec} kullanılamıyor (${err.message.replace(/\s+/g, " ").slice(0, 100)}); ${next} deneniyor.`);
    }
  }
  throw lastError;
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain && process.argv.includes("--check")) {
  await import("./env.js");
  const keys = envKeys();
  for (const [name, p] of Object.entries(PROVIDERS)) {
    console.log(`${p.keyName}: ${keys[name] ? "tanımlı" : "YOK (bu sağlayıcının modelleri atlanır)"}`);
  }
  if (!llmConfigured()) process.exit(1);
  // Zincirlerdeki her model ayrı ayrı denenir (biri kapalıyken öbürü çalışabilir).
  const specs = [...new Set([...llmModels("queries"), ...llmModels("judge")])];
  let working = 0;
  for (const spec of specs) {
    if (!keys[parseSpec(spec).provider]) continue;
    const t0 = Date.now();
    try {
      const out = await askJson({
        system: "Translate the product name to Turkish.",
        prompt: "wireless earbuds",
        schema: { type: "OBJECT", properties: { text: { type: "STRING" } }, required: ["text"] },
        models: [spec],
        keys,
      });
      working++;
      console.log(`${spec}: çalışıyor (${Math.round((Date.now() - t0) / 1000)} sn) ${JSON.stringify(out)}`);
    } catch (err) {
      console.error(`${spec}: ÇALIŞMIYOR (${Math.round((Date.now() - t0) / 1000)} sn) ${err.message.replace(/\s+/g, " ").slice(0, 140)}`);
    }
  }
  console.log(`Arama ifadeleri: ${llmModels("queries").join(" > ")}`);
  console.log(`İlan kararları: ${llmModels("judge").join(" > ")}`);
  if (working === 0) process.exit(1);
}
