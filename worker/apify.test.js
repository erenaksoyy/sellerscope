import test from "node:test";
import assert from "node:assert/strict";
import { runActorAndGetItems } from "./apify.js";

// Sıralı sahte fetch: beklenen istekleri sırayla cevaplar (ağ yok).
function stubFetch(script) {
  let i = 0;
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    const step = script[i++];
    assert.ok(step, `beklenmeyen istek #${i}: ${url}`);
    assert.ok(url.includes(step.match), `istek ${i} '${step.match}' içermeli: ${url}`);
    return {
      ok: step.status === undefined || step.status < 400,
      status: step.status ?? 200,
      json: async () => step.json,
      text: async () => JSON.stringify(step.json ?? {}),
    };
  };
  return { fn, calls };
}

test("run -> poll -> dataset okuma", async () => {
  const { fn, calls } = stubFetch([
    { match: "/v2/acts/apify~x/runs", json: { data: { id: "run1", status: "RUNNING" } } },
    { match: "/v2/actor-runs/run1", json: { data: { status: "RUNNING" } } },
    { match: "/v2/actor-runs/run1", json: { data: { status: "SUCCEEDED", defaultDatasetId: "ds1" } } },
    { match: "/v2/datasets/ds1/items", json: [{ a: 1 }, { a: 2 }, { a: 3 }] },
  ]);
  const items = await runActorAndGetItems({
    actorId: "apify/x",
    input: { listingUrls: [{ url: "https://x" }], maxProductResults: 3 },
    token: "t",
    maxItems: 3,
    pollIntervalMs: 1,
    fetchFn: fn,
  });
  assert.deepEqual(items, [{ a: 1 }, { a: 2 }, { a: 3 }]);
  assert.equal(calls[0].opts.method, "POST");
  assert.equal(calls[0].opts.headers.Authorization, "Bearer t");
  assert.equal(calls.length, 4);
});

test("FAILED run hata fırlatır", async () => {
  const { fn } = stubFetch([
    { match: "/runs", json: { data: { id: "run9" } } },
    { match: "/actor-runs/run9", json: { data: { status: "FAILED" } } },
  ]);
  await assert.rejects(
    () => runActorAndGetItems({ actorId: "a/b", input: {}, token: "t", pollIntervalMs: 1, fetchFn: fn }),
    /FAILED/
  );
});

test("token yoksa ağa çıkmadan hata verir", async () => {
  let called = false;
  await assert.rejects(
    () => runActorAndGetItems({ actorId: "a/b", input: {}, fetchFn: async () => { called = true; } }),
    /APIFY_TOKEN/
  );
  assert.equal(called, false);
});

test("HTTP 500 açık hataya dönüşür", async () => {
  const { fn } = stubFetch([{ match: "/runs", status: 500, json: { error: "boom" } }]);
  await assert.rejects(
    () => runActorAndGetItems({ actorId: "a/b", input: {}, token: "t", fetchFn: fn }),
    /HTTP 500/
  );
});
