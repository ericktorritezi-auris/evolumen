-- 0.7.0 · Produtos digitais (arquivos para baixar) e arquivos no volume do Railway. Idempotente.
-- Produto e curso compartilham a tabela courses (checkout, pedidos, cupons, reembolso e vendas continuam iguais).
ALTER TABLE courses ADD COLUMN IF NOT EXISTS product_type TEXT NOT NULL DEFAULT 'course';
ALTER TABLE courses DROP CONSTRAINT IF EXISTS courses_product_type_ck;
ALTER TABLE courses ADD CONSTRAINT courses_product_type_ck CHECK (product_type IN ('course','download'));
ALTER TABLE courses ADD COLUMN IF NOT EXISTS files_updated_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS courses_type_idx ON courses (product_type);

-- Arquivos: no banco (até 20 MB) ou no volume (até 350 MB).
ALTER TABLE files DROP CONSTRAINT IF EXISTS files_kind_check;
ALTER TABLE files ADD CONSTRAINT files_kind_check CHECK (kind IN ('cover','doc','product'));
ALTER TABLE files ADD COLUMN IF NOT EXISTS storage TEXT NOT NULL DEFAULT 'db';
ALTER TABLE files ADD COLUMN IF NOT EXISTS path TEXT;
ALTER TABLE files ALTER COLUMN data DROP NOT NULL;
ALTER TABLE files DROP CONSTRAINT IF EXISTS files_storage_ck;
ALTER TABLE files ADD CONSTRAINT files_storage_ck CHECK ((storage = 'db' AND data IS NOT NULL) OR (storage = 'volume' AND path IS NOT NULL));

CREATE TABLE IF NOT EXISTS product_files (
  id         BIGSERIAL PRIMARY KEY,
  product_id BIGINT      NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  file_id    BIGINT      NOT NULL UNIQUE REFERENCES files(id) ON DELETE CASCADE,
  label      TEXT        NOT NULL,
  position   INTEGER     NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_files_product_idx ON product_files (product_id, position);
