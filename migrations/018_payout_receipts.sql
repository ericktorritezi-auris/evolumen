-- 1.5.0 · Recibo de repasse: destino do pagamento (Pix ou conta) no cadastro do afiliado e congelado em cada repasse. Idempotente.
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS dest_kind    TEXT NOT NULL DEFAULT '';
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS pix_key      TEXT NOT NULL DEFAULT '';
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS bank_name    TEXT NOT NULL DEFAULT '';
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS bank_agency  TEXT NOT NULL DEFAULT '';
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS bank_account TEXT NOT NULL DEFAULT '';
ALTER TABLE affiliates DROP CONSTRAINT IF EXISTS affiliates_dest_kind_ok;
ALTER TABLE affiliates ADD CONSTRAINT affiliates_dest_kind_ok CHECK (dest_kind IN ('','pix','conta'));
-- Texto do destino no dia do repasse. NULL = repasse anterior à 1.5.0 (o recibo usa o cadastro atual); '' = repasse sem destino cadastrado.
ALTER TABLE affiliate_payouts ADD COLUMN IF NOT EXISTS dest_text TEXT;
