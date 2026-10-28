-- 0.6.1 · Campainha de avisos (aluno e professor). Idempotente.
-- Um aviso fica "novo" (amarelo) até a pessoa interagir; depois fica "lido" (cinza) e some em 7 dias.
CREATE TABLE IF NOT EXISTS notifications (
  id              BIGSERIAL PRIMARY KEY,
  user_id         BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_user_id BIGINT      REFERENCES users(id) ON DELETE CASCADE,
  kind            TEXT        NOT NULL,
  title           TEXT        NOT NULL,
  body            TEXT        NOT NULL DEFAULT '',
  link            TEXT        NOT NULL DEFAULT '',
  ref_key         TEXT        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at         TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS notifications_key_uq ON notifications (user_id, ref_key);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_subject_idx ON notifications (subject_user_id);

-- O que já estava pendente para o professor aparece na campainha desde o primeiro dia.
INSERT INTO notifications (user_id, subject_user_id, kind, title, body, link, ref_key, created_at)
SELECT a.id, o.user_id, 'refund', 'Pedido de reembolso de ' || COALESCE(u.name, o.buyer->>'name'), c.title, '/admin/vendas', 'refund:' || rr.id, rr.created_at
FROM refund_requests rr JOIN orders o ON o.id = rr.order_id JOIN courses c ON c.id = o.course_id LEFT JOIN users u ON u.id = o.user_id
CROSS JOIN (SELECT id FROM users WHERE role = 'admin' AND status = 'active') a
WHERE rr.status IN ('requested','failed') AND o.status = 'approved'
ON CONFLICT DO NOTHING;

INSERT INTO notifications (user_id, subject_user_id, kind, title, body, link, ref_key, created_at)
SELECT a.id, d.user_id, 'lgpd', CASE d.type WHEN 'delete' THEN 'Pedido de exclusão de dados de ' WHEN 'export' THEN 'Pedido de cópia dos dados de ' ELSE 'Pedido de troca de e-mail de ' END || u.name, 'Prazo: 15 dias', '/admin/lgpd', 'lgpd:' || d.id, d.created_at
FROM data_requests d JOIN users u ON u.id = d.user_id
CROSS JOIN (SELECT id FROM users WHERE role = 'admin' AND status = 'active') a
WHERE d.status = 'open'
ON CONFLICT DO NOTHING;

INSERT INTO notifications (user_id, subject_user_id, kind, title, body, link, ref_key, created_at)
SELECT a.id, p.user_id, 'forum', u.name || ' fez uma pergunta', l.title, '/curso/' || c.slug || '/aula/' || l.id || '#post-' || p.id, 'forum:' || p.id, p.created_at
FROM forum_posts p JOIN users u ON u.id = p.user_id JOIN courses c ON c.id = p.course_id JOIN lessons l ON l.id = p.lesson_id
CROSS JOIN (SELECT id FROM users WHERE role = 'admin' AND status = 'active') a
WHERE p.parent_id IS NULL AND p.by_admin = false AND p.status = 'visible'
  AND NOT EXISTS (SELECT 1 FROM forum_posts x WHERE x.parent_id = p.id AND x.by_admin AND x.status = 'visible')
ON CONFLICT DO NOTHING;
