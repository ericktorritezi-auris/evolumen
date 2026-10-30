-- 1.1.1 · Programa de afiliados (parte 1: controle do administrador) e tentativas extras em quantidade. Idempotente.

-- Afiliado = cadastro do administrador. user_id fica vazio nesta versão; a conta de acesso do afiliado chega na 1.2.0.
CREATE TABLE IF NOT EXISTS affiliates (
  id             BIGSERIAL PRIMARY KEY,
  name           TEXT        NOT NULL,
  email          TEXT        NOT NULL,
  phone          TEXT        NOT NULL DEFAULT '',
  note           TEXT        NOT NULL DEFAULT '',
  status         TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  user_id        BIGINT      REFERENCES users(id) ON DELETE RESTRICT,
  inactivated_at TIMESTAMPTZ,
  created_by     BIGINT      REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS affiliates_email_uq ON affiliates (lower(email));

-- O cupom pertence a, no máximo, um afiliado e carrega o percentual de comissão (os dois campos andam juntos).
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS affiliate_id    BIGINT REFERENCES affiliates(id) ON DELETE RESTRICT;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS commission_pct  NUMERIC(5,2);
ALTER TABLE coupons DROP CONSTRAINT IF EXISTS coupons_affiliate_ok;
ALTER TABLE coupons ADD CONSTRAINT coupons_affiliate_ok CHECK (
  (affiliate_id IS NULL AND commission_pct IS NULL)
  OR (affiliate_id IS NOT NULL AND commission_pct IS NOT NULL AND commission_pct > 0 AND commission_pct <= 100));
CREATE INDEX IF NOT EXISTS coupons_affiliate_idx ON coupons (affiliate_id) WHERE affiliate_id IS NOT NULL;

-- Uma comissão por pedido. "active" vale até ser cancelada; estar em carência ou liberada depende só da data (release_at).
-- A base e o percentual ficam gravados no dia da venda, e não mudam se o cupom for editado depois.
CREATE TABLE IF NOT EXISTS commissions (
  id            BIGSERIAL PRIMARY KEY,
  affiliate_id  BIGINT      NOT NULL REFERENCES affiliates(id) ON DELETE RESTRICT,
  order_id      BIGINT      NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
  coupon_id     BIGINT      NOT NULL REFERENCES coupons(id) ON DELETE RESTRICT,
  base_cents    INTEGER     NOT NULL CHECK (base_cents > 0),
  pct           NUMERIC(5,2) NOT NULL CHECK (pct > 0 AND pct <= 100),
  amount_cents  INTEGER     NOT NULL CHECK (amount_cents > 0),
  status        TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  release_at    TIMESTAMPTZ NOT NULL,
  cancelled_at  TIMESTAMPTZ,
  cancel_reason TEXT        NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS commissions_affiliate_idx ON commissions (affiliate_id, created_at DESC);

-- Repasses feitos ao afiliado. Nunca se apaga: um lançamento errado é anulado, com motivo, e sai do saldo.
CREATE TABLE IF NOT EXISTS affiliate_payouts (
  id            BIGSERIAL PRIMARY KEY,
  affiliate_id  BIGINT      NOT NULL REFERENCES affiliates(id) ON DELETE RESTRICT,
  amount_cents  INTEGER     NOT NULL CHECK (amount_cents > 0),
  paid_on       DATE        NOT NULL,
  note          TEXT        NOT NULL DEFAULT '',
  created_by    BIGINT      REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  voided_at     TIMESTAMPTZ,
  voided_by     BIGINT      REFERENCES users(id) ON DELETE SET NULL,
  void_reason   TEXT        NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS affiliate_payouts_idx ON affiliate_payouts (affiliate_id, paid_on DESC);

-- Terceiro texto legal: o Termo do Programa de Afiliados. Nasce como rascunho e não é exigido de ninguém nesta versão.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conname FROM pg_constraint WHERE conrelid = 'legal_documents'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%doc_type%' LOOP
    EXECUTE format('ALTER TABLE legal_documents DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;
ALTER TABLE legal_documents ADD CONSTRAINT legal_doc_type_ok CHECK (doc_type IN ('terms','privacy','affiliate'));
INSERT INTO legal_documents (doc_type, version, title, body_html, status)
VALUES ('affiliate', 'v1.0', 'Termo do Programa de Afiliados', '<p>Texto em elaboração. A minuta aprovada será publicada pelo painel, na área de Textos legais.</p>', 'draft')
ON CONFLICT (doc_type, version) DO NOTHING;

-- Tentativa extra em quantidade (1 a 10 por liberação).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conname FROM pg_constraint WHERE conrelid = 'attempt_grants'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%extra%' LOOP
    EXECUTE format('ALTER TABLE attempt_grants DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;
ALTER TABLE attempt_grants ADD CONSTRAINT attempt_grants_extra_ok CHECK (extra BETWEEN 1 AND 10);

-- Registros do programa de afiliados (affiliate_) ficam 5 anos, como os demais registros financeiros.
CREATE OR REPLACE FUNCTION evl_audit_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.at < now() - (CASE WHEN OLD.action ~ '^(order_|refund_|payment_|legal_|checkout_|data_|acceptance_|file_|download_|launch_|affiliate_)' THEN interval '5 years' ELSE interval '30 days' END) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'A tabela % é um registro imutável: não aceita % ', TG_TABLE_NAME, TG_OP USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql;
