// E-posta gönderimi: Resend HTTP API (ek bağımlılık yok, global fetch).
const DEFAULT_API_BASE = "https://api.resend.com";

export async function sendEmail({
  token,
  from,
  to,
  subject,
  text,
  html,
  apiBase = DEFAULT_API_BASE,
  fetchFn = fetch,
}) {
  if (!token) throw new Error("RESEND_API_KEY tanımlı değil (.env.example'e bak).");
  if (!from) throw new Error("EMAIL_FROM tanımlı değil (.env.example'e bak).");
  if (!to) throw new Error("Alıcı (to) gerekli.");
  const res = await fetchFn(`${apiBase}/emails`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ from, to: [to], subject, text, html }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`E-posta gönderilemedi: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json();
}
