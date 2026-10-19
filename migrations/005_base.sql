-- 0.3.0 · Etapa de base: cortesia, inativação em vez de exclusão, log com 30 dias e cupons.

-- Matrícula pode ser cancelada sem sumir do histórico, e ganha a origem "cortesia".
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
DO $$
DECLARE c text;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'enrollments'::regclass AND contype = 'c'
    AND (pg_get_constraintdef(oid) LIKE '%origin%' OR pg_get_constraintdef(oid) LIKE '%status%') LOOP
    EXECUTE format('ALTER TABLE enrollments DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE enrollments ADD CONSTRAINT enrollments_origin_check CHECK (origin IN ('manual','purchase','gift'));
ALTER TABLE enrollments ADD CONSTRAINT enrollments_status_check CHECK (status IN ('active','cancelled'));
ALTER TABLE enrollments ADD CONSTRAINT enrollments_cancel_ck CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL));

-- Módulos e aulas com progresso de alunos não se excluem: ficam inativos (somem para o aluno).
ALTER TABLE modules ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;

-- Log do administrador: registros recentes continuam imutáveis. Só linhas com mais de 30 dias podem ser apagadas
-- (a limpeza automática faz isso). Os aceites legais não mudam: seguem imutáveis.
CREATE OR REPLACE FUNCTION evl_audit_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.at < now() - interval '30 days' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'A tabela % é um registro imutável: não aceita % ', TG_TABLE_NAME, TG_OP USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS audit_log_immutable ON audit_log;
CREATE TRIGGER audit_log_immutable BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION evl_audit_guard();

-- Cupons. Nunca são excluídos: só inativados (e inativar é definitivo; para reutilizar, cria-se outro).
CREATE TABLE IF NOT EXISTS coupons (
  id             BIGSERIAL PRIMARY KEY,
  code           TEXT        NOT NULL,
  kind           TEXT        NOT NULL CHECK (kind IN ('percent','fixed')),
  percent        INTEGER     CHECK (percent IS NULL OR percent BETWEEN 1 AND 99),
  amount_cents   INTEGER     CHECK (amount_cents IS NULL OR amount_cents > 0),
  starts_on      DATE,
  ends_on        DATE,
  max_uses       INTEGER     CHECK (max_uses IS NULL OR max_uses > 0),
  note           TEXT        NOT NULL DEFAULT '',
  status         TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  inactivated_at TIMESTAMPTZ,
  created_by     BIGINT      REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT coupons_value_ok CHECK ((kind = 'percent' AND percent IS NOT NULL AND amount_cents IS NULL) OR (kind = 'fixed' AND amount_cents IS NOT NULL AND percent IS NULL)),
  CONSTRAINT coupons_dates_ok CHECK (starts_on IS NULL OR ends_on IS NULL OR ends_on >= starts_on),
  CONSTRAINT coupons_limit_ok CHECK (starts_on IS NOT NULL OR ends_on IS NOT NULL OR max_uses IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS coupons_code_uq ON coupons (upper(code));

CREATE TABLE IF NOT EXISTS coupon_courses (
  coupon_id BIGINT NOT NULL REFERENCES coupons(id) ON DELETE RESTRICT,
  course_id BIGINT NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  PRIMARY KEY (coupon_id, course_id)
);
CREATE INDEX IF NOT EXISTS coupon_courses_course_idx ON coupon_courses (course_id);

-- Usos do cupom. A Fase 4 grava aqui na compra; cada pessoa usa o mesmo cupom uma vez.
CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id         BIGSERIAL PRIMARY KEY,
  coupon_id  BIGINT      NOT NULL REFERENCES coupons(id) ON DELETE RESTRICT,
  user_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  course_id  BIGINT      NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (coupon_id, user_id),
  FOREIGN KEY (coupon_id, course_id) REFERENCES coupon_courses (coupon_id, course_id) ON DELETE RESTRICT
);

-- Envios do cupom por e-mail (leads). Não cria conta nem registra aceite.
CREATE TABLE IF NOT EXISTS coupon_sends (
  id         BIGSERIAL PRIMARY KEY,
  coupon_id  BIGINT      NOT NULL REFERENCES coupons(id) ON DELETE RESTRICT,
  email      TEXT        NOT NULL,
  name       TEXT        NOT NULL DEFAULT '',
  sent_by    BIGINT      REFERENCES users(id) ON DELETE SET NULL,
  status     TEXT        NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','failed','skipped')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS coupon_sends_coupon_idx ON coupon_sends (coupon_id, created_at DESC);
