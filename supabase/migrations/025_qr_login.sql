-- Anmelden per QR-Code: Das neue Gerät zeigt einen QR-Code (code), ein bereits angemeldetes Gerät bestätigt ihn.
-- Das neue Gerät holt die Anmeldung mit seinem geheimen Wert ab (secret_hash), den nur es kennt.
CREATE TABLE quiz.qr_logins (
  code             TEXT PRIMARY KEY,
  secret_hash      TEXT NOT NULL,
  device           TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ NOT NULL,
  approved_user_id BIGINT REFERENCES quiz.users(id) ON DELETE CASCADE
);
CREATE INDEX qr_logins_expires_idx ON quiz.qr_logins (expires_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON quiz.qr_logins TO quiz_app;
