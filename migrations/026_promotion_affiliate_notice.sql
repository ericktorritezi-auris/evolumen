-- 2.5.2: registro do aviso por e-mail aos afiliados quando uma promoção é criada.
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS affiliates_notified_at TIMESTAMPTZ;
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS affiliates_notified_count INT;
