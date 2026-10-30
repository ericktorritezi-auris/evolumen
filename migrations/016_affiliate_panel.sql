-- 1.2.0 · Programa de afiliados, parte 2: conta e painel do afiliado. Idempotente.
-- Uma conta comum pode ser marcada como afiliado (affiliates.user_id). Uma conta só pode ser de um afiliado.
CREATE UNIQUE INDEX IF NOT EXISTS affiliates_user_uq ON affiliates (user_id) WHERE user_id IS NOT NULL;
-- Quando a conta foi vinculada (convite). Só comissões liberadas depois disso geram aviso na campainha.
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS enrollments_user_active_idx ON enrollments (user_id) WHERE status = 'active';
