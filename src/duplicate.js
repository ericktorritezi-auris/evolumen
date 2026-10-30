'use strict';
// Duplicar curso ou produto: copia o cadastro, a capa e o conteúdo; nunca copia vendas, matrículas, avaliações, cupons nem provas.
const db = require('./db');
const files = require('./files');

// O que será copiado (para mostrar ao administrador antes de salvar).
async function info(srcId) {
  const c = (await db.q('SELECT id, title, product_type, cover_file_id FROM courses WHERE id = $1', [srcId])).rows[0];
  if (!c) return null;
  const n = async (sql) => (await db.q(sql, [srcId])).rows[0].n;
  return {
    id: c.id, title: c.title, type: c.product_type === 'download' ? 'download' : 'course', hasCover: !!c.cover_file_id,
    nFiles: await n('SELECT count(*)::int AS n FROM product_files WHERE product_id = $1'),
    modules: await n('SELECT count(*)::int AS n FROM modules WHERE course_id = $1'),
    lessons: await n('SELECT count(*)::int AS n FROM lessons WHERE course_id = $1'),
    attachments: await n('SELECT count(*)::int AS n FROM lesson_files lf JOIN lessons l ON l.id = lf.lesson_id WHERE l.course_id = $1'),
  };
}

// Dentro de uma transação: copia para o curso novo (já inserido). `withFiles` = copiar os arquivos (do produto ou anexos de aula).
async function copyInto(c, srcId, newId, userId, { withFiles = true, created = [] } = {}) {
  const src = (await c.query('SELECT id, product_type, cover_file_id FROM courses WHERE id = $1', [srcId])).rows[0];
  if (!src) throw Object.assign(new Error('O original não existe mais.'), { expose: true, status: 404 });
  const out = { files: 0, modules: 0, lessons: 0, attachments: 0 };
  // espaço no volume: soma o que será copiado do volume (capa fica sempre no banco)
  const vol = (await c.query(src.product_type === 'download'
    ? "SELECT COALESCE(sum(f.size_bytes),0)::bigint AS b FROM product_files pf JOIN files f ON f.id = pf.file_id WHERE pf.product_id = $1 AND f.storage = 'volume'"
    : "SELECT COALESCE(sum(f.size_bytes),0)::bigint AS b FROM lesson_files lf JOIN lessons l ON l.id = lf.lesson_id JOIN files f ON f.id = lf.file_id WHERE l.course_id = $1 AND f.storage = 'volume'", [srcId])).rows[0].b;
  if (withFiles) files.assertSpace(Number(vol));
  // configuração do certificado do curso
  await c.query('UPDATE courses t SET cert_hours = s.cert_hours, cert_text = s.cert_text, cert_signer = s.cert_signer, cert_signer_role = s.cert_signer_role FROM courses s WHERE s.id = $1 AND t.id = $2', [srcId, newId]);
  if (src.cover_file_id) {
    const cid = await files.cloneFile(c, src.cover_file_id, userId, created);
    if (cid) await c.query('UPDATE courses SET cover_file_id = $2 WHERE id = $1', [newId, cid]);
  }
  if (src.product_type === 'download') {
    if (withFiles) {
      const rows = (await c.query('SELECT file_id, label, position FROM product_files WHERE product_id = $1 ORDER BY position, id', [srcId])).rows;
      for (const r of rows) {
        const fid = await files.cloneFile(c, r.file_id, userId, created); if (!fid) continue;
        await c.query('INSERT INTO product_files (product_id, file_id, label, position) VALUES ($1,$2,$3,$4)', [newId, fid, r.label, r.position]);
        out.files++;
      }
      if (out.files) await c.query('UPDATE courses SET files_updated_at = now() WHERE id = $1', [newId]);
    }
    return out;
  }
  const mods = (await c.query('SELECT id, title, position, active FROM modules WHERE course_id = $1 ORDER BY position, id', [srcId])).rows;
  for (const m of mods) {
    const nm = (await c.query('INSERT INTO modules (course_id, title, position, active) VALUES ($1,$2,$3,$4) RETURNING id', [newId, m.title, m.position, m.active])).rows[0].id;
    out.modules++;
    const ls = (await c.query('SELECT id, title, description, youtube_id, instagram_url, is_bonus, duration_min, position, active FROM lessons WHERE module_id = $1 ORDER BY position, id', [m.id])).rows;
    for (const l of ls) {
      const nl = (await c.query('INSERT INTO lessons (course_id, module_id, title, description, youtube_id, instagram_url, is_bonus, duration_min, position, active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id',
        [newId, nm, l.title, l.description, l.youtube_id, l.instagram_url, l.is_bonus, l.duration_min, l.position, l.active])).rows[0].id;
      out.lessons++;
      if (!withFiles) continue;
      const fs_ = (await c.query('SELECT file_id, label, position FROM lesson_files WHERE lesson_id = $1 ORDER BY position, id', [l.id])).rows;
      for (const f of fs_) {
        const fid = await files.cloneFile(c, f.file_id, userId, created); if (!fid) continue;
        await c.query('INSERT INTO lesson_files (lesson_id, file_id, label, position) VALUES ($1,$2,$3,$4)', [nl, fid, f.label, f.position]);
        out.attachments++;
      }
    }
  }
  return out;
}

module.exports = { info, copyInto };
