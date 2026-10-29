'use strict';
// Painel do administrador: cursos, módulos, aulas, arquivos e matrículas.
const express = require('express');
const db = require('./db');
const C = require('./courses');
const files = require('./files');
const sec = require('./security');
const access = require('./access');
const certs = require('./certificates');
const V = require('./validation');
const { audit } = require('./audit');
const Dup = require('./duplicate');
const views = require('./views/admin');
const notify = require('./notify');
const mailer = require('./mailer');
const emails = require('./emails');

const ID = /^\d{1,12}$/;

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
        (SELECT count(*)::int FROM product_files pf WHERE pf.product_id = c.id) AS n_files,
        (SELECT count(*)::int FROM enrollments e WHERE e.course_id = c.id) AS students
      FROM courses c ORDER BY c.sort_order, c.id`)).rows;
    res.send(views.cursosList(ctx(req, res), { courses }));
  });

  // Primeiro o tipo: curso ou produto digital. Só depois o cadastro.
  r.get('/admin/cursos/novo', (req, res) => {
    const tipo = req.query.tipo === 'arquivos' ? 'download' : req.query.tipo === 'curso' ? 'course' : null;
    if (!tipo) return res.send(views.escolherTipo(ctx(req, res)));
    res.send(views.cursoForm(ctx(req, res, { tipo }), {}));
  });

  // Duplicar: abre o formulário de cadastro já preenchido, sem o endereço (slug). Nada é criado até salvar.
  r.get('/admin/cursos/:id/duplicar', async (req, res, next) => {
    const course = await courseOr404(req, next); if (!course) return;
    const copy = await Dup.info(course.id);
    const values = { ...course, slug: '', title: `Cópia de ${course.title}`.slice(0, 120), status: 'draft', published_at: null, featured: false };
    res.send(views.cursoForm(ctx(req, res, { tipo: copy.type, copy }), { values }));
  });

  // Produto digital não tem módulos, aulas, avaliações nem certificado: essas telas levam aos arquivos.
  r.use('/admin/cursos/:id', async (req, res, next) => {
    if (!ID.test(req.params.id) || !/^\/(conteudo|avaliacoes|certificado|modulos)/.test(req.path)) return next();
    const c = (await db.q('SELECT product_type FROM courses WHERE id = $1', [req.params.id])).rows[0];
    if (!c || c.product_type !== 'download') return next();
    flashBack(req, res, 'info', 'Produto digital não tem módulos, aulas nem certificado. Gerencie os arquivos aqui.', `/admin/cursos/${req.params.id}/arquivos`);
  });

  const saveValues = (v, existing) => {
    const now = new Date();
    let publishedAt = null;
    if (v.publish) publishedAt = v.pubDate ? new Date(`${v.pubDate}T00:00:00-03:00`) : (existing && existing.published_at) || now;
    const keep = v.keepDesc ? { description: existing ? existing.description : '', description_html: existing ? existing.description_html : '' } : {};
    return { ...v, ...keep, status: v.publish ? 'published' : 'draft', published_at: publishedAt };
  };
  const COLS = ['slug', 'title', 'summary', 'description', 'description_html', 'target_audience', 'prerequisites', 'level', 'category', 'workload_hours', 'learn_items', 'able_items', 'faq',
    'intro_youtube_id', 'price_cents', 'promo_price_cents', 'promo_until', 'max_installments', 'access_type', 'access_months', 'expiry_notice_days', 'renewal_price_cents',
    'sort_order', 'featured', 'status', 'published_at'];
  const colVal = (v, c) => (['learn_items', 'able_items', 'faq'].includes(c) ? JSON.stringify(v[c]) : v[c]);
  const slugTaken = async (slug, exceptId) => (await db.q('SELECT 1 FROM courses WHERE slug = $1 AND id <> $2', [slug, exceptId || 0])).rowCount > 0;

  r.post('/admin/cursos', async (req, res, next) => {
    // Duplicação: o tipo vem do original; os dados vêm do formulário (já editados), o conteúdo vem do original.
    const copy = ID.test(String(req.body.copy_from || '')) ? await Dup.info(req.body.copy_from) : null;
    if (req.body.copy_from && !copy) return flashBack(req, res, 'error', 'O curso ou produto original não existe mais. Nada foi criado.', '/admin/cursos');
    const tipo = copy ? copy.type : (req.body.product_type === 'download' ? 'download' : 'course');
    const { errors, values } = C.parseCourse(req.body, tipo);
    if (!errors.slug && await slugTaken(values.slug)) errors.slug = 'Já existe um curso com este endereço.';
    if (tipo === 'download' && values.publish) errors.publish = 'Um produto novo ainda não tem arquivos. Salve como rascunho, envie os arquivos e depois publique.';
    if (Object.keys(errors).length) return res.status(422).send(views.cursoForm(ctx(req, res, { raw: req.body, tipo, copy, copyFiles: req.body.copy_files === '1' }), { values, errors }));
    const v = saveValues(values);
    if (copy) { v.status = 'draft'; v.published_at = null; } // a cópia sempre nasce como rascunho
    const cols = [...COLS, 'product_type'];
    let id; let done = null; const created = [];
    try {
      await db.tx(async (c) => {
        id = (await c.query(`INSERT INTO courses (${cols.join(',')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING id`, [...COLS.map((k) => colVal(v, k)), tipo])).rows[0].id;
        if (copy) done = await Dup.copyInto(c, copy.id, id, req.user.id, { withFiles: req.body.copy_files === '1', created });
      });
    } catch (e) {
      files.dropVolumeFiles(created); // cópia desfeita: apaga na hora os arquivos já copiados no volume
      if (e.code === '23505') { errors.slug = 'Já existe um curso com este endereço.'; return res.status(422).send(views.cursoForm(ctx(req, res, { raw: req.body, tipo, copy, copyFiles: req.body.copy_files === '1' }), { values, errors })); }
      if (e instanceof files.UploadError || e.expose) { errors.general = e.message; return res.status(422).send(views.cursoForm(ctx(req, res, { raw: req.body, tipo, copy, copyFiles: req.body.copy_files === '1' }), { values, errors })); }
      throw e;
    } finally { if (copy) files.sweepVolume().catch(() => {}); }
    await audit(req, copy ? 'course_duplicated' : 'course_created', { entity: 'course', entityId: id, meta: { slug: v.slug, tipo, ...(copy ? { from: copy.id, ...done } : {}) } });
    if (copy) {
      const bits = tipo === 'download' ? [`${done.files} ${done.files === 1 ? 'arquivo' : 'arquivos'}`] : [`${done.modules} ${done.modules === 1 ? 'módulo' : 'módulos'}`, `${done.lessons} ${done.lessons === 1 ? 'aula' : 'aulas'}`, `${done.attachments} ${done.attachments === 1 ? 'anexo' : 'anexos'}`];
      return flashBack(req, res, 'success', `Cópia criada como rascunho, com ${bits.join(', ')}. Revise e publique quando estiver pronto.`, tipo === 'download' ? `/admin/cursos/${id}/arquivos` : `/admin/cursos/${id}/conteudo`);
    }
    if (tipo === 'download') return flashBack(req, res, 'success', 'Produto criado. Agora envie os arquivos que o comprador vai baixar.', `/admin/cursos/${id}/arquivos`);
    flashBack(req, res, 'success', 'Curso criado. Agora adicione os módulos e as aulas.', `/admin/cursos/${id}/conteudo`);
  });

  r.get('/admin/cursos/:id', async (req, res, next) => {
    const course = await courseOr404(req, next); if (!course) return;
    res.send(views.cursoForm(ctx(req, res), { course }));
  });

  r.post('/admin/cursos/:id', async (req, res, next) => {
    const course = await courseOr404(req, next); if (!course) return;
    const { errors, values } = C.parseCourse(req.body, C.typeOf(course));
    if (!errors.slug && await slugTaken(values.slug, course.id)) errors.slug = 'Já existe um curso com este endereço.';
    if (C.typeOf(course) === 'download' && values.publish && !(await C.productFiles(course.id)).length) errors.publish = 'Este produto ainda não tem arquivos. Envie ao menos um na aba Arquivos antes de publicar.';
    if (Object.keys(errors).length) return res.status(422).send(views.cursoForm(ctx(req, res, { raw: req.body }), { course, values, errors }));
    const v = saveValues(values, course);
    await db.q(`UPDATE courses SET ${COLS.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1`, [course.id, ...COLS.map((c) => colVal(v, c))]);
    const wasPublished = course.status === 'published';
    await audit(req, wasPublished !== (v.status === 'published') ? (v.status === 'published' ? 'course_published' : 'course_unpublished') : 'course_updated', { entity: 'course', entityId: course.id, meta: { slug: v.slug } });
    flashBack(req, res, 'success', C.typeOf(course) === 'download' ? 'Produto salvo.' : 'Curso salvo.', `/admin/cursos/${course.id}`);
  });

  r.post('/admin/cursos/:id/capa', (req, res, next) => files.receive(req, res, (err) => {
    if (err) return flashBack(req, res, 'error', err.message, `/admin/cursos/${req.params.id}`);
    next();
  }, 'cover'), (req, res, next) => sec.requireCsrf(req, res, (e) => { if (e) { files.discard(req.file); return next(e); } next(); }), async (req, res, next) => {
    const course = await courseOr404(req, next); if (!course) { files.discard(req.file); return; }
    try {
      const f = files.validate(req.file, 'cover');
      const id = await db.tx(async (c) => {
        const old = (await c.query('SELECT cover_file_id FROM courses WHERE id = $1 FOR UPDATE', [course.id])).rows[0];
        const fid = await files.store(c, { kind: 'cover', ...f, storage: 'db', userId: req.user.id });
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
    await audit(req, 'course_cover_removed', { entity: 'course', entityId: course.id });
    flashBack(req, res, 'info', 'Capa removida.', `/admin/cursos/${course.id}`);
  });

  r.post('/admin/cursos/:id/excluir', async (req, res, next) => {
    const course = await courseOr404(req, next); if (!course) return;
    const n = (await db.q('SELECT count(*)::int n FROM enrollments WHERE course_id = $1', [course.id])).rows[0].n;
    if (n > 0) return flashBack(req, res, 'error', 'Este curso tem alunos matriculados e não pode ser excluído. Para tirá-lo da vitrine, deixe-o como rascunho.', `/admin/cursos/${course.id}`);
    const k = (await db.q('SELECT count(*)::int n FROM coupon_courses WHERE course_id = $1', [course.id])).rows[0].n;
    if (k > 0) return flashBack(req, res, 'error', 'Este curso está ligado a cupons, que ficam guardados no histórico, e não pode ser excluído. Para tirá-lo da vitrine, deixe-o como rascunho.', `/admin/cursos/${course.id}`);
    try {
      await db.tx(async (c) => {
        await c.query('DELETE FROM files WHERE id IN (SELECT lf.file_id FROM lesson_files lf JOIN lessons l ON l.id = lf.lesson_id WHERE l.course_id = $1)', [course.id]);
        await c.query('DELETE FROM files WHERE id IN (SELECT file_id FROM product_files WHERE product_id = $1)', [course.id]);
        await c.query('DELETE FROM courses WHERE id = $1', [course.id]);
        if (course.cover_file_id) await c.query('DELETE FROM files WHERE id = $1', [course.cover_file_id]);
      });
    } catch (e) {
      if (e.code === '23503') return flashBack(req, res, 'error', 'Este curso acabou de ganhar um vínculo (aluno ou cupom) e não pode ser excluído.', `/admin/cursos/${course.id}`);
      throw e;
    }
    files.sweepVolume().catch(() => {});
    await audit(req, 'course_deleted', { entity: 'course', entityId: course.id, meta: { slug: course.slug } });
    flashBack(req, res, 'info', C.typeOf(course) === 'download' ? 'Produto excluído.' : 'Curso excluído.', '/admin/cursos');
  });

  // ---- produto digital: arquivos para baixar ----
  const downloadOr404 = async (req, res, next) => {
    const c = await courseOr404(req, next); if (!c) return null;
    if (C.typeOf(c) !== 'download') { flashBack(req, res, 'info', 'Este cadastro é um curso. Os arquivos ficam dentro das aulas.', `/admin/cursos/${c.id}/conteudo`); return null; }
    return c;
  };
  r.get('/admin/cursos/:id/arquivos', async (req, res, next) => {
    const course = await downloadOr404(req, res, next); if (!course) return;
    const items = await C.productFiles(course.id);
    const buyers = (await db.q("SELECT count(*)::int n FROM enrollments WHERE course_id = $1 AND status = 'active' AND (expires_at IS NULL OR expires_at > now())", [course.id])).rows[0].n;
    res.send(views.produtoArquivos(ctx(req, res), { course, items, buyers }));
  });
  r.post('/admin/cursos/:id/arquivos', async (req, res, next) => {
    if (!ID.test(req.params.id)) return next();
    const p0 = (await db.q("SELECT id FROM courses WHERE id = $1 AND product_type = 'download'", [req.params.id])).rows[0];
    if (!p0) return next();
    const to = `/admin/cursos/${p0.id}/arquivos`;
    files.receive(req, res, (err) => {
      if (err) return flashBack(req, res, 'error', err.message, to);
      sec.requireCsrf(req, res, async (e2) => {
        if (e2) { files.discard(req.file); return next(e2); }
        try {
          const f = files.validate(req.file, 'product');
          const storage = files.chooseStorage(req.body.armazenamento, f.size, 'product');
          const label = title(req.body.label) || f.filename.replace(/\.[^.]+$/, '');
          await db.tx(async (c) => {
            const fid = await files.store(c, { kind: 'product', ...f, storage, userId: req.user.id });
            await c.query('INSERT INTO product_files (product_id, file_id, label, position) VALUES ($1,$2,$3,(SELECT COALESCE(max(position),0)+1 FROM product_files WHERE product_id = $1))', [p0.id, fid, label]);
            await c.query('UPDATE courses SET files_updated_at = now(), updated_at = now() WHERE id = $1', [p0.id]);
          });
          await audit(req, 'file_uploaded', { entity: 'course', entityId: p0.id, meta: { filename: f.filename, storage, bytes: f.size } });
          flashBack(req, res, 'success', storage === 'volume' ? 'Arquivo enviado para o volume.' : 'Arquivo enviado para o banco de dados.', to);
        } catch (e) {
          files.discard(req.file);
          if (e instanceof files.UploadError) return flashBack(req, res, 'error', e.message, to);
          next(e);
        }
      });
    });
  });
  // Aviso de novidade para quem tem acesso (curso ou produto). Campainha sempre; e-mail só se marcado. O token do formulário impede envio duplo.
  r.post('/admin/cursos/:id/avisar', async (req, res, next) => {
    const course = await courseOr404(req, next); if (!course) return;
    const isDl = C.typeOf(course) === 'download';
    const to = req.body.to === 'arquivos' && isDl ? `/admin/cursos/${course.id}/arquivos` : `/admin/cursos/${course.id}/matriculas`;
    const message = String(req.body.message || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (message.length < 5) return flashBack(req, res, 'error', 'Escreva em uma frase o que há de novo (pelo menos 5 letras).', to);
    if (!/^[a-f0-9]{8,32}$/.test(String(req.body.token || ''))) return flashBack(req, res, 'error', 'O formulário expirou. Tente de novo.', to);
    const key = `news:${course.id}:${req.body.token}`;
    const withEmail = req.body.email === '1';
    const people = (await db.q(`SELECT u.id, u.name, u.email FROM enrollments e JOIN users u ON u.id = e.user_id
      WHERE e.course_id = $1 AND e.status = 'active' AND e.starts_at <= now() AND (e.expires_at IS NULL OR e.expires_at > now()) AND u.status = 'active' AND u.role = 'student'`, [course.id])).rows;
    let n = 0;
    for (const u of people) {
      const id = await notify.add(u.id, { kind: 'update', title: `Novidade: ${course.title}`, body: message, link: `/curso/${course.slug}`, key });
      if (id) { n++; if (withEmail) h.background(mailer.send(cfg, { to: u.email, ...emails.courseNews(cfg, { name: u.name, course, message }) })); }
    }
    await audit(req, 'course_news_announced', { entity: 'course', entityId: course.id, meta: { avisados: n, email: withEmail } });
    flashBack(req, res, n ? 'success' : 'info', n ? `${n} ${n === 1 ? 'pessoa avisada' : 'pessoas avisadas'} na campainha${withEmail ? ' e por e-mail' : ''}.` : 'Ninguém foi avisado: não há pessoas com acesso, ou este aviso já foi enviado.', to);
  });

  // ---- módulos e aulas ----
  r.get('/admin/cursos/:id/conteudo', async (req, res, next) => {
    const course = await courseOr404(req, next); if (!course) return;
    const cur = await C.curriculum(course.id, { withVideo: true, withFiles: true, all: true });
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
    await audit(req, 'module_renamed', { entity: 'course', entityId: m.course_id });
    flashBack(req, res, 'success', 'Módulo renomeado.', back(m.course_id));
  });
  r.post('/admin/modulos/:id/mover', async (req, res, next) => {
    const m = await moduleOr404(req, next); if (!m) return;
    await moveIn('modules', 'course_id', m.course_id, m.id, req.body.dir === 'up' ? 'up' : 'down');
    await audit(req, 'module_moved', { entity: 'course', entityId: m.course_id });
    res.redirect(303, back(m.course_id));
  });
  r.post('/admin/modulos/:id/excluir', async (req, res, next) => {
    const m = await moduleOr404(req, next); if (!m) return;
    const ok = await db.tx(async (c) => {
      await c.query('SELECT id FROM lessons WHERE module_id = $1 FOR UPDATE', [m.id]);
      const used = (await c.query('SELECT count(*)::int n FROM lesson_progress p JOIN lessons l ON l.id = p.lesson_id WHERE l.module_id = $1', [m.id])).rows[0].n;
      if (used > 0) return false;
      await c.query('DELETE FROM files WHERE id IN (SELECT lf.file_id FROM lesson_files lf JOIN lessons l ON l.id = lf.lesson_id WHERE l.module_id = $1)', [m.id]);
      await c.query('DELETE FROM modules WHERE id = $1', [m.id]);
      return true;
    }).catch((e) => { if (e.code === '23503') return false; throw e; });
    if (!ok) return flashBack(req, res, 'error', 'Alunos já fizeram aulas ou o quiz deste módulo, então ele não pode ser excluído. Use Inativar: ele some para os alunos e o histórico fica guardado.', back(m.course_id));
    await audit(req, 'module_deleted', { entity: 'course', entityId: m.course_id });
    flashBack(req, res, 'info', 'Módulo excluído.', back(m.course_id));
  });
  r.post('/admin/modulos/:id/inativar', async (req, res, next) => {
    const m = await moduleOr404(req, next); if (!m) return;
    await db.q('UPDATE modules SET active = FALSE WHERE id = $1', [m.id]);
    await audit(req, 'module_inactivated', { entity: 'course', entityId: m.course_id });
    flashBack(req, res, 'info', 'Módulo inativado. Os alunos não o veem mais.', back(m.course_id));
  });
  r.post('/admin/modulos/:id/reativar', async (req, res, next) => {
    const m = await moduleOr404(req, next); if (!m) return;
    await db.q('UPDATE modules SET active = TRUE WHERE id = $1', [m.id]);
    await audit(req, 'module_reactivated', { entity: 'course', entityId: m.course_id });
    flashBack(req, res, 'success', 'Módulo reativado.', back(m.course_id));
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
    await audit(req, 'lesson_moved', { entity: 'lesson', entityId: l.id });
    res.redirect(303, back(l.course_id));
  });
  r.post('/admin/aulas/:id/excluir', async (req, res, next) => {
    const l = await lessonOr404(req, next); if (!l) return;
    const ok = await db.tx(async (c) => {
      await c.query('SELECT id FROM lessons WHERE id = $1 FOR UPDATE', [l.id]);
      const used = (await c.query('SELECT count(*)::int n FROM lesson_progress WHERE lesson_id = $1', [l.id])).rows[0].n;
      if (used > 0) return false;
      await c.query('DELETE FROM files WHERE id IN (SELECT file_id FROM lesson_files WHERE lesson_id = $1)', [l.id]);
      await c.query('DELETE FROM lessons WHERE id = $1', [l.id]);
      return true;
    }).catch((e) => { if (e.code === '23503') return false; throw e; });
    if (!ok) return flashBack(req, res, 'error', 'Alunos já concluíram esta aula, então ela não pode ser excluída. Use Inativar: ela some para os alunos e o histórico fica guardado.', back(l.course_id));
    await audit(req, 'lesson_deleted', { entity: 'course', entityId: l.course_id });
    flashBack(req, res, 'info', 'Aula excluída.', back(l.course_id));
  });

  r.post('/admin/aulas/:id/inativar', async (req, res, next) => {
    const l = await lessonOr404(req, next); if (!l) return;
    await db.q('UPDATE lessons SET active = FALSE, updated_at = now() WHERE id = $1', [l.id]);
    await audit(req, 'lesson_inactivated', { entity: 'lesson', entityId: l.id });
    flashBack(req, res, 'info', 'Aula inativada. Os alunos não a veem mais.', back(l.course_id));
  });
  r.post('/admin/aulas/:id/reativar', async (req, res, next) => {
    const l = await lessonOr404(req, next); if (!l) return;
    await db.q('UPDATE lessons SET active = TRUE, updated_at = now() WHERE id = $1', [l.id]);
    await audit(req, 'lesson_reactivated', { entity: 'lesson', entityId: l.id });
    flashBack(req, res, 'success', 'Aula reativada.', back(l.course_id));
  });
  r.post('/admin/aulas/:id/arquivos', async (req, res, next) => {
    // o corpo multipart só é lido depois de confirmar que a aula existe
    if (!ID.test(req.params.id)) return next();
    const l0 = (await db.q('SELECT course_id FROM lessons WHERE id = $1', [req.params.id])).rows[0];
    if (!l0) return next();
    files.receive(req, res, (err) => {
      if (err) return flashBack(req, res, 'error', err.message, back(l0.course_id));
      sec.requireCsrf(req, res, async (e2) => {
        if (e2) { files.discard(req.file); return next(e2); }
        try {
          const f = files.validate(req.file, 'doc');
          const storage = files.chooseStorage(req.body.armazenamento, f.size, 'doc');
          const label = title(req.body.label) || f.filename.replace(/\.[^.]+$/, '');
          await db.tx(async (c) => {
            const fid = await files.store(c, { kind: 'doc', ...f, storage, userId: req.user.id });
            await c.query('INSERT INTO lesson_files (lesson_id, file_id, label, position) VALUES ($1,$2,$3,(SELECT COALESCE(max(position),0)+1 FROM lesson_files WHERE lesson_id = $1))', [req.params.id, fid, label]);
          });
          await audit(req, 'file_uploaded', { entity: 'lesson', entityId: req.params.id, meta: { filename: f.filename } });
          flashBack(req, res, 'success', storage === 'volume' ? 'Arquivo enviado para o volume.' : 'Arquivo enviado.', back(l0.course_id));
        } catch (e) {
          files.discard(req.file);
          if (e instanceof files.UploadError) return flashBack(req, res, 'error', e.message, back(l0.course_id));
          next(e);
        }
      });
    });
  });
  r.post('/admin/arquivos/:id/excluir', async (req, res, next) => {
    if (!ID.test(req.params.id)) return next();
    const row = (await db.q('SELECT l.course_id FROM lesson_files lf JOIN lessons l ON l.id = lf.lesson_id WHERE lf.file_id = $1', [req.params.id])).rows[0];
    const prod = row ? null : (await db.q('SELECT product_id FROM product_files WHERE file_id = $1', [req.params.id])).rows[0];
    if (!row && !prod) return next();
    await db.q('DELETE FROM files WHERE id = $1', [req.params.id]);
    if (prod) await db.q('UPDATE courses SET files_updated_at = now() WHERE id = $1', [prod.product_id]);
    files.sweepVolume().catch(() => {});
    await audit(req, 'file_deleted', { entity: 'file', entityId: req.params.id });
    let note = 'Arquivo removido.';
    if (prod) {
      const left = (await db.q('SELECT count(*)::int AS n FROM product_files WHERE product_id = $1', [prod.product_id])).rows[0].n;
      const buyers = (await db.q("SELECT count(*)::int AS n FROM enrollments WHERE course_id = $1 AND status = 'active' AND (expires_at IS NULL OR expires_at > now())", [prod.product_id])).rows[0].n;
      if (!left) {
        // sem arquivos, o produto não pode continuar à venda
        const was = await db.q("UPDATE courses SET status = 'draft', updated_at = now() WHERE id = $1 AND status = 'published' RETURNING id", [prod.product_id]);
        note = `Arquivo removido.${was.rowCount ? ' O produto ficou sem arquivos e voltou para rascunho (saiu da vitrine).' : ''}${buyers ? ` Atenção: ${buyers} ${buyers === 1 ? 'pessoa tem' : 'pessoas têm'} acesso e não verá arquivos. Envie um novo arquivo.` : ''}`;
      }
    }
    flashBack(req, res, 'info', note, prod ? `/admin/cursos/${prod.product_id}/arquivos` : back(row.course_id));
  });

  // ---- matrículas (liberação manual) ----
  const enrollRows = async (courseId) => (await db.q(`
    SELECT e.id, e.expires_at, e.status, e.origin, (e.expires_at IS NOT NULL AND e.expires_at <= now()) AS expired, u.name, u.email,
      (SELECT count(*)::int FROM lessons l WHERE l.course_id = e.course_id AND ${C.LIVE}) AS total,
      (SELECT count(*)::int FROM lesson_progress p JOIN lessons l ON l.id = p.lesson_id WHERE p.user_id = e.user_id AND l.course_id = e.course_id AND ${C.LIVE}) AS done,
      (SELECT count(*)::int FROM lesson_progress p JOIN lessons l ON l.id = p.lesson_id WHERE p.user_id = e.user_id AND l.course_id = e.course_id) AS any_progress
    FROM enrollments e JOIN users u ON u.id = e.user_id WHERE e.course_id = $1 ORDER BY e.created_at DESC`, [courseId])).rows;

  r.get('/admin/cursos/:id/matriculas', async (req, res, next) => {
    const course = await courseOr404(req, next); if (!course) return;
    res.send(views.matriculas(ctx(req, res), { course, rows: await enrollRows(course.id) }));
  });

  r.post('/admin/cursos/:id/matriculas', async (req, res, next) => {
    const course = await courseOr404(req, next); if (!course) return;
    const render = async (status, extra) => res.status(status).send(views.matriculas(ctx(req, res), { course, rows: await enrollRows(course.id), ...extra }));
    const checked = await access.check(req.body);
    if (Object.keys(checked.errors).length) return render(422, { errors: checked.errors, email: String(req.body.email || '').slice(0, 254) });
    const out = await access.grant(cfg, h, req, { course, checked, origin: 'manual' });
    if (out.conflict) return render(409, { errors: { email: 'Este e-mail acabou de ser cadastrado. Tente liberar o acesso de novo.' }, email: checked.email });
    if (out.password) return render(200, { created: { email: out.user.email, password: out.password, newUser: true } });
    return render(200, { created: { email: out.user.email, newUser: false, already: out.already } });
  });

  // Onde voltar depois de agir sobre uma matrícula (a tela de cortesias ou a do curso).
  const enrollBack = (req, courseId) => (req.body.to === 'cortesias' ? '/admin/cortesias' : `/admin/cursos/${courseId}/matriculas`);
  const enrollment = async (req, next) => {
    if (!ID.test(req.params.id)) { next(); return null; }
    const e = (await db.q('SELECT * FROM enrollments WHERE id = $1', [req.params.id])).rows[0];
    if (!e) { next(); return null; } return e;
  };
  r.post('/admin/matriculas/:id/cancelar', async (req, res, next) => {
    const e = await enrollment(req, next); if (!e) return;
    await db.tx(async (c) => {
      await c.query("UPDATE enrollments SET status = 'cancelled', cancelled_at = now() WHERE id = $1", [e.id]);
      await require('./downloads').resetFor(c, e.user_id, e.course_id);
    });
    await audit(req, 'enrollment_cancelled', { entity: 'course', entityId: e.course_id, meta: { user: e.user_id } });
    // Reembolso/estorno/fraude: o certificado deixa de valer (a página pública passa a mostrar "cancelado").
    const revoked = await certs.revokeFor(e.user_id, e.course_id, 'Matrícula cancelada');
    if (revoked) await audit(req, 'certificate_revoked', { entity: 'course', entityId: e.course_id, meta: { user: e.user_id, reason: 'Matrícula cancelada' } });
    flashBack(req, res, 'info', revoked ? 'Acesso cancelado. O certificado do aluno neste curso foi revogado. Para restabelecê-lo, use Certificados.' : 'Acesso cancelado. A matrícula continua no histórico.', enrollBack(req, e.course_id));
  });
  r.post('/admin/matriculas/:id/reativar', async (req, res, next) => {
    const e = await enrollment(req, next); if (!e) return;
    await db.q("UPDATE enrollments SET status = 'active', cancelled_at = NULL WHERE id = $1", [e.id]);
    await audit(req, 'enrollment_reactivated', { entity: 'course', entityId: e.course_id, meta: { user: e.user_id } });
    const rv = (await db.q("SELECT 1 FROM certificates WHERE user_id = $1 AND course_id = $2 AND status = 'revoked'", [e.user_id, e.course_id])).rowCount;
    flashBack(req, res, 'success', rv ? 'Acesso reativado. O certificado continua revogado: para restabelecê-lo, use Certificados.' : 'Acesso reativado.', enrollBack(req, e.course_id));
  });
  // Excluir só vale para matrícula sem nenhuma aula feita (criada por engano). Com histórico, cancele.
  r.post('/admin/matriculas/:id/excluir', async (req, res, next) => {
    const e = await enrollment(req, next); if (!e) return;
    const ok = await db.tx(async (c) => {
      await c.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [e.user_id]);
      const used = (await c.query(`SELECT (SELECT count(*) FROM lesson_progress p JOIN lessons l ON l.id = p.lesson_id WHERE p.user_id = $1 AND l.course_id = $2)
        + (SELECT count(*) FROM assessment_attempts t JOIN assessments a ON a.id = t.assessment_id WHERE t.user_id = $1 AND a.course_id = $2)
        + (SELECT count(*) FROM certificates WHERE user_id = $1 AND course_id = $2) AS n`, [e.user_id, e.course_id])).rows[0].n;
      const paid = (await c.query("SELECT (SELECT count(*) FROM coupon_redemptions WHERE user_id = $1 AND course_id = $2) + (SELECT count(*) FROM enrollments WHERE id = $3 AND origin = 'purchase') AS n", [e.user_id, e.course_id, e.id])).rows[0].n;
      if (used > 0 || Number(paid) > 0) return false;
      await c.query('DELETE FROM lesson_watch WHERE user_id = $1 AND lesson_id IN (SELECT id FROM lessons WHERE course_id = $2)', [e.user_id, e.course_id]);
      await c.query('DELETE FROM attempt_grants WHERE user_id = $1 AND assessment_id IN (SELECT id FROM assessments WHERE course_id = $2)', [e.user_id, e.course_id]);
      await c.query('DELETE FROM exam_unlocks WHERE user_id = $1 AND assessment_id IN (SELECT id FROM assessments WHERE course_id = $2)', [e.user_id, e.course_id]);
      await c.query('DELETE FROM enrollments WHERE id = $1', [e.id]);
      return true;
    });
    if (!ok) return flashBack(req, res, 'error', 'Esta matrícula tem histórico (aulas feitas ou compra) e não pode ser excluída. Use Cancelar acesso: o histórico fica guardado.', enrollBack(req, e.course_id));
    await audit(req, 'enrollment_removed', { entity: 'course', entityId: e.course_id, meta: { user: e.user_id } });
    flashBack(req, res, 'info', 'Matrícula excluída.', enrollBack(req, e.course_id));
  });

  return r;
}
module.exports = { build };
