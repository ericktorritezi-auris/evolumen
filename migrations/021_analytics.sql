-- 2.0.0 (etapa 1): medição própria de acessos (EvoLumen Analytics). Sem IP guardado: só país, estado e cidade aproximados.
CREATE TABLE IF NOT EXISTS an_visitors (
  visitor_id TEXT PRIMARY KEY,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
  sessions   INT NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS an_visitors_last ON an_visitors (last_seen);

CREATE TABLE IF NOT EXISTS an_sessions (
  id           TEXT PRIMARY KEY,
  visitor_id   TEXT NOT NULL,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  site         TEXT NOT NULL CHECK (site IN ('plataforma','landing')),
  source       TEXT NOT NULL DEFAULT 'direto',
  referrer_host TEXT,
  coupon       TEXT,
  entry_host   TEXT,
  entry_path   TEXT,
  exit_path    TEXT,
  pages        INT NOT NULL DEFAULT 1,
  device       TEXT,
  browser      TEXT,
  os           TEXT,
  country      TEXT,
  region       TEXT,
  city         TEXT,
  is_new       BOOLEAN NOT NULL DEFAULT FALSE,
  user_id      BIGINT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS an_sessions_started ON an_sessions (started_at);
CREATE INDEX IF NOT EXISTS an_sessions_visitor ON an_sessions (visitor_id);
CREATE INDEX IF NOT EXISTS an_sessions_coupon ON an_sessions (coupon) WHERE coupon IS NOT NULL;

CREATE TABLE IF NOT EXISTS an_pageviews (
  id         BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  site       TEXT NOT NULL,
  host       TEXT,
  path       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS an_pageviews_created ON an_pageviews (created_at);
CREATE INDEX IF NOT EXISTS an_pageviews_session ON an_pageviews (session_id);

-- Totais por dia: guardam o histórico depois que os registros brutos saem (13 meses).
CREATE TABLE IF NOT EXISTS an_daily (
  day DATE NOT NULL, site TEXT NOT NULL,
  visits INT NOT NULL DEFAULT 0, visitors INT NOT NULL DEFAULT 0, pageviews INT NOT NULL DEFAULT 0, new_visitors INT NOT NULL DEFAULT 0,
  PRIMARY KEY (day, site)
);

-- Liga a compra ao visitante (funil até a venda).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS visitor_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS session_id TEXT;
CREATE INDEX IF NOT EXISTS orders_session ON orders (session_id) WHERE session_id IS NOT NULL;
