'use strict';
// Painel do administrador: cursos, módulos, aulas, arquivos e matrículas.
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./db');
const C = require('./courses');
const files = require('./files');
const sec = require('./security');
const mailer = require('./mailer');
const emails = require('./emails');
const V = require('./validation');
const { audit } = require('./audit');
const views = require('./views/admin');

const ID = /^\d{1,12}$/;

function tempPassword() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  for (;;) {
    let p = ''; for (let i = 0; i < 12; i++) p += A[crypto.randomInt(A.length)];
    if (!V.checkPassword(p)) return p;
  }
}

function build(cfg, h) {
  const r = express.Router();
  const guard = [h.needUser, h.gate, h.needAdmin];
  r.use(['/admin/cursos', '/admin/modulos', '/admin/aulas', '/admin/arquivos', '/admin/matriculas'], ...guard);
  const ctx = (req, res, extra = {}) => ({ ...h.appCtx(req, res), ...extra });
  const bad = (msg) => { const e = new Error(msg); e.status = 400; e.expose = true; return e; };
  const flashBack = (req, res, type, text, to) => { h.setFlash(res, type, text); res.redirect(303, to); };

  const courseOr404 = async (req, next) => { const c = await C.byId(req.params.id); if (!c) { next(); return null; } return c; };

  // ---- cursos ----
  r.get('/admin/cursos', async (req, res) => {
    const courses = (await db.q(`
      SELECT c.*, (${C.VISIBLE}) AS visible,
        (SELECT count(*)::int FROM modules m WHERE m.course_id = c.id) AS modules,
        (SELECT count(*)::int FROM lessons l WHERE l.course_id = c.id) AS lessons,
        (SELECT count(*)::int FROM enrollments e WHERE e.course_id = c.id) AS students
      FROM courses c ORDER BY c.sort_order, c.id`)).rows;
    res.send(views.cursosList(ctx(req, res), { courses }));
  });

  r.get('/admin/cursos/novo', (req, res) => res.send(views.cursoForm(ctx(req, res), {})));

  const saveValues = (v, existing) => {
    const now = new Date();
    let publishedAt = null;
    if (v.publish) publishedAt = v.pubDate ? new Date(`${v.pubDate}T00:00:00-03:00`) : (existing && existing.published_at) || now;
    return { ...v, status: v.publish ? 'published' : 'draft', published_at: publishedAt };
  };
  const COLS = ['slug', 'title', 'summary', 'description', 'target_audience', 'prerequisites', 'level', 'category', 'workload_hours', 'learn_items', 'able_items', 'faq',
    'intro_youtube_id', 'price_cents', 'promo_price_cents', 'promo_until', 'max_installments', 'access_type', 'access_months', 'expiry_notice_days', 'renewal_price_cents',
    'sort_order', 'featured', 'status', 'published_at'];
  const colVal = (v, c) => (['learn_items', 'able_items', 'faq'].includes(c) ? JSON.stringify(v[c]) : v[c]);
  const slugTaken = async (slug, exceptId) => (await db.q('SELECT 1 FROM courses WHERE slug = $1 AND id <> $2', [slug, exceptId || 0])).rowCount > 0;

  r.post('/admin/cursos', async (req, res) => {
    const { errors, values } = C.parseCourse(req.body);
    if (!errors.slug && await slugTaken(values.slug)) errors.slug = 'Já existe um curso com este endereço.';
    if (Object.keys(errors).length) return res.status(422).send(views.cursoForm(ctx(req, res, { raw: req.body }), { values, errors }));
    const v = saveValues(values);
    const ins = await db.q(`INSERT INTO courses (${COLS.join(',')}) VALUES (${COLS.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING id`, COLS.map((c) => colVal(v, c)));
    await audit(req, 'course_created', { entity: 'course', entityId: ins.rows[0].id, meta: { slug: v.slug } });
    flashBack(req, res, 'success', 'Curso criado. Agora adicione os módulos e as aulas.', `/admin/cursos/${ins.rows[0].id}/conteudo`);
  });

  r.get('/admin/cursos/:id', async (req, res, next) => {
    const course = await courseOr404(req, next); if (!course) return;
    res.send(views.cursoForm(ctx(req, res), { course }));
  });

  r.post('/admin/cursos/:id', async (req, res, next) => {
    const course = await courseOr404(req, next); if (!course) return;
    const { errors, values } = C.parseCourse(req.body);
    if (!errors.slug && await slugTaken(values.slug, course.id)) errors.slug = 'Já existe um curso com este endereço.';
    if (Object.keys(errors).length) return res.status(422).send(views.cursoForm(ctx(req, res, { raw: req.body }), { course, values, errors }));
    const v = saveValues(values, course);
    await db.q(`UPDATE courses SET ${COLS.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1`, [course.id, ...COLS.map((c) => colVal(v, c))]);
    const wasPublished = course.status === 'published';
    await audit(req, wasPublished !== (v.status === 'published') ? (v.status === 'published' ? 'course_published' : 'course_unpublished') : 'course_updated', { entity: 'course', entityId: course.id, meta: { slug: v.slug } });
    flashBack(req, res, 'success', 'Curso salvo.', `/admin/cursos/${course.id}`);
  });

  r.post('/admin/cursos/:id/capa', (req, res, next) => files.receive(req, res, (err) => {
    if (err) return flashBack(req, res, 'error', err.message, `/admin/cursos/${req.params.id}`);
    next();
  }), sec.requireCsrf, async (req, res, next) => {
    const course = await courseOr404(req, next); if (!course) return;
    try {
      const f = files.validate(req.file, 'cover');
      const id = await db.tx(async (c) => {
        const old = (await c.query('SELECT cover_file_id FROM courses WHERE id = $1 FOR UPDATE', [course.id])).rows[0];
        const fid = await files.store(c, { kind: 'cover', ...f, userId: req.user.id });
        await c.query('UPDATE courses SET cover_file_id = $2, updated_at = now() WHERE id = $1', [course.id, fid]);
        if (old && old.cover_file_id) await c.query('DELETE FROM files WHERE id = $1', [old.cover_file_id]);
        return fid;
      });
      await audit(req, 'course_cover_updated', { entity: 'course', entityId: course.id, meta: { file: id } });
      flashBack(req, res, 'success', 'Capa atualizada.', `/admin/cursos/${course.id}`);
    } catch (e) { if (e instanceof files.UploadError) return flashBack(req, res, 'error', e.message, `/admin/cursos/${course.id}`); throw e; }
  });

  r.post('/admin/cursos/:id/capa/remover', async (req, res, next) => {
    const course = await courseOr404(req, next); if (!course) return;
    await db.tx(async (c) => {
      await c.query('UPDATE courses SET cover_file_id = NULL, updated_at = now() WHERE id = $1', [course.id]);
      if (course.cover_file_id) await c.query('DELETE FROM files WHERE id = $1', [course.cover_file_id]);
    });
    flashBack(req, res, 'info', 'Capa removida.', `/admin/cursos/${course.id}`);
  });

  r.post('/admin/cursos/:id/excluir', async (req, res, next) => {
    const course = await courseOr404(req, next); if (!course) return;
    const n = (await db.q('SELECT count(*)::int n FROM enrollments WHERE course_id = $1', [course.id])).rows[0].n;
    if (n > 0) return flashBack(req, res, 'error', 'Este curso tem alunos matriculados e não pode ser excluído. Deixe-o como rascunho.', `/admin/cursos/${course.id}`);
    try {
      await db.tx(async (c) => {
        await c.query('DELETE FROM files WHERE id IN (SELECT lf.file_id FROM lesson_files lf JOIN lessons l ON l.id = lf.lesson_id WHERE l.course_id = $1)', [course.id]);
        await c.query('DELETE FROM courses WHERE id = $1', [course.id]);
        if (course.cover_file_id) await c.query('DELETE FROM files WHERE id = $1', [course.cover_file_id]);
      });
    } catch (e) {
      if (e.code === '23503') return flashBack(req, res, 'error', 'Um aluno acabou de ser matriculado neste curso. Ele não pode ser excluído.', `/admin/cursos/${course.id}`);
      throw e;
    }
    await audit(req, 'course_deleted', { entity: 'course', entityId: course.id, meta: { slug: course.slug } });
    flashBack(req, res, 'info', 'Curso excluído.', '/admin/cursos');
  });

  // ---- módulos e aulas ----
  r.get('/admin/cursos/:id/conteudo', async (req, res, next) => {
    const course = await courseOr404(req, next); if (!course) return;
    const cur = await C.curriculum(course.id, { withVideo: true, withFiles: true });
    res.send(views.conteudo(ctx(req, res), { course, cur }));
  });
  const back = (courseId) => `/admin/cursos/${courseId}/conteudo`;
  const title = (v) => String(v || '').trim().replace(/\s+/g, ' ').slice(0, 140);

  r.post('/admin/cursos/:id/modulos', async (req, res, next) => {
    const course = await courseOr404(req, next); if (!course) return;
    const t = title(req.body.title);
    if (t.length < 2) return flashBack(req, res, 'error', 'Informe o nome do módulo.', back(course.id));
    await db.q('INSERT INTO modules (course_id, title, position) VALUES ($1,$2,(SELECT COALESCE(max(position),0)+1 FROM modules WHERE course_id = $1))', [course.id, t]);
    await audit(req, 'module_created', { entity: 'course', entityId: course.id });
    flashBack(req, res, 'success', 'Módulo adicionado.', back(course.id));
  });

  const moduleOr404 = async (req, next) => {
    if (!ID.test(req.params.id)) { next(); return null; }
    const m = (await db.q('SELECT * FROM modules WHERE id = $1', [req.params.id])).rows[0];
    if (!m) { next(); return null; } return m;
  };
  const lessonOr404 = async (req, next) => {
    if (!ID.test(req.params.id)) { next(); return null; }
    const l = (await db.q('SELECT * FROM lessons WHERE id = $1', [req.params.id])).rows[0];
    if (!l) { next(); return null; } return l;
  };

  // Reordena trocando de lugar com o vizinho e renumerando tudo.
  async function moveIn(table, scopeCol, scopeId, id, dir) {
    await db.tx(async (c) => {
      const rows = (await c.query(`SELECT id FROM ${table} WHERE ${scopeCol} = $1 ORDER BY position, id FOR UPDATE`, [scopeId])).rows.map((x) => String(x.id));
      const i = rows.indexOf(String(id)); const j = dir === 'up' ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= rows.length) return;
      [rows[i], rows[j]] = [rows[j], rows[i]];
      for (let k = 0; k < rows.length; k++) await c.query(`UPDATE ${table} SET position = $2 WHERE id = $1`, [rows[k], k + 1]);
    });
  }

  r.post('/admin/modulos/:id', async (req, res, next) => {
    const m = await moduleOr404(req, next); if (!m) return;
    const t = title(req.body.title);
    if (t.length < 2) return flashBack(req, res, 'error', 'Informe o nome do módulo.', back(m.course_id));
    await db.q('UPDATE modules SET title = $2 WHERE id = $1', [m.id, t]);
    flashBack(req, res, 'success', 'Módulo renomeado.', back(m.course_id));
  });
  r.post('/admin/modulos/:id/mover', async (req, res, next) => {
    const m = await moduleOr404(req, next); if (!m) return;
    await moveIn('modules', 'course_id', m.course_id, m.id, req.body.dir === 'up' ? 'up' : 'down');
    res.redirect(303, back(m.course_id));
  });
  r.post('/admin/modulos/:id/excluir', async (req, res, next) => {
    const m = await moduleOr404(req, next); if (!m) return;
    await db.tx(async (c) => {
      await c.query('DELETE FROM files WHERE id IN (SELECT lf.file_id FROM lesson_files lf JOIN lessons l ON l.id = lf.lesson_id WHERE l.module_id = $1)', [m.id]);
      await c.query('DELETE FROM modules WHERE id = $1', [m.id]);
    });
    await audit(req, 'module_deleted', { entity: 'course', entityId: m.course_id });
    flashBack(req, res, 'info', 'Módulo excluído.', back(m.course_id));
  });
  r.post('/admin/modulos/:id/aulas', async (req, res, next) => {
    const m = await moduleOr404(req, next); if (!m) return;
    const t = title(req.body.title);
    if (t.length < 2) return flashBack(req, res, 'error', 'Informe o título da aula.', back(m.course_id));
    await db.q('INSERT INTO lessons (course_id, module_id, title, position) VALUES ($1,$2,$3,(SELECT COALESCE(max(position),0)+1 FROM lessons WHERE module_id = $2))', [m.course_id, m.id, t]);
    await audit(req, 'lesson_created', { entity: 'course', entityId: m.course_id });
    flashBack(req, res, 'success', 'Aula adicionada. Abra a aula para colocar o vídeo e os arquivos.', back(m.course_id));
  });

  r.post('/admin/aulas/:id', async (req, res, next) => {
    const l = await lessonOr404(req, next); if (!l) return;
    const t = title(req.body.title);
    const yt = C.youtubeId(req.body.video);
    const dm = String(req.body.duration_min || '').trim();
    const duration = dm ? Number(dm) : null;
    if (t.length < 2) return flashBack(req, res, 'error', 'Informe o título da aula.', back(l.course_id));
    if (yt.error) return flashBack(req, res, 'error', 'Link do YouTube inválido. Cole o endereço do vídeo, como https://youtu.be/...', back(l.course_id));
    if (duration !== null && (!Number.isInteger(duration) || duration < 1 || duration > 1440)) return flashBack(req, res, 'error', 'Duração em minutos inteiros (1 a 1440).', back(l.course_id));
    await db.q('UPDATE lessons SET title = $2, youtube_id = $3, description = $4, duration_min = $5, updated_at = now() WHERE id = $1',
      [l.id, t, yt.id || null, String(req.body.description || '').trim().slice(0, 4000), duration]);
    await audit(req, 'lesson_updated', { entity: 'lesson', entityId: l.id });
    flashBack(req, res, 'success', 'Aula salva.', back(l.course_id));
  });
  r.post('/admin/aulas/:id/mover', async (req, res, next) => {
    const l = await lessonOr404(req, next); if (!l) return;
    await moveIn('lessons', 'module_id', l.module_id, l.id, req.body.dir === 'up' ? 'up' : 'down');
    res.redirect(303, back(l.course_id));
  });
  r.post('/admin/aulas/:id/excluir', async (req, res, next) => {
    const l = await lessonOr404(req, next); if (!l) return;
    await db.tx(async (c) => {
      await c.query('DELETE FROM files WHERE id IN (SELECT file_id FROM lesson_files WHERE lesson_id = $1)', [l.id]);
      await c.query('DELETE FROM lessons WHERE id = $1', [l.id]);
    });
    await audit(req, 'lesson_deleted', { entity: 'course', entityId: l.course_id });
    flashBack(req, res, 'info', 'Aula excluída.', back(l.course_id));
  });

  r.post('/admin/aulas/:id/arquivos', async (req, res, next) => {
    // o corpo multipart só é lido depois de confirmar que a aula existe
    if (!ID.test(req.params.id)) return next();
    const l0 = (await db.q('SELECT course_id FROM lessons WHERE id = $1', [req.params.id])).rows[0];
    if (!l0) return next();
    files.receive(req, res, (err) => {
      if (err) return flashBack(req, res, 'error', err.message, back(l0.course_id));
      sec.requireCsrf(req, res, async (e2) => {
        if (e2) return next(e2);
        try {
          const f = files.validate(req.file, 'doc');
          const label = title(req.body.label) || f.filename.replace(/\.[^.]+$/, '');
          await db.tx(async (c) => {
            const fid = await files.store(c, { kind: 'doc', ...f, userId: req.user.id });
            await c.query('INSERT INTO lesson_files (lesson_id, file_id, label, position) VALUES ($1,$2,$3,(SELECT COALESCE(max(position),0)+1 FROM lesson_files WHERE lesson_id = $1))', [req.params.id, fid, label]);
          });
          await audit(req, 'file_uploaded', { entity: 'lesson', entityId: req.params.id, meta: { filename: f.filename } });
          flashBack(req, res, 'success', 'Arquivo enviado.', back(l0.course_id));
        } catch (e) {
          if (e instanceof files.UploadError) return flashBack(req, res, 'error', e.message, back(l0.course_id));
          next(e);
        }
      });
    });
  });
  r.post('/admin/arquivos/:id/excluir', async (req, res, next) => {
    if (!ID.test(req.params.id)) return next();
    const row = (await db.q('SELECT l.course_id FROM lesson_files lf JOIN lessons l ON l.id = lf.lesson_id WHERE lf.file_id = $1', [req.params.id])).rows[0];
    if (!row) return next();
    await db.q('DELETE FROM files WHERE id = $1', [req.params.id]);
    await audit(req, 'file_deleted', { entity: 'file', entityId: req.params.id });
    flashBack(req, res, 'info', 'Arquivo removido.', back(row.course_id));
  });

  // ---- matrículas (liberação manual) ----
  const enrollRows = async (courseId) => (await db.q(`
    SELECT e.id, e.expires_at, (e.expires_at IS NOT NULL AND e.expires_at <= now()) AS expired, u.name, u.email,
      (SELECT count(*)::int FROM lessons WHERE course_id = e.course_id) AS total,
      (SELECT count(*)::int FROM lesson_progress p JOIN lessons l ON l.id = p.lesson_id WHERE p.user_id = e.user_id AND l.course_id = e.course_id) AS done
    FROM enrollments e JOIN users u ON u.id = e.user_id WHERE e.course_id = $1 ORDER BY e.created_at DESC`, [courseId])).rows;

  r.get('/admin/cursos/:id/matriculas', async (req, res, next) => {
    const course = await courseOr404(req, next); if (!course) return;
    res.send(views.matriculas(ctx(req, res), { course, rows: await enrollRows(course.id) }));
  });

  r.post('/admin/cursos/:id/matriculas', async (req, res, next) => {
    const course = await courseOr404(req, next); if (!course) return;
    const render = async (status, extra) => res.status(status).send(views.matriculas(ctx(req, res), { course, rows: await enrollRows(course.id), ...extra }));
    const email = V.normalizeEmail(req.body.email);
    const errors = {};
    if (!email) errors.email = 'Informe um e-mail válido.';
    const until = String(req.body.until || '').trim();
    if (until && !C.dateOnly(until)) errors.until = 'Data inválida.';
    let user = email ? (await db.q('SELECT * FROM users WHERE lower(email) = $1', [email])).rows[0] : null;
    if (user && user.role !== 'student') errors.email = 'Este e-mail é de um administrador, que já vê todos os cursos.';
    const name = String(req.body.name || '').trim().replace(/\s+/g, ' ').slice(0, 120);
    if (email && !user && name.length < 3) errors.name = 'Informe o nome para criar a conta do aluno.';
    if (Object.keys(errors).length) return render(422, { errors, email: String(req.body.email || '').slice(0, 254) });

    let password = null;
    if (!user) {
      password = tempPassword();
      const hash = await bcrypt.hash(password, cfg.bcryptCost);
      try {
        user = (await db.q("INSERT INTO users (email, password_hash, role, name, must_change_password) VALUES ($1,$2,'student',$3,TRUE) RETURNING *", [email, hash, name])).rows[0];
        await audit(req, 'student_created', { entity: 'user', entityId: user.id });
      } catch (e) {
        if (e.code !== '23505') throw e;
        return render(409, { errors: { email: 'Este e-mail acabou de ser cadastrado. Tente liberar o acesso de novo.' }, email });
      }
    }
    const expiry = until ? `${until}T23:59:59-03:00` : null;
    await db.q(`INSERT INTO enrollments (user_id, course_id, origin, expires_at, granted_by)
      VALUES ($1,$2,'manual', COALESCE($3::timestamptz, CASE WHEN $4::int IS NULL THEN NULL ELSE now() + ($4::int || ' months')::interval END), $5)
      ON CONFLICT (user_id, course_id) DO UPDATE SET starts_at = LEAST(enrollments.starts_at, now()), granted_by = $5,
        expires_at = COALESCE($3::timestamptz, CASE WHEN $4::int IS NULL THEN NULL ELSE now() + ($4::int || ' months')::interval END)`,
      [user.id, course.id, expiry, course.access_type === 'months' ? course.access_months : null, req.user.id]);
    await audit(req, 'enrollment_granted', { entity: 'course', entityId: course.id, meta: { user: user.id } });
    h.background(mailer.send(cfg, { to: user.email, ...(password ? emails.accessGranted(cfg, user.name, user.email, password, course.title) : emails.courseGranted(cfg, user.name, course.title, course.slug)) }));
    if (password) return render(200, { created: { email: user.email, password, newUser: true } });
    return render(200, { created: { email: user.email, newUser: false } });
  });

  r.post('/admin/matriculas/:id/excluir', async (req, res, next) => {
    if (!ID.test(req.params.id)) return next();
    const e = (await db.q('DELETE FROM enrollments WHERE id = $1 RETURNING course_id, user_id', [req.params.id])).rows[0];
    if (!e) return next();
    await audit(req, 'enrollment_removed', { entity: 'course', entityId: e.course_id, meta: { user: e.user_id } });
    flashBack(req, res, 'info', 'Acesso removido.', `/admin/cursos/${e.course_id}/matriculas`);
  });

  return r;
}
module.exports = { build };
