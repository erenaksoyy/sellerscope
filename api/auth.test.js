import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, signToken, verifyToken } from "./auth.js";

test("şifre turu: doğru kabul, yanlış red", async () => {
  const hash = await hashPassword("gizli-sifre-1");
  assert.equal(await verifyPassword("gizli-sifre-1", hash), true);
  assert.equal(await verifyPassword("yanlis", hash), false);
});

test("bozuk hash güvenli şekilde false döner", async () => {
  assert.equal(await verifyPassword("x", "bozuk"), false);
  assert.equal(await verifyPassword("x", null), false);
});

test("JWT turu: imzala/doğrula", () => {
  const t = signToken("s3cret", { sub: "u1", email: "a@b.c" });
  const p = verifyToken(t, "s3cret");
  assert.equal(p.sub, "u1");
  assert.equal(p.email, "a@b.c");
});

test("JWT: kurcalanmış veya süresi dolmuş red", () => {
  const t = signToken("s3cret", { sub: "u1" });
  const tampered = t.slice(0, -2) + "xx";
  assert.equal(verifyToken(tampered, "s3cret"), null);
  assert.equal(verifyToken(t, "baska"), null);
  const expired = signToken("s3cret", { sub: "u1" }, -10);
  assert.equal(verifyToken(expired, "s3cret"), null);
  assert.equal(verifyToken("bozuk", "s3cret"), null);
});
