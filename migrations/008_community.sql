-- Fase 5 · Comunidade, avaliação do curso, pedidos LGPD e configurações. Idempotente.

-- Fórum por aula: pergunta (parent_id nulo) e respostas de um nível.
CREATE TABLE IF NOT EXISTS forum_posts (
  id         BIGSERIAL PRIMARY KEY,
  course_id  BIGINT      NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  lesson_id  BIGINT      NOT NULL REFERENCES lessons(id) ON DELETE RESTRICT,
  user_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  parent_id  BIGINT      REFERENCES forum_posts(id) ON DELETE RESTRICT,
  by_admin   BOOLEAN     NOT NULL DEFAULT FALSE,
  body       TEXT        NOT NULL CHECK (char_length(body) BETWEEN 2 AND 2000),
  status     TEXT        NOT NULL DEFAULT 'visible' CHECK (status IN ('visible','hidden')),
  hidden_at  TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT forum_hidden_ck CHECK ((status = 'hidden') = (hidden_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS forum_lesson_idx ON forum_posts (lesson_id, created_at);
CREATE INDEX IF NOT EXISTS forum_parent_idx ON forum_posts (parent_id);
CREATE INDEX IF NOT EXISTS forum_course_idx ON forum_posts (course_id, created_at DESC);

-- Avaliação do curso: estrelas (1 a 5) e NPS (0 a 10). Uma por aluno e curso; o aluno pode editar.
CREATE TABLE IF NOT EXISTS course_reviews (
  id         BIGSERIAL PRIMARY KEY,
  course_id  BIGINT      NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  user_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  stars      INTEGER     NOT NULL CHECK (stars BETWEEN 1 AND 5),
  nps        INTEGER     NOT NULL CHECK (nps BETWEEN 0 AND 10),
  comment    TEXT        NOT NULL DEFAULT '' CHECK (char_length(comment) <= 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, course_id)
);
CREATE INDEX IF NOT EXISTS course_reviews_course_idx ON course_reviews (course_id);

-- Pedidos do titular (LGPD): prazo de 15 dias e resposta registrada.
ALTER TABLE data_requests ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ;
ALTER TABLE data_requests ADD COLUMN IF NOT EXISTS resolved_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE data_requests ADD COLUMN IF NOT EXISTS response TEXT NOT NULL DEFAULT '';
UPDATE data_requests SET due_at = created_at + interval '15 days' WHERE due_at IS NULL;
ALTER TABLE data_requests ALTER COLUMN due_at SET DEFAULT (now() + interval '15 days');

-- Um único pedido de cópia ou exclusão em aberto por pessoa (duplo clique não cria dois).
UPDATE data_requests d SET status = 'denied', resolved_at = now(), response = 'Pedido duplicado'
  WHERE d.status = 'open' AND d.type IN ('delete','export') AND d.id <> (SELECT min(x.id) FROM data_requests x WHERE x.user_id = d.user_id AND x.type = d.type AND x.status = 'open');
CREATE UNIQUE INDEX IF NOT EXISTS data_requests_open_uq ON data_requests (user_id, type) WHERE status = 'open' AND type IN ('delete','export');

-- Configurações da plataforma (chave e valor). O reset de lançamento (Fase 6) preserva esta tabela.
CREATE TABLE IF NOT EXISTS platform_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT        NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by BIGINT      REFERENCES users(id) ON DELETE SET NULL
);

-- Ações de LGPD (data_) e aceites (acceptance_) também ficam 5 anos no registro de atividades.
CREATE OR REPLACE FUNCTION evl_audit_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.at < now() - (CASE WHEN OLD.action ~ '^(order_|refund_|payment_|legal_|checkout_|data_|acceptance_)' THEN interval '5 years' ELSE interval '30 days' END) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'A tabela % é um registro imutável: não aceita % ', TG_TABLE_NAME, TG_OP USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql;
