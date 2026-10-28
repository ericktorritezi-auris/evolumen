-- Fase 4 · Pagamentos. Idempotente.
-- Pedido = uma tentativa de compra (ou renovação) de um curso. O acesso só nasce quando o pagamento é aprovado.

CREATE TABLE IF NOT EXISTS orders (
  id                  BIGSERIAL PRIMARY KEY,
  public_id           TEXT        NOT NULL,
  user_id             BIGINT      REFERENCES users(id) ON DELETE RESTRICT,
  course_id           BIGINT      NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  kind                TEXT        NOT NULL DEFAULT 'purchase' CHECK (kind IN ('purchase','renewal')),
  buyer               JSONB       NOT NULL,
  list_cents          INTEGER     NOT NULL CHECK (list_cents >= 0),
  price_cents         INTEGER     NOT NULL CHECK (price_cents > 0),
  price_source        TEXT        NOT NULL DEFAULT 'full' CHECK (price_source IN ('full','promo','coupon','renewal')),
  coupon_id           BIGINT      REFERENCES coupons(id) ON DELETE RESTRICT,
  method              TEXT        NOT NULL CHECK (method IN ('pix','card')),
  provider            TEXT        NOT NULL CHECK (provider IN ('mercadopago','simulated')),
  provider_ref        TEXT,
  provider_payment_id TEXT,
  sim_status          TEXT,
  pix_code            TEXT,
  pix_qr_base64       TEXT,
  pix_expires_at      TIMESTAMPTZ,
  checkout_url        TEXT,
  paid_cents          INTEGER,
  installments        INTEGER,
  status              TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','refused','expired','cancelled','refunded','charged_back')),
  status_detail       TEXT,
  approved_at         TIMESTAMPTZ,
  refund_until        TIMESTAMPTZ,
  refunded_at         TIMESTAMPTZ,
  prev_expires_at     TIMESTAMPTZ,
  prev_enrollment     BOOLEAN     NOT NULL DEFAULT FALSE,
  reminder_sent_at    TIMESTAMPTZ,
  terms_doc_id        BIGINT      REFERENCES legal_documents(id) ON DELETE RESTRICT,
  privacy_doc_id      BIGINT      REFERENCES legal_documents(id) ON DELETE RESTRICT,
  ip                  TEXT,
  user_agent          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS orders_public_uq ON orders (public_id);
CREATE INDEX IF NOT EXISTS orders_user_idx ON orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_course_idx ON orders (course_id, status);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_payment_idx ON orders (provider_payment_id);

-- Pedidos de reembolso (dentro de 7 dias o aluno pede; o administrador decide).
CREATE TABLE IF NOT EXISTS refund_requests (
  id                 BIGSERIAL PRIMARY KEY,
  order_id           BIGINT      NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  requested_by       BIGINT      REFERENCES users(id) ON DELETE SET NULL,
  reason             TEXT        NOT NULL DEFAULT '',
  status             TEXT        NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','rejected','failed')),
  decided_by         BIGINT      REFERENCES users(id) ON DELETE SET NULL,
  decided_at         TIMESTAMPTZ,
  admin_note         TEXT        NOT NULL DEFAULT '',
  provider_refund_id TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS refund_one_open_uq ON refund_requests (order_id) WHERE status = 'requested';
CREATE INDEX IF NOT EXISTS refund_status_idx ON refund_requests (status, created_at DESC);

-- Notificações do gateway: guardadas para auditoria e para não processar duas vezes a mesma.
CREATE TABLE IF NOT EXISTS webhook_events (
  id           BIGSERIAL PRIMARY KEY,
  provider     TEXT        NOT NULL,
  event_key    TEXT        NOT NULL,
  payment_id   TEXT,
  payload      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  result       TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS webhook_event_uq ON webhook_events (provider, event_key);

-- Textos legais editados pelo painel: guarda o texto-fonte (o HTML é gerado a partir dele ao salvar).
ALTER TABLE legal_documents ADD COLUMN IF NOT EXISTS body_src TEXT;

-- Registros financeiros e jurídicos (pedido, pagamento, reembolso, textos legais) ficam por 5 anos; os demais seguem em 30 dias.
CREATE OR REPLACE FUNCTION evl_audit_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.at < now() - (CASE WHEN OLD.action ~ '^(order_|refund_|payment_|legal_|checkout_)' THEN interval '5 years' ELSE interval '30 days' END) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'A tabela % é um registro imutável: não aceita % ', TG_TABLE_NAME, TG_OP USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql;

-- Um único rascunho por tipo de texto legal.
CREATE UNIQUE INDEX IF NOT EXISTS legal_one_draft_uq ON legal_documents (doc_type) WHERE status = 'draft';
