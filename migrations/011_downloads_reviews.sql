-- 0.8.0 · Limite de downloads por aluno (produtos digitais) e depoimentos publicáveis.

-- Quantas vezes cada aluno baixou cada arquivo de produto, e quantos downloads extras o administrador liberou.
CREATE TABLE IF NOT EXISTS file_quota (
  user_id BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_id BIGINT      NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  used    INTEGER     NOT NULL DEFAULT 0 CHECK (used >= 0),
  extra   INTEGER     NOT NULL DEFAULT 0 CHECK (extra >= 0),
  last_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, file_id)
);

-- Pedidos de novo download (com motivo). Decide o administrador.
CREATE TABLE IF NOT EXISTS download_requests (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_id    BIGINT      NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  course_id  BIGINT      NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  reason     TEXT        NOT NULL CHECK (char_length(reason) BETWEEN 10 AND 500),
  status     TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
  response   TEXT        NOT NULL DEFAULT '' CHECK (char_length(response) <= 300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ,
  decided_by BIGINT      REFERENCES users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS download_requests_open_uq ON download_requests (user_id, file_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS download_requests_status_idx ON download_requests (status, created_at);

-- Depoimento: só vai a público com o aceite do aluno e a publicação do administrador.
ALTER TABLE course_reviews ADD COLUMN IF NOT EXISTS consent_publish BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE course_reviews ADD COLUMN IF NOT EXISTS published       BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE course_reviews ADD COLUMN IF NOT EXISTS published_at    TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS course_reviews_pub_idx ON course_reviews (course_id) WHERE published;
