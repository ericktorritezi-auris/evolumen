-- 0.4.0 · Fase 3: tempo assistido, quiz por módulo, prova final, tentativas e certificados.

-- Dados editáveis do certificado de cada curso (texto, carga horária e assinatura).
ALTER TABLE courses ADD COLUMN IF NOT EXISTS cert_hours INTEGER CHECK (cert_hours IS NULL OR cert_hours BETWEEN 1 AND 2000);
ALTER TABLE courses ADD COLUMN IF NOT EXISTS cert_text TEXT NOT NULL DEFAULT '';
ALTER TABLE courses ADD COLUMN IF NOT EXISTS cert_signer TEXT NOT NULL DEFAULT '';
ALTER TABLE courses ADD COLUMN IF NOT EXISTS cert_signer_role TEXT NOT NULL DEFAULT '';

-- Tempo realmente assistido de cada aula (somado pelo player do YouTube, não só "abriu a aula").
CREATE TABLE IF NOT EXISTS lesson_watch (
  user_id          BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id        BIGINT      NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  watched_seconds  INTEGER     NOT NULL DEFAULT 0 CHECK (watched_seconds >= 0),
  duration_seconds INTEGER     NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, lesson_id)
);

-- Avaliação: quiz de um módulo (opcional, não pesa na nota final) ou a prova final do curso.
CREATE TABLE IF NOT EXISTS assessments (
  id           BIGSERIAL PRIMARY KEY,
  course_id    BIGINT       NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  module_id    BIGINT       REFERENCES modules(id) ON DELETE CASCADE,
  kind         TEXT         NOT NULL CHECK (kind IN ('quiz','final')),
  title        TEXT         NOT NULL DEFAULT '',
  pass_score   NUMERIC(3,1) NOT NULL DEFAULT 7.0 CHECK (pass_score BETWEEN 0 AND 10),
  max_attempts INTEGER      NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  active       BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT assessments_kind_module CHECK ((kind = 'quiz') = (module_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS assessments_one_quiz_uq ON assessments (module_id) WHERE kind = 'quiz';
CREATE UNIQUE INDEX IF NOT EXISTS assessments_one_final_uq ON assessments (course_id) WHERE kind = 'final';

CREATE TABLE IF NOT EXISTS assessment_questions (
  id            BIGSERIAL PRIMARY KEY,
  assessment_id BIGINT  NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL DEFAULT 0,
  kind          TEXT    NOT NULL DEFAULT 'single' CHECK (kind IN ('single','truefalse')),
  body          TEXT    NOT NULL,
  explanation   TEXT    NOT NULL DEFAULT '',
  active        BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS assessment_questions_idx ON assessment_questions (assessment_id, position);

CREATE TABLE IF NOT EXISTS assessment_options (
  id          BIGSERIAL PRIMARY KEY,
  question_id BIGINT  NOT NULL REFERENCES assessment_questions(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL DEFAULT 0,
  body        TEXT    NOT NULL,
  correct     BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS assessment_options_idx ON assessment_options (question_id, position);
CREATE UNIQUE INDEX IF NOT EXISTS assessment_options_one_correct_uq ON assessment_options (question_id) WHERE correct;

-- Tentativas do aluno. A prova fica "congelada" na tentativa (ordem embaralhada), então editar a avaliação depois não muda o histórico.
CREATE TABLE IF NOT EXISTS assessment_attempts (
  id            BIGSERIAL PRIMARY KEY,
  assessment_id BIGINT       NOT NULL REFERENCES assessments(id) ON DELETE RESTRICT,
  user_id       BIGINT       NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  number        INTEGER      NOT NULL CHECK (number >= 1),
  started_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  snapshot      JSONB        NOT NULL,
  answers       JSONB        NOT NULL DEFAULT '{}'::jsonb,
  correct_count INTEGER,
  total         INTEGER      NOT NULL CHECK (total >= 1),
  score         NUMERIC(4,2),
  passed        BOOLEAN,
  UNIQUE (assessment_id, user_id, number),
  CONSTRAINT attempts_finished_ck CHECK ((finished_at IS NULL) = (score IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS attempts_one_open_uq ON assessment_attempts (assessment_id, user_id) WHERE finished_at IS NULL;

-- Tentativa extra liberada pelo administrador.
CREATE TABLE IF NOT EXISTS attempt_grants (
  id            BIGSERIAL PRIMARY KEY,
  assessment_id BIGINT      NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  user_id       BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  extra         INTEGER     NOT NULL DEFAULT 1 CHECK (extra BETWEEN 1 AND 5),
  granted_by    BIGINT      REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Liberação manual da prova final (se o player do YouTube não puder medir o tempo assistido).
CREATE TABLE IF NOT EXISTS exam_unlocks (
  assessment_id BIGINT      NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  user_id       BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  granted_by    BIGINT      REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (assessment_id, user_id)
);

-- Certificados. Guardam uma cópia do nome, do curso e do texto no momento da emissão.
CREATE TABLE IF NOT EXISTS certificates (
  id            BIGSERIAL PRIMARY KEY,
  code          TEXT         NOT NULL UNIQUE,
  user_id       BIGINT       NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  course_id     BIGINT       NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  student_name  TEXT         NOT NULL,
  course_title  TEXT         NOT NULL,
  hours         INTEGER,
  body_text     TEXT         NOT NULL,
  signer        TEXT         NOT NULL DEFAULT '',
  signer_role   TEXT         NOT NULL DEFAULT '',
  final_score   NUMERIC(4,2),
  issued_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  status        TEXT         NOT NULL DEFAULT 'valid' CHECK (status IN ('valid','revoked')),
  revoked_at    TIMESTAMPTZ,
  revoke_reason TEXT         NOT NULL DEFAULT '',
  UNIQUE (user_id, course_id),
  CONSTRAINT certificates_revoked_ck CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS certificates_course_idx ON certificates (course_id);
