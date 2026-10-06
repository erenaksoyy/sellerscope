-- 001: haftalık özet e-postası için kullanıcı tercihi + gönderim kaydı.
-- Mevcut kurulumlar: psql trendpanel -f db/migrations/001_digest.sql
-- (Sıfır kurulumda db/schema.sql zaten bunları içerir.)

ALTER TABLE users ADD COLUMN IF NOT EXISTS digest_enabled BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS email_log (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week       DATE NOT NULL,                     -- date_trunc('week', CURRENT_DATE)
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  item_count INT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, week)
);
