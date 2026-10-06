// Bağımlılıksız .env yükleyici: proje kökündeki .env dosyasını okuyup
// eksik ortam değişkenlerini doldurur. Dosya içe aktarılınca otomatik çalışır,
// o yüzden giriş noktaları bunu İLK satırda import eder.
// Kurallar: gerçek ortam değişkeni kazanır (.env yalnızca yedek),
// dosya yoksa sessizce geçilir.
import { readFileSync } from "node:fs";

export function parseDotEnv(text) {
  const out = {};
  for (const rawLine of String(text).split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      val.length >= 2 &&
      ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
    ) {
      val = val.slice(1, -1);
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) out[key] = val;
  }
  return out;
}

export function loadDotEnv(dotEnvUrl = new URL("../.env", import.meta.url)) {
  let text;
  try {
    text = readFileSync(dotEnvUrl, "utf8");
  } catch {
    return {}; // .env yoksa sorun değil (ortam değişkenleri kullanılır)
  }
  const vars = parseDotEnv(text);
  for (const [key, val] of Object.entries(vars)) {
    if (process.env[key] === undefined) process.env[key] = val;
  }
  return vars;
}

loadDotEnv();
