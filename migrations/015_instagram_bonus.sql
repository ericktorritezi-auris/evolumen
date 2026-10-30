-- 1.1.2 · Aula com vídeo do Instagram e aula bônus. Idempotente.
-- instagram_url guarda só o endereço limpo da publicação (nunca o código de incorporação colado).
-- is_bonus: a aula aparece no curso, mas não entra no percentual nem nas regras do certificado.
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS instagram_url TEXT;
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS is_bonus BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lessons_instagram_ok' AND conrelid = 'lessons'::regclass) THEN
    ALTER TABLE lessons ADD CONSTRAINT lessons_instagram_ok CHECK (
      instagram_url IS NULL OR (instagram_url ~ '^https://www\.instagram\.com/(reel|p|tv)/[A-Za-z0-9_-]{5,40}/$' AND youtube_id IS NULL));
  END IF;
END $$;

-- Rascunho da Política de privacidade com o parágrafo sobre o Instagram (copia a versão publicada).
-- Nada muda para ninguém até você revisar e publicar em Textos legais.
INSERT INTO legal_documents (doc_type, version, title, body_html, status)
SELECT 'privacy', p.version || '-ig', p.title,
       p.body_html || '<h3>Vídeos do Instagram dentro dos cursos</h3><p>Alguns conteúdos extras dos cursos são vídeos publicados no Instagram. Eles só são carregados depois que você clica em “Carregar vídeo”. Ao clicar, o seu navegador se conecta aos servidores do Instagram (Meta Platforms), que podem coletar dados como endereço IP, dispositivo e cookies, conforme a política de privacidade do próprio Instagram. Se preferir, você pode não carregar o vídeo e abrir a publicação diretamente no Instagram. Nós não enviamos ao Instagram os seus dados cadastrais.</p>',
       'draft'
FROM legal_documents p
WHERE p.doc_type = 'privacy' AND p.status = 'published'
  AND NOT EXISTS (SELECT 1 FROM legal_documents d WHERE d.doc_type = 'privacy' AND d.status = 'draft')
ORDER BY p.published_at DESC NULLS LAST, p.id DESC
LIMIT 1
ON CONFLICT (doc_type, version) DO NOTHING;
