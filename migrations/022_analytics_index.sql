-- EvoLumen Analytics 2.2.0: índices para a tela de números (funil e páginas) em períodos longos.
CREATE INDEX IF NOT EXISTS an_pageviews_session_path ON an_pageviews (session_id, path text_pattern_ops);
CREATE INDEX IF NOT EXISTS an_pageviews_site_created ON an_pageviews (site, created_at);
CREATE INDEX IF NOT EXISTS an_sessions_site_started ON an_sessions (site, started_at);
