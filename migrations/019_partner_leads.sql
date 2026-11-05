-- 1.6.0 · Lead Parceiros: funil interno (Kanban) de quem está sendo convidado a divulgar ou afiliar-se.
-- Sem vínculo com usuários, afiliados, cupons ou matrículas: é só acompanhamento. Idempotente.
CREATE TABLE IF NOT EXISTS partner_leads (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  tag         TEXT NOT NULL CHECK (tag IN ('afiliado','divulgador')),
  entry_month DATE NOT NULL,                       -- sempre o dia 1 do mês de entrada
  stage       TEXT NOT NULL DEFAULT 'inicio' CHECK (stage IN ('inicio','aguardando','aceitou','acessos','explicando','confirmado','sem')),
  stage_since TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS partner_leads_stage_idx ON partner_leads (stage);

-- Cada passagem de etapa, com o horário. É daqui que saem as médias de tempo.
CREATE TABLE IF NOT EXISTS partner_lead_moves (
  id         BIGSERIAL PRIMARY KEY,
  lead_id    BIGINT NOT NULL REFERENCES partner_leads(id) ON DELETE CASCADE,
  from_stage TEXT,
  to_stage   TEXT NOT NULL,
  moved_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  moved_by   BIGINT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS partner_lead_moves_lead_idx ON partner_lead_moves (lead_id, moved_at);
