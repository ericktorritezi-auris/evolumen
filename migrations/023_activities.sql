-- 2.3.0 · Atividade complementar. Idempotente. Nada muda para aulas e alunos existentes:
-- is_activity entra desmarcada (FALSE) em todas as aulas.
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS is_activity BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lessons_activity_not_bonus' AND conrelid = 'lessons'::regclass) THEN
    ALTER TABLE lessons ADD CONSTRAINT lessons_activity_not_bonus CHECK (NOT (is_activity AND is_bonus));
  END IF;
END $$;

-- Cada linha é um envio do aluno (que o professor depois avalia na própria linha) ou uma decisão do professor sem envio:
--   pending   = envio do aluno (links), aguardando avaliação
--   adjust    = avaliado: ajustes necessários (o aluno corrige e reenvia)
--   approved  = avaliado: aprovado (nota obrigatória)
--   rejected  = avaliado: não aprovado (nota obrigatória; o aluno fica bloqueado até o professor reabrir)
--   waived    = professor dispensou a atividade, sem envio (o motivo fica no resumo)
--   reopened  = professor reabriu a atividade para um novo envio
-- A última linha (maior id) define o estado atual; aprovada ou dispensada vale para sempre.
CREATE TABLE IF NOT EXISTS activity_submissions (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id    BIGINT      NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  course_id    BIGINT      NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  status       TEXT        NOT NULL CHECK (status IN ('pending','adjust','approved','rejected','waived','reopened')),
  attempt_no   INT         NOT NULL DEFAULT 1,
  links        JSONB       NOT NULL DEFAULT '[]'::jsonb,
  grade        NUMERIC(3,1) CHECK (grade IS NULL OR (grade >= 0 AND grade <= 10)),
  summary      TEXT        NOT NULL DEFAULT '',
  actor_id     BIGINT      REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  evaluated_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS activity_user_lesson ON activity_submissions (user_id, lesson_id, id);
CREATE INDEX IF NOT EXISTS activity_course_status ON activity_submissions (course_id, status, id);
-- só um envio aguardando avaliação por aluno e aula
CREATE UNIQUE INDEX IF NOT EXISTS activity_one_pending ON activity_submissions (user_id, lesson_id) WHERE status = 'pending';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'activity_links_max' AND conrelid = 'activity_submissions'::regclass) THEN
    ALTER TABLE activity_submissions ADD CONSTRAINT activity_links_max CHECK (jsonb_typeof(links) = 'array' AND jsonb_array_length(links) <= 5);
  END IF;
END $$;
