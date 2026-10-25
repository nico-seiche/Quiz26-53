-- Freunde: jeder Nutzer hat eine eindeutige fünfstellige ID (angezeigt als #12345), Freundschaften brauchen Annahme.
ALTER TABLE quiz.users ADD COLUMN friend_code CHAR(5);

-- Bestehende Nutzer bekommen zufällige, eindeutige Codes
UPDATE quiz.users u SET friend_code = c.code
FROM (
  SELECT a.id, b.code
  FROM (SELECT id, row_number() OVER (ORDER BY random()) AS rn FROM quiz.users) a
  JOIN (SELECT n::text AS code, row_number() OVER (ORDER BY random()) AS rn FROM generate_series(10000, 99999) n) b USING (rn)
) c
WHERE u.id = c.id;

ALTER TABLE quiz.users ALTER COLUMN friend_code SET NOT NULL;
ALTER TABLE quiz.users ADD CONSTRAINT users_friend_code_format CHECK (friend_code ~ '^[1-9][0-9]{4}$');
CREATE UNIQUE INDEX users_friend_code_key ON quiz.users (friend_code);

CREATE TABLE quiz.friendships (
  requester_id BIGINT NOT NULL REFERENCES quiz.users(id) ON DELETE CASCADE,
  addressee_id BIGINT NOT NULL REFERENCES quiz.users(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (requester_id <> addressee_id)
);
-- Pro Paar höchstens eine Beziehung, egal wer angefragt hat
CREATE UNIQUE INDEX friendships_pair_key ON quiz.friendships (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id));
CREATE INDEX friendships_addressee_idx ON quiz.friendships (addressee_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON quiz.friendships TO quiz_app;
