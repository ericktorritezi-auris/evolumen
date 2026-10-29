-- 1.1.0 · Descrição completa formatada (títulos, listas, negrito, links). Idempotente.
-- `description` continua guardando o texto simples (busca, resumo e fallback); `description_html` guarda a versão formatada, já limpa.
ALTER TABLE courses ADD COLUMN IF NOT EXISTS description_html TEXT NOT NULL DEFAULT '';
