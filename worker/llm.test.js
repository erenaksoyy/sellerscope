import test from "node:test";
import assert from "node:assert/strict";
import { askJson, QuotaError } from "./llm.js";

const reply = (text, status = 200) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status });
const nvidiaReply = (content, status = 200) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status });
const gemini = { gemini: "k" };

test("askJson: Gemini istek biçimi (anahtar başlıkta, şema ile JSON yanıt) ve yanıtın çözülmesi", async () => {
  const calls = [];
  const fetchFn = async (url, opts) => {
    calls.push({ url, opts });
    return reply('{"text":"kablosuz kulaklık"}');
  };
  const schema = { type: "OBJECT", properties: { text: { type: "STRING" } } };
  const out = await askJson({ system: "S", prompt: "P", schema, keys: { gemini: "k-1" }, models: ["gemini:m-1"], fetchFn });
  assert.deepEqual(out, { text: "kablosuz kulaklık" });
  assert.equal(calls[0].url, "https://generativelanguage.googleapis.com/v1beta/models/m-1:generateContent");
  assert.equal(calls[0].opts.headers["x-goog-api-key"], "k-1");
  assert.ok(!calls[0].url.includes("k-1")); // anahtar adrese yazılmaz (loglara düşmesin)
  assert.deepEqual(JSON.parse(calls[0].opts.body), {
    systemInstruction: { parts: [{ text: "S" }] },
    contents: [{ role: "user", parts: [{ text: "P" }] }],
    generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: schema },
  });
});

test("askJson: NVIDIA istek biçimi (OpenAI uyumlu, JSON Schema'ya çevrilmiş şema), düşünme bölümü atlanır", async () => {
  const calls = [];
  const fetchFn = async (url, opts) => {
    calls.push({ url, opts });
    return nvidiaReply('<think>önce düşüneyim {"x":1}</think>\n```json\n{"verdicts":[{"i":0,"kind":"same"}]}\n```');
  };
  const schema = {
    type: "OBJECT",
    properties: {
      verdicts: {
        type: "ARRAY",
        items: { type: "OBJECT", properties: { i: { type: "INTEGER" }, kind: { type: "STRING", enum: ["same", "similar"] } }, required: ["i", "kind"] },
      },
    },
    required: ["verdicts"],
  };
  const out = await askJson({ system: "S", prompt: "P", schema, keys: { nvidia: "nv-1" }, models: ["nvidia:org/model-1"], fetchFn });
  assert.deepEqual(out, { verdicts: [{ i: 0, kind: "same" }] });
  assert.equal(calls[0].url, "https://integrate.api.nvidia.com/v1/chat/completions");
  assert.equal(calls[0].opts.headers.Authorization, "Bearer nv-1");
  const body = JSON.parse(calls[0].opts.body);
  assert.equal(body.model, "org/model-1");
  assert.deepEqual(body.messages, [{ role: "system", content: "S" }, { role: "user", content: "P" }]);
  assert.deepEqual(body.response_format.json_schema.schema, {
    type: "object",
    properties: {
      verdicts: {
        type: "array",
        items: {
          type: "object",
          properties: { i: { type: "integer" }, kind: { type: "string", enum: ["same", "similar"] } },
          required: ["i", "kind"], additionalProperties: false,
        },
      },
    },
    required: ["verdicts"], additionalProperties: false,
  });
});

test("askJson: kota (429) ayrı hata türü; diğer hatalar, bozuk yanıt, anahtar yok", async () => {
  const base = { system: "S", prompt: "P", schema: {}, keys: gemini, models: ["m"], retryWaitsMs: [], log: () => {} };
  await assert.rejects(askJson({ ...base, fetchFn: async () => reply("", 429) }), QuotaError);
  await assert.rejects(askJson({ ...base, fetchFn: async () => reply("", 500) }), /HTTP 500/);
  await assert.rejects(askJson({ ...base, fetchFn: async () => reply("JSON değil") }), /JSON değil/);
  await assert.rejects(askJson({ ...base, keys: {}, fetchFn: async () => reply("{}") }), /GEMINI_API_KEY ya da NVIDIA_API_KEY/);
});

