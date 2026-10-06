// Kimlik doğrulama: scrypt şifre hash + HS256 JWT. Bağımlılık yok (node:crypto).
import { scrypt, randomBytes, timingSafeEqual, createHmac } from "node:crypto";

export function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = randomBytes(16);
    scrypt(String(password), salt, 64, (err, key) => {
      if (err) return reject(err);
      resolve(`${salt.toString("hex")}:${key.toString("hex")}`);
    });
  });
}

export function verifyPassword(password, stored) {
  return new Promise((resolve) => {
    const [saltHex, hashHex] = String(stored || "").split(":");
    if (!saltHex || !hashHex) return resolve(false);
    let salt;
    try {
      salt = Buffer.from(saltHex, "hex");
    } catch {
      return resolve(false);
    }
    scrypt(String(password), salt, 64, (err, key) => {
      if (err) return resolve(false);
      const expected = Buffer.from(hashHex, "hex");
      resolve(key.length === expected.length && timingSafeEqual(key, expected));
    });
  });
}

const WEEK_SECS = 7 * 24 * 3600;

export function signToken(secret, { sub, email }, ttlSecs = WEEK_SECS) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub, email, iat: now, exp: now + ttlSecs })).toString("base64url");
  const sig = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

export function verifyToken(token, secret) {
  const [h, p, s] = String(token || "").split(".");
  if (!h || !p || !s) return null;
  const expected = createHmac("sha256", secret).update(`${h}.${p}`).digest();
  let got;
  try {
    got = Buffer.from(s, "base64url");
  } catch {
    return null;
  }
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(p, "base64url").toString());
  } catch {
    return null;
  }
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}
