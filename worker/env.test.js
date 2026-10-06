import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseDotEnv, loadDotEnv } from "./env.js";

test("parse: KEY=VALUE satırları okunur", () => {
  assert.deepEqual(parseDotEnv("APIFY_TOKEN=abc123\nPORT=3000\n"), {
    APIFY_TOKEN: "abc123",
    PORT: "3000",
  });
});

test("parse: yorum, boş satır ve geçersiz satırlar atlanır", () => {
  assert.deepEqual(parseDotEnv("# yorum\n\nAPIFY_TOKEN=x\nSATIR\n=değersiz\n9HATALI=y\n"), {
    APIFY_TOKEN: "x",
  });
});

test("parse: tırnaklı değerler soyulur", () => {
  assert.deepEqual(parseDotEnv('A="merhaba dünya"\nB=\'tek\'\n'), {
    A: "merhaba dünya",
    B: "tek",
  });
});

test("load: olmayan dosya sessizce boş döner", () => {
  assert.deepEqual(loadDotEnv(new URL("file:///yok-boyle-bir-dosya.env")), {});
});

test("load: gerçek ortam değişkeni .env'i ezer", () => {
  const dir = mkdtempSync(join(tmpdir(), "trendpanel-env-"));
  try {
    const file = join(dir, ".env");
    writeFileSync(file, "TP_TEST_VAR=dotenv-degeri\n");
    process.env.TP_TEST_VAR = "gercek-deger";
    loadDotEnv(pathToFileURL(file));
    assert.equal(process.env.TP_TEST_VAR, "gercek-deger");
    delete process.env.TP_TEST_VAR;
    loadDotEnv(pathToFileURL(file));
    assert.equal(process.env.TP_TEST_VAR, "dotenv-degeri");
    delete process.env.TP_TEST_VAR;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
