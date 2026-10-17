-- Fase 2 · Cursos e aulas.

CREATE TABLE IF NOT EXISTS files (
  id         BIGSERIAL PRIMARY KEY,
  kind       TEXT        NOT NULL CHECK (kind IN ('cover','doc')),
  filename   TEXT        NOT NULL,
  mime       TEXT        NOT NULL,
  size_bytes INTEGER     NOT NULL CHECK (size_bytes > 0),
  sha256     TEXT        NOT NULL,
  data       BYTEA       NOT NULL,
  created_by BIGINT      REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS courses (
  id                  BIGSERIAL PRIMARY KEY,
  slug                TEXT        NOT NULL,
  title               TEXT        NOT NULL,
  summary             TEXT        NOT NULL DEFAULT '',
  description         TEXT        NOT NULL DEFAULT '',
  target_audience     TEXT        NOT NULL DEFAULT '',
  prerequisites       TEXT        NOT NULL DEFAULT '',
  level               TEXT        NOT NULL DEFAULT 'iniciante' CHECK (level IN ('iniciante','intermediario','avancado')),
  category            TEXT        NOT NULL DEFAULT '',
  workload_hours      INTEGER     CHECK (workload_hours IS NULL OR workload_hours BETWEEN 1 AND 2000),
  learn_items         JSONB       NOT NULL DEFAULT '[]'::jsonb,
  able_items          JSONB       NOT NULL DEFAULT '[]'::jsonb,
  faq                 JSONB       NOT NULL DEFAULT '[]'::jsonb,
  intro_youtube_id    TEXT,
  price_cents         INTEGER     NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  promo_price_cents   INTEGER     CHECK (promo_price_cents IS NULL OR promo_price_cents >= 0),
  promo_until         DATE,
  max_installments    INTEGER     NOT NULL DEFAULT 12 CHECK (max_installments BETWEEN 1 AND 12),
  access_type         TEXT        NOT NULL DEFAULT 'lifetime' CHECK (access_type IN ('lifetime','months')),
  access_months       INTEGER     CHECK (access_months IS NULL OR access_months BETWEEN 1 AND 120),
  expiry_notice_days  TEXT        NOT NULL DEFAULT '30,7,1',
  renewal_price_cents INTEGER     CHECK (renewal_price_cents IS NULL OR renewal_price_cents >= 0),
  sort_order          INTEGER     NOT NULL DEFAULT 100,
  featured            BOOLEAN     NOT NULL DEFAULT FALSE,
  status              TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  published_at        TIMESTAMPTZ,
  cover_file_id       BIGINT      REFERENCES files(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT courses_access_months_ck CHECK ((access_type = 'months') = (access_months IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS courses_slug_uq ON courses (slug);
CREATE INDEX IF NOT EXISTS courses_status_idx ON courses (status, sort_order);

CREATE TABLE IF NOT EXISTS modules (
  id         BIGSERIAL PRIMARY KEY,
  course_id  BIGINT      NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title      TEXT        NOT NULL,
  position   INTEGER     NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS modules_course_idx ON modules (course_id, position);

CREATE TABLE IF NOT EXISTS lessons (
  id           BIGSERIAL PRIMARY KEY,
  course_id    BIGINT      NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  module_id    BIGINT      NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  title        TEXT        NOT NULL,
  description  TEXT        NOT NULL DEFAULT '',
  youtube_id   TEXT,
  duration_min INTEGER     CHECK (duration_min IS NULL OR duration_min BETWEEN 1 AND 1440),
  position     INTEGER     NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lessons_module_idx ON lessons (module_id, position);
CREATE INDEX IF NOT EXISTS lessons_course_idx ON lessons (course_id);

CREATE TABLE IF NOT EXISTS lesson_files (
  id        BIGSERIAL PRIMARY KEY,
  lesson_id BIGINT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  file_id   BIGINT NOT NULL UNIQUE REFERENCES files(id) ON DELETE CASCADE,
  label     TEXT   NOT NULL,
  position  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS lesson_files_lesson_idx ON lesson_files (lesson_id, position);

-- Direito de acesso. Na Fase 4 as compras também criam linhas aqui (origin = 'purchase').
CREATE TABLE IF NOT EXISTS enrollments (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id  BIGINT      NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  origin     TEXT        NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual','purchase')),
  starts_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  granted_by BIGINT      REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, course_id)
);
CREATE INDEX IF NOT EXISTS enrollments_course_idx ON enrollments (course_id);

CREATE TABLE IF NOT EXISTS lesson_progress (
  user_id      BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id    BIGINT      NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, lesson_id)
);
