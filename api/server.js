// HTTP adaptörü: node:http -> saf handler. DB havuzu worker ile paylaşılır.
import http from "node:http";
import "../worker/env.js";
import { createHandler } from "./handler.js";

// pg yalnızca canlı DB modunda yüklenir (test/smoke stub ile çalışır).
let poolPromise = null;
function liveQuery(text, params) {
  poolPromise ??= import("../worker/db.js").then((m) => m.getPool());
  return poolPromise.then((pool) => pool.query(text, params));
}

const PORT = Number(process.env.PORT || 3000);
const MAX_BODY = 1024 * 1024; // 1 MB

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error("Gövde çok büyük."), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

export function startServer({ port = PORT, query, jwtSecret } = {}) {
  const q = query || liveQuery;
  const handle = createHandler({ query: q, jwtSecret: jwtSecret ?? process.env.JWT_SECRET });
  const server = http.createServer(async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    try {
      let body;
      const raw = await readBody(req);
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch {
          return send(400, { error: "Geçersiz JSON." });
        }
      }
      const result = await handle({ method: req.method, path: req.url, headers: req.headers, body });
      send(result.status, result.body);
    } catch (err) {
      if (err.status) return send(err.status, { error: err.message });
      console.error("API HATASI:", err);
      send(500, { error: "Sunucu hatası." });
    }
  });
  return new Promise((resolve) => {
    server.listen(port, () => resolve(server));
  });
}

const isMain = process.argv[1] === new URL(import.meta.url).pathname;
if (isMain) {
  if (!process.env.JWT_SECRET) {
    console.error("JWT_SECRET tanımlı değil (.env.example'e bak).");
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL tanımlı değil (.env.example'e bak).");
    process.exit(1);
  }
  const server = await startServer({});
  console.log(`API dinliyor: http://localhost:${server.address().port}`);
}
