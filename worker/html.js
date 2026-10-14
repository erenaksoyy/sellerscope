// Doğrudan sayfa çekimi için ortak yardımcılar (Amazon listeleri, TR aramaları).
// Ek bağımlılık yok (global fetch). Testlerde fetchFn enjekte edilir.

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

// Site isteği bilerek reddetti (bot doğrulaması, 403/429). Yeniden denenmez,
// aşmaya çalışılmaz; çağıran o kaynağı koşunun kalanında bırakır.
export class BlockedError extends Error {}

const ENTITIES = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };

export function decodeEntities(text) {
  return String(text ?? "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
    if (code[0] !== "#") return ENTITIES[code.toLowerCase()] ?? whole;
    const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
  });
}

// Bot doğrulama / engel sayfaları (Akamai, Cloudflare, Amazon captcha).
export function isChallengePage(html) {
  return /bm-verify|\/_sec\/verify|cf-chl|Sorry, you have been blocked|api-services-support@amazon|Robot Check/i
    .test(String(html).slice(0, 20000));
}

export async function fetchHtml(url, { language = "tr-TR,tr;q=0.9", cookie, fetchFn = fetch, timeoutMs = 25000 } = {}) {
  const headers = { "User-Agent": BROWSER_UA, "Accept-Language": language, Accept: "text/html,*/*;q=0.8" };
  if (cookie) headers.Cookie = cookie;
  const res = await fetchFn(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  const html = await res.text();
  if ([403, 429, 503].includes(res.status) || isChallengePage(html)) {
    throw new BlockedError(`erişim engellendi (HTTP ${res.status})`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return html;
}
