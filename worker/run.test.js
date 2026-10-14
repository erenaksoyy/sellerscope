import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

test("--abroad dry-run yalnız yurt dışı hedefleri çeker", async () => {
  const { stdout } = await run("node", ["worker/run.js", "--dry-run", "--abroad"], { timeout: 30000 });
  assert.match(stdout, /amazon_us \/ home-kitchen/);
  assert.match(stdout, /amazon_de \/ ev-mutfak/);
  assert.match(stdout, /aliexpress_global \/ home-garden/);
  assert.doesNotMatch(stdout, /amazon_tr/);
  assert.doesNotMatch(stdout, /trendyol_tr/);
});

test("--abroad ile TR pazaryeri birlikte seçilemez", async () => {
  await assert.rejects(
    run("node", ["worker/run.js", "--dry-run", "--abroad", "--marketplace=amazon_tr"], { timeout: 30000 }),
    /yalnız yurt dışı/
  );
});

test("--free dry-run yalnız ücretsiz çekilen pazaryerlerini hedefler", async () => {
  const { stdout } = await run("node", ["worker/run.js", "--dry-run", "--free"], { timeout: 30000 });
  assert.match(stdout, /amazon_us \/ toys-games/);
  assert.match(stdout, /amazon_de \/ oyuncak/);
  assert.doesNotMatch(stdout, /aliexpress_global|amazon_tr|trendyol_tr/);
  await assert.rejects(
    run("node", ["worker/run.js", "--dry-run", "--free", "--marketplace=aliexpress_global"], { timeout: 30000 }),
    /yalnız ücretsiz/
  );
});
