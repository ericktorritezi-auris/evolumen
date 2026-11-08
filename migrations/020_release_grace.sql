-- 1.9.0: liberação antecipada da carência (ação do administrador). A data original fica guardada.
ALTER TABLE commissions ADD COLUMN IF NOT EXISTS release_at_original TIMESTAMPTZ;
ALTER TABLE commissions ADD COLUMN IF NOT EXISTS released_early_at TIMESTAMPTZ;
ALTER TABLE commissions ADD COLUMN IF NOT EXISTS released_early_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
