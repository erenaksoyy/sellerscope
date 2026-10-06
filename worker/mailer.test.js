import test from "node:test";
import assert from "node:assert/strict";
import { sendEmail } from "./mailer.js";

test("sendEmail: Resend isteği doğru şekillenir", async () => {
  let seen;
  const fetchFn = async (url, opts) => {
    seen = { url, opts };
    return { ok: true, status: 200, json: async () => ({ id: "mail-1" }) };
  };
  const res = await sendEmail({
    token: "k", from: "Panel <p@x.c>", to: "a@b.c",
    subject: "S", text: "T", html: "<p>T</p>", fetchFn,
  });
  assert.deepEqual(res, { id: "mail-1" });
  assert.equal(seen.url, "https://api.resend.com/emails");
  assert.equal(seen.opts.method, "POST");
  assert.equal(seen.opts.headers.Authorization, "Bearer k");
  assert.deepEqual(JSON.parse(seen.opts.body), {
    from: "Panel <p@x.c>", to: ["a@b.c"], subject: "S", text: "T", html: "<p>T</p>",
  });
});

test("sendEmail: hata ve eksik ayar", async () => {
  const fail = async () => ({ ok: false, status: 401, text: async () => "bad key" });
  await assert.rejects(
    () => sendEmail({ token: "k", from: "f", to: "t", subject: "s", fetchFn: fail }),
    /HTTP 401/
  );
  let called = false;
  await assert.rejects(
    () => sendEmail({ from: "f", to: "t", subject: "s", fetchFn: async () => { called = true; } }),
    /RESEND_API_KEY/
  );
  assert.equal(called, false);
});
