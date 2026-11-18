-- 2.4.0 · Lembretes enviados pelo administrador (alunos que não começaram e afiliados parados) e descadastro.
-- Só tabelas novas: nada do que existe é alterado.
-- Quem pediu para não receber lembretes (vale por e-mail, em minúsculas). Não afeta e-mails de compra, acesso, certificado ou senha.
CREATE TABLE IF NOT EXISTS email_optouts (
  email      TEXT PRIMARY KEY CHECK (email = lower(email)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Um envio em lote. O token do formulário impede enviar duas vezes (duplo clique).
CREATE TABLE IF NOT EXISTS reminder_batches (
  token      TEXT PRIMARY KEY,
  kind       TEXT        NOT NULL CHECK (kind IN ('aluno','afiliado')),
  course_id  BIGINT      REFERENCES courses(id) ON DELETE SET NULL,
  grupo      TEXT        NOT NULL DEFAULT '',
  subject    TEXT        NOT NULL DEFAULT '',
  sent       INT         NOT NULL DEFAULT 0,
  skipped    INT         NOT NULL DEFAULT 0,
  sent_by    BIGINT      REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Uma linha por pessoa avisada: base da regra "no máximo 1 lembrete a cada 10 dias".
CREATE TABLE IF NOT EXISTS reminder_log (
  id           BIGSERIAL PRIMARY KEY,
  batch_token  TEXT        NOT NULL REFERENCES reminder_batches(token) ON DELETE CASCADE,
  kind         TEXT        NOT NULL,
  email        TEXT        NOT NULL,
  user_id      BIGINT      REFERENCES users(id) ON DELETE SET NULL,
  affiliate_id BIGINT      REFERENCES affiliates(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reminder_log_email_idx ON reminder_log (lower(email), created_at DESC);
