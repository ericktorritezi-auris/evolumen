-- 1.3.0 · Cockpit de monitoramento: uma única chave de acesso (link secreto), trocada pelo administrador.
CREATE TABLE IF NOT EXISTS cockpit_access (
  id         SMALLINT PRIMARY KEY CHECK (id = 1),
  token      TEXT        NOT NULL CHECK (length(token) >= 32),
  rotated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  rotated_by BIGINT      REFERENCES users(id) ON DELETE SET NULL
);
-- Chave inicial aleatória (duas UUID v4 do banco = 244 bits). O administrador pode gerar outra quando quiser.
INSERT INTO cockpit_access (id, token) VALUES (1, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
  ON CONFLICT (id) DO NOTHING;

-- Índices para o painel recarregar a cada 30 s sem pesar.
CREATE INDEX IF NOT EXISTS orders_approved_at_idx ON orders (approved_at) WHERE status = 'approved';
CREATE INDEX IF NOT EXISTS sessions_last_seen_idx ON sessions (last_seen_at);
CREATE INDEX IF NOT EXISTS users_role_created_idx ON users (role, created_at);
CREATE INDEX IF NOT EXISTS enrollments_created_idx ON enrollments (created_at);
