-- Fase 1 · Base e contas. Idempotente: pode rodar mais de uma vez sem dano.

CREATE TABLE IF NOT EXISTS users (
  id                   BIGSERIAL PRIMARY KEY,
  email                TEXT        NOT NULL,
  password_hash        TEXT        NOT NULL,
  role                 TEXT        NOT NULL DEFAULT 'student' CHECK (role IN ('admin','student')),
  name                 TEXT        NOT NULL,
  phone                TEXT,
  cpf                  TEXT,
  birth_date           DATE,
  cep                  TEXT,
  street               TEXT,
  street_number        TEXT,
  complement           TEXT,
  district             TEXT,
  city                 TEXT,
  state                TEXT,
  status               TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active','blocked')),
  must_change_password BOOLEAN     NOT NULL DEFAULT FALSE,
  failed_logins        INTEGER     NOT NULL DEFAULT 0,
  locked_until         TIMESTAMPTZ,
  last_login_at        TIMESTAMPTZ,
  mascot_enabled       BOOLEAN     NOT NULL DEFAULT TRUE,
  help_tips_enabled    BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uq ON users (lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS users_cpf_uq ON users (cpf) WHERE cpf IS NOT NULL;

CREATE TABLE IF NOT EXISTS sessions (
  id_hash      TEXT PRIMARY KEY,
  user_id      BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  ip           TEXT,
  user_agent   TEXT
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS password_resets (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT        NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip         TEXT
);
CREATE INDEX IF NOT EXISTS password_resets_user_idx ON password_resets (user_id);

CREATE TABLE IF NOT EXISTS email_changes (
  id                 BIGSERIAL PRIMARY KEY,
  user_id            BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  new_email          TEXT        NOT NULL,
  code_current_hash  TEXT        NOT NULL,
  code_new_hash      TEXT        NOT NULL,
  attempts           INTEGER     NOT NULL DEFAULT 0,
  status             TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','cancelled','expired')),
  expires_at         TIMESTAMPTZ NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_changes_user_idx ON email_changes (user_id, status);

CREATE TABLE IF NOT EXISTS legal_documents (
  id           BIGSERIAL PRIMARY KEY,
  doc_type     TEXT        NOT NULL CHECK (doc_type IN ('terms','privacy')),
  version      TEXT        NOT NULL,
  title        TEXT        NOT NULL,
  body_html    TEXT        NOT NULL DEFAULT '',
  status       TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  published_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (doc_type, version)
);

CREATE TABLE IF NOT EXISTS acceptances (
  id                BIGSERIAL PRIMARY KEY,
  user_id           BIGINT      NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  legal_document_id BIGINT      NOT NULL REFERENCES legal_documents(id) ON DELETE RESTRICT,
  doc_type          TEXT        NOT NULL,
  version           TEXT        NOT NULL,
  accepted_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip                TEXT,
  user_agent        TEXT,
  device            TEXT,
  origin            TEXT        NOT NULL DEFAULT 'login'
);
CREATE INDEX IF NOT EXISTS acceptances_user_idx ON acceptances (user_id, doc_type, accepted_at DESC);

CREATE TABLE IF NOT EXISTS audit_log (
  id            BIGSERIAL PRIMARY KEY,
  at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_user_id BIGINT,
  actor_email   TEXT,
  action        TEXT        NOT NULL,
  entity        TEXT,
  entity_id     TEXT,
  meta          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  ip            TEXT,
  user_agent    TEXT
);
CREATE INDEX IF NOT EXISTS audit_log_at_idx ON audit_log (at DESC);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON audit_log (actor_user_id, at DESC);

-- Registros que não se apagam nem se editam: aceites LGPD e auditoria.
CREATE OR REPLACE FUNCTION evl_block_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'A tabela % é um registro imutável: não aceita % ', TG_TABLE_NAME, TG_OP USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS acceptances_immutable ON acceptances;
CREATE TRIGGER acceptances_immutable BEFORE UPDATE OR DELETE ON acceptances
  FOR EACH ROW EXECUTE FUNCTION evl_block_change();
DROP TRIGGER IF EXISTS audit_log_immutable ON audit_log;
CREATE TRIGGER audit_log_immutable BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION evl_block_change();

CREATE TABLE IF NOT EXISTS email_log (
  id          BIGSERIAL PRIMARY KEY,
  to_email    TEXT        NOT NULL,
  subject     TEXT        NOT NULL,
  template    TEXT        NOT NULL,
  status      TEXT        NOT NULL CHECK (status IN ('sent','failed','skipped')),
  provider_id TEXT,
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS data_requests (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT        NOT NULL CHECK (type IN ('export','delete','email_change_admin')),
  status      TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','denied')),
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS data_requests_user_idx ON data_requests (user_id, type, status);