test("askJson: geçici sunucu hatasında yeniden dener; düzelmezse sıradaki modele geçer", async () => {
  const base = { system: "S", prompt: "P", schema: {}, keys: gemini, retryWaitsMs: [0, 0] };
  const modelOf = (url) => url.match(/models\/([^:]+):/)[1];

  // 503, 503, sonra yanıt: aynı model üç kez denenir.
  let calls = [];
  let fetchFn = async (url) => {
    calls.push(modelOf(url));
    return calls.length < 3 ? reply("", 503) : reply('{"ok":1}');
  };
  assert.deepEqual(await askJson({ ...base, models: ["tek"], fetchFn }), { ok: 1 });
  assert.deepEqual(calls, ["tek", "tek", "tek"]);

  // Asıl model hep 503: yedek yanıt verir; sonraki çağrı asıl modeli bir süre atlar.
  calls = [];
  const warnings = [];
  fetchFn = async (url) => {
    calls.push(modelOf(url));
    return modelOf(url) === "asil" ? reply("", 503) : reply('{"ok":2}');
  };
  const two = { ...base, models: ["asil", "yedek"], fetchFn, log: (l) => warnings.push(l) };
  assert.deepEqual(await askJson(two), { ok: 2 });
  assert.deepEqual(calls, ["asil", "asil", "asil", "yedek"]);
  assert.match(warnings[0], /asil kullanılamıyor \(.*HTTP 503.*\); yedek deneniyor/);
  assert.deepEqual(await askJson(two), { ok: 2 });
  assert.deepEqual(calls.slice(4), ["yedek"]);
  assert.equal(warnings.length, 1);

  // Zaman aşımı (fetch hata fırlatır): yeniden denemeden sıradakine geçilir; yoksa hata.
  calls = [];
  fetchFn = async (url) => {
    calls.push(modelOf(url));
    if (modelOf(url) === "yavas") throw new Error("The operation was aborted due to timeout");
    return reply('{"ok":4}');
  };
  assert.deepEqual(await askJson({ ...base, models: ["yavas", "hizli"], fetchFn, log: () => {} }), { ok: 4 });
  assert.deepEqual(calls, ["yavas", "hizli"]);
  await assert.rejects(askJson({ ...base, models: ["yavas"], fetchFn }), /timeout/);

  // Kotası dolan ya da kapalı (404) modelden sıradakine geçilir; hepsi doluysa kota hatası.
  calls = [];
  fetchFn = async (url) => {
    calls.push(modelOf(url));
    return { dolu: reply("", 429), kapali: reply("", 404) }[modelOf(url)] ?? reply('{"ok":3}');
  };
  assert.deepEqual(await askJson({ ...base, models: ["dolu", "kapali", "bos"], fetchFn, log: () => {} }), { ok: 3 });
  assert.deepEqual(calls, ["dolu", "kapali", "bos"]);
  await assert.rejects(
    askJson({ ...base, models: ["dolu-1", "dolu-2"], fetchFn: async () => reply("", 429), log: () => {} }),
    QuotaError
  );
});

test("askJson: anahtarı olmayan sağlayıcının modelleri atlanır (NVIDIA yoksa doğrudan Gemini)", async () => {
  const urls = [];
  const fetchFn = async (url) => {
    urls.push(url);
    return reply('{"ok":5}');
  };
  const out = await askJson({
    system: "S", prompt: "P", schema: {}, keys: gemini, fetchFn, log: () => {},
    models: ["nvidia:org/a", "gemini:g-1"],
  });
  assert.deepEqual(out, { ok: 5 });
  assert.deepEqual(urls, ["https://generativelanguage.googleapis.com/v1beta/models/g-1:generateContent"]);
});
