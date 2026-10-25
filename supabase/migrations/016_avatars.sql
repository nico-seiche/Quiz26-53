-- Profilbilder: ein kleines JPEG (der Browser verkleinert auf 256 × 256 px) je Nutzer, getrennt von users
CREATE TABLE quiz.user_avatars (
  user_id    BIGINT PRIMARY KEY REFERENCES quiz.users(id) ON DELETE CASCADE,
  image      BYTEA NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON quiz.user_avatars TO quiz_app;
