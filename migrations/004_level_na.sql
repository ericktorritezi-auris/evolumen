-- 0.2.2: nível "Não se aplica" para cursos sem faixa de dificuldade.
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
   WHERE conrelid = 'courses'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%iniciante%';
  IF c IS NOT NULL THEN EXECUTE format('ALTER TABLE courses DROP CONSTRAINT %I', c); END IF;
END $$;
ALTER TABLE courses ADD CONSTRAINT courses_level_check
  CHECK (level IN ('iniciante','intermediario','avancado','nao_se_aplica'));
