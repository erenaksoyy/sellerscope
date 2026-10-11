import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const SERVER = fileURLToPath(new URL("./server.js", import.meta.url));

// Regresyon: proje yolunda boşluk varken giriş noktası kontrolü tutmuyor,
// "node api/server.js" hiçbir şey dinlemeden sessizce çıkıyordu.
test("node api/server.js sunucuyu başlatır ve istek yanıtlar", async () => {
  const child = spawn(process.execPath, [SERVER], {
    // DB'ye gidilmez: bilinmeyen yol 404'ü sorgu çalışmadan döner.
    env: { ...process.env, PORT: "0", JWT_SECRET: "test-secret", DATABASE_URL: "postgres://x:y@127.0.0.1:1/yok" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const base = await new Promise((resolve, reject) => {
      let out = "";
      const timer = setTimeout(() => reject(new Error(`sunucu 5 sn içinde açılmadı: ${out}`)), 5000);
      const onData = (chunk) => {
        out += chunk;
        const m = out.match(/API dinliyor: (http:\/\/localhost:\d+)/);
        if (m) {
          clearTimeout(timer);
          resolve(m[1]);
        }
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      child.on("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`sunucu dinlemeden çıktı (kod ${code}): ${out}`));
      });
    });
    const res = await fetch(`${base}/api/yok`);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: "Bulunamadı." });
  } finally {
    child.kill();
  }
});
