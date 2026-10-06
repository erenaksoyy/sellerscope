// Haftalık özet CLI:
//   node worker/send-digest.js --dry-run [--email=kullanici@x.c]  -> göndermeden yazdırır
//   node worker/send-digest.js                                     -> Resend ile gönderir
import "./env.js";
import { runDigest } from "./digest.js";
import { sendEmail } from "./mailer.js";

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const onlyArg = argv.find((a) => a.startsWith("--email="));
const onlyEmail = onlyArg ? onlyArg.split("=")[1] : null;

try {
  const { getPool } = await import("./db.js");
  const pool = getPool();
  const query = (text, params) => pool.query(text, params);

  const send = dryRun
    ? async ({ to, subject, text }) => {
        console.log(`--- ${to} ---\nKonu: ${subject}\n${text}\n`);
      }
    : async ({ to, subject, text, html }) =>
        sendEmail({
          token: process.env.RESEND_API_KEY,
          from: process.env.EMAIL_FROM,
          to,
          subject,
          text,
          html,
        });

  // --email filtresi: dry-run'da tek kullanıcıyı test etmek için.
  const filteredQuery = onlyEmail
    ? async (text, params) => {
        const res = await query(text, params);
        if (text.includes("FROM category_follows f")) {
          res.rows = res.rows.filter((r) => r.email === onlyEmail);
        }
        return res;
      }
    : query;

  await runDigest({ query: filteredQuery, send });
  await pool.end();
} catch (err) {
  console.error("DIGEST HATASI:", err.message);
  process.exit(1);
}
