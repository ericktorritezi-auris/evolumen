'use strict';
// Painel do administrador (Fase 3): quiz, prova final, questões, tentativas extras e certificados.
const express = require('express');
const db = require('./db');
const C = require('./courses');
const A = require('./assess');
const certs = require('./certificates');
const { audit } = require('./audit');
const views = require('./views/assessadm');

const ID = /^\d{1,12}$/;
const PAGE = 30;
const err = (msg, status = 400) => { const e = new Error(msg); e.status = status; e.expose = true; return e; };

function build(cfg, h) {
  const r = express.Router();
  r.use(['/admin/avaliacoes', '/admin/questoes', '/admin/certificados', '/admin/cursos/:id/avaliacoes', '/admin/cursos/:id/certificado', '/admin/cursos/:id/certificado-exemplo.pdf'], h.needUser, h.gate, h.needAdmin);
  const ctx = (req, res, extra = {}) => ({ ...h.appCtx(req, res), ...extra });
  const flashBack = (req, res, type, text, to) => { h.setFlash(res, type, text); res.redirect(303, to); };
  const courseOr404 = async (req, next) => { const c = await C.byId(req.params.id); if (!c) { next(); return null; } return c; };

  // ---------- aba do curso ----------
  async function courseTab(req, res, course, extra = {}) {
    const cur = await C.curriculum(course.id);
    return views.courseTab(ctx(req, res), { course, cur, asm: await A.ofCourse(course.id), ...extra });
  }
  r.get('/admin/cursos/:id/avaliacoes', async (req, res, next) => {
    const course = await courseOr404(req, next); if (!course) return;
    res.send(await courseTab(req, res, course));
  });

  r.post('/admin/cursos/:id/avaliacoes', async (req, res, next) => {
    const course = await courseOr404(req, next); if (!course) return;
    const back = `/admin/cursos/${course.id}/avaliacoes`;
    const kind = req.body.kind === 'final' ? 'final' : 'quiz';
    let mod = null;
    if (kind === 'quiz') {
      if (!ID.test(String(req.body.module_id || ''))) return flashBack(req, res, 'error', 'Escolha o módulo.', back);
      mod = (await db.q('SELECT * FROM modules WHERE id = $1 AND course_id = $2', [req.body.module_id, course.id])).rows[0];
      if (!mod) return flashBack(req, res, 'error', 'Módulo não encontrado.', back);
    }
    try {
      const a = (await db.q('INSERT INTO assessments (course_id, module_id, kind, title) VALUES ($1,$2,$3,$4) RETURNING *', [course.id, mod ? mod.id : null, kind, mod ? mod.title : 'Prova final'])).rows[0];
      await audit(req, 'assessment_created', { entity: 'assessment', entityId: a.id, meta: { kind, course: course.id } });
      flashBack(req, res, 'success', kind === 'final' ? 'Prova final criada. Agora adicione as questões.' : 'Quiz criado. Agora adicione as questões.', `/admin/avaliacoes/${a.id}`);
    } catch (e) {
      if (e.code === '23505') return flashBack(req, res, 'info', 'Esta avaliação já existe.', back);
      throw e;
    }
  });

  // ---------- certificado do curso ----------
  r.post('/admin/cursos/:id/certificado', async (req, res, next) => {
    const course = await courseOr404(req, next); if (!course) return;
    const errors = {};
    const hoursRaw = String(req.body.cert_hours || '').trim();
    let hours = null;
    if (hoursRaw) { hours = Number(hoursRaw); if (!Number.isInteger(hours) || hours < 1 || hours > 2000) errors.cert_hours = 'Informe horas inteiras, de 1 a 2000.'; }
    const text = String(req.body.cert_text || '').trim().slice(0, 400);
    const signer = String(req.body.cert_signer || '').trim().slice(0, 80);
    const role = String(req.body.cert_signer_role || '').trim().slice(0, 100);
    if (text && !/\{nome\}/.test(text)) errors.cert_text = 'O texto precisa ter {nome}, para o nome do aluno aparecer.';
    if (Object.keys(errors).length) {
      return res.status(422).send(await courseTab(req, res, course, { errors, values: { cert_hours: hoursRaw, cert_text: text, cert_signer: signer, cert_signer_role: role } }));
    }
    await db.q('UPDATE courses SET cert_hours = $2, cert_text = $3, cert_signer = $4, cert_signer_role = $5, updated_at = now() WHERE id = $1', [course.id, hours, text, signer, role]);
    await audit(req, 'certificate_settings_saved', { entity: 'course', entityId: course.id });
    flashBack(req, res, 'success', 'Certificado salvo. Vale para os próximos certificados emitidos.', `/admin/cursos/${course.id}/avaliacoes`);
  });

  r.get('/admin/cursos/:id/certificado-exemplo.pdf', async (req, res, next) => {
    const course = await courseOr404(req, next); if (!course) return;
    const now = new Date();
    const cert = { code: 'EVL-EXEMPLO-0000-0000', student_name: 'Nome do Aluno', course_title: course.title, issued_at: now, signer: course.cert_signer || certs.DEFAULT_SIGNER, signer_role: course.cert_signer_role || certs.DEFAULT_ROLE,
      body_text: certs.fill(course.cert_text, { name: 'Nome do Aluno', course: course.title, hours: course.cert_hours, date: now }) };
    const buf = await certs.pdf(cfg, cert);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Length': buf.length, 'Cache-Control': 'private, no-store', 'Content-Disposition': 'inline; filename="certificado-exemplo.pdf"' });
    res.send(buf);
  });

  // ---------- editor da avaliação ----------
  const attemptsCount = async (id) => (await db.q('SELECT count(*)::int n FROM assessment_attempts WHERE assessment_id = $1', [id])).rows[0].n;
  async function load(req, next) { const a = await A.byId(req.params.id); if (!a) { next(); return null; } return a; }

  r.get('/admin/avaliacoes/:id', async (req, res, next) => {
    const a = await load(req, next); if (!a) return;
    const course = await C.byId(a.course_id);
    const mod = a.module_id ? (await db.q('SELECT * FROM modules WHERE id = $1', [a.module_id])).rows[0] : null;
    res.send(views.editor(ctx(req, res), { a, course, module: mod, questions: await A.questions(a.id, { all: true }), attempts: await attemptsCount(a.id) }));
  });

  r.post('/admin/avaliacoes/:id', async (req, res, next) => {
    const a = await load(req, next); if (!a) return;
    const errors = {};
    const psRaw = String(req.body.pass_score || '').trim().replace(',', '.');
    const ps = Number(psRaw);
    if (!/^\d{1,2}(\.\d)?$/.test(psRaw) || !(ps > 0 && ps <= 10)) errors.pass_score = 'Informe a nota mínima de 0,1 a 10, com no máximo uma casa decimal (ex.: 7 ou 7,5).';
    const ma = Number(req.body.max_attempts);
    if (!Number.isInteger(ma) || ma < 1 || ma > 10) errors.max_attempts = 'Informe de 1 a 10 tentativas.';
    if (Object.keys(errors).length) {
      const course = await C.byId(a.course_id);
      const mod = a.module_id ? (await db.q('SELECT * FROM modules WHERE id = $1', [a.module_id])).rows[0] : null;
      return res.status(422).send(views.editor(ctx(req, res), { a: { ...a, title: String(req.body.title || ''), pass_score: req.body.pass_score, max_attempts: req.body.max_attempts, active: req.body.active === '1' }, course, module: mod, questions: await A.questions(a.id, { all: true }), attempts: await attemptsCount(a.id), errors }));
    }
    await db.q('UPDATE assessments SET title = $2, pass_score = $3, max_attempts = $4, active = $5, updated_at = now() WHERE id = $1', [a.id, String(req.body.title || '').trim().slice(0, 80), Math.round(ps * 10) / 10, ma, req.body.active !== '0']);
    await audit(req, 'assessment_updated', { entity: 'assessment', entityId: a.id });
    flashBack(req, res, 'success', 'Configuração salva.', `/admin/avaliacoes/${a.id}`);
  });

  r.post('/admin/avaliacoes/:id/excluir', async (req, res, next) => {
    const a = await load(req, next); if (!a) return;
    const ok = await db.tx(async (c) => {
      await c.query('SELECT id FROM assessments WHERE id = $1 FOR UPDATE', [a.id]);
      if ((await c.query('SELECT count(*)::int n FROM assessment_attempts WHERE assessment_id = $1', [a.id])).rows[0].n > 0) return false;
      await c.query('DELETE FROM assessments WHERE id = $1', [a.id]); return true;
    }).catch((e) => { if (e.code === '23503') return false; throw e; });
    if (!ok) return flashBack(req, res, 'error', 'Alunos já fizeram tentativas e a avaliação não pode ser excluída. Deixe-a inativa.', `/admin/avaliacoes/${a.id}`);
    await audit(req, 'assessment_deleted', { entity: 'course', entityId: a.course_id, meta: { kind: a.kind } });
    flashBack(req, res, 'info', 'Avaliação excluída.', `/admin/cursos/${a.course_id}/avaliacoes`);
  });

  // ---------- questões ----------
  // Lê o formulário de uma questão e devolve { body, kind, explanation, options: [{id?, body, correct}] } ou lança erro.
  function parseQuestion(b, existing) {
    const kind = existing ? existing.kind : (b.kind === 'truefalse' ? 'truefalse' : 'single');
    const body = String(b.body || '').trim().slice(0, 800);
    if (!body) throw err('Escreva o enunciado da questão.');
    const explanation = String(b.explanation || '').trim().slice(0, 600);
    if (kind === 'truefalse') {
      if (!['v', 'f'].includes(b.tf)) throw err('Marque se a resposta certa é Verdadeiro ou Falso.');
      return { body, kind, explanation, options: [{ body: 'Verdadeiro', correct: b.tf === 'v' }, { body: 'Falso', correct: b.tf === 'f' }] };
    }
    const opts = [];
    for (let i = 0; i < 6; i++) {
      const text = String(b[`opt_${i}`] || '').trim().slice(0, 300);
      const id = ID.test(String(b[`opt_id_${i}`] || '')) ? b[`opt_id_${i}`] : null;
      if (text) opts.push({ id, body: text, correct: String(b.correct) === String(i) });
    }
    if (opts.length < 2) throw err('Escreva pelo menos duas alternativas.');
    if (opts.filter((o) => o.correct).length !== 1) throw err('Marque qual alternativa é a certa (e ela precisa estar preenchida).');
    return { body, kind, explanation, options: opts };
  }

  async function saveOptions(c, qid, options, existing) {
    const keep = new Set();
    let pos = 0;
    // zera a marcação de correta antes de reaplicar (índice único: só uma correta por questão)
    await c.query('UPDATE assessment_options SET correct = FALSE WHERE question_id = $1', [qid]);
    for (const o of options) {
      pos += 1;
      const old = o.id && existing.find((x) => String(x.id) === String(o.id));
      if (old) { await c.query('UPDATE assessment_options SET body = $2, position = $3, correct = $4 WHERE id = $1', [old.id, o.body, pos, o.correct]); keep.add(String(old.id)); }
      else { const ins = await c.query('INSERT INTO assessment_options (question_id, body, position, correct) VALUES ($1,$2,$3,$4) RETURNING id', [qid, o.body, pos, o.correct]); keep.add(String(ins.rows[0].id)); }
    }
    for (const x of existing) if (!keep.has(String(x.id))) await c.query('DELETE FROM assessment_options WHERE id = $1', [x.id]);
  }

  r.post('/admin/avaliacoes/:id/questoes', async (req, res, next) => {
    const a = await load(req, next); if (!a) return;
    const back = `/admin/avaliacoes/${a.id}`;
    let q; try { q = parseQuestion(req.body); } catch (e) { if (e.status === 400) return flashBack(req, res, 'error', e.message, back); throw e; }
    const id = await db.tx(async (c) => {
      const pos = (await c.query('SELECT COALESCE(max(position),0)+1 AS p FROM assessment_questions WHERE assessment_id = $1', [a.id])).rows[0].p;
      const ins = (await c.query('INSERT INTO assessment_questions (assessment_id, position, kind, body, explanation) VALUES ($1,$2,$3,$4,$5) RETURNING id', [a.id, pos, q.kind, q.body, q.explanation])).rows[0];
      await saveOptions(c, ins.id, q.options, []);
      return ins.id;
    });
    await audit(req, 'question_created', { entity: 'assessment', entityId: a.id, meta: { question: id } });
    flashBack(req, res, 'success', 'Questão adicionada.', back);
  });

  async function loadQ(req, next) {
    if (!ID.test(req.params.id)) { next(); return null; }
    const q = (await db.q('SELECT * FROM assessment_questions WHERE id = $1', [req.params.id])).rows[0];
    if (!q) { next(); return null; }
    return q;
  }

  r.post('/admin/questoes/:id', async (req, res, next) => {
    const q = await loadQ(req, next); if (!q) return;
    const back = `/admin/avaliacoes/${q.assessment_id}`;
    let p; try { p = parseQuestion(req.body, q); } catch (e) { if (e.status === 400) return flashBack(req, res, 'error', e.message, back); throw e; }
    await db.tx(async (c) => {
      const existing = (await c.query('SELECT * FROM assessment_options WHERE question_id = $1 ORDER BY position, id', [q.id])).rows;
      await c.query('UPDATE assessment_questions SET body = $2, explanation = $3 WHERE id = $1', [q.id, p.body, p.explanation]);
      if (q.kind === 'truefalse') {
        const [v, f] = existing;
        await c.query('UPDATE assessment_options SET correct = FALSE WHERE question_id = $1', [q.id]);
        await c.query('UPDATE assessment_options SET correct = TRUE WHERE id = $1', [req.body.tf === 'v' ? v.id : f.id]);
      } else await saveOptions(c, q.id, p.options, existing);
    });
    await audit(req, 'question_updated', { entity: 'assessment', entityId: q.assessment_id, meta: { question: q.id } });
    flashBack(req, res, 'success', 'Questão salva.', back);
  });

  r.post('/admin/questoes/:id/mover', async (req, res, next) => {
    const q = await loadQ(req, next); if (!q) return;
    const dir = req.body.dir === 'up' ? 'up' : 'down';
    await db.tx(async (c) => {
      const all = (await c.query('SELECT id FROM assessment_questions WHERE assessment_id = $1 ORDER BY position, id FOR UPDATE', [q.assessment_id])).rows.map((x) => x.id);
      const i = all.indexOf(q.id); const j = dir === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= all.length) return;
      [all[i], all[j]] = [all[j], all[i]];
      for (let k = 0; k < all.length; k++) await c.query('UPDATE assessment_questions SET position = $2 WHERE id = $1', [all[k], k + 1]);
    });
    res.redirect(303, `/admin/avaliacoes/${q.assessment_id}`);
  });
  for (const [path, active, label] of [['inativar', false, 'Questão inativada.'], ['reativar', true, 'Questão reativada.']]) {
    r.post(`/admin/questoes/:id/${path}`, async (req, res, next) => {
      const q = await loadQ(req, next); if (!q) return;
      await db.q('UPDATE assessment_questions SET active = $2 WHERE id = $1', [q.id, active]);
      await audit(req, active ? 'question_reactivated' : 'question_inactivated', { entity: 'assessment', entityId: q.assessment_id, meta: { question: q.id } });
      flashBack(req, res, 'info', label, `/admin/avaliacoes/${q.assessment_id}`);
    });
  }
  r.post('/admin/questoes/:id/excluir', async (req, res, next) => {
    const q = await loadQ(req, next); if (!q) return;
    const back = `/admin/avaliacoes/${q.assessment_id}`;
    const ok = await db.tx(async (c) => {
      await c.query('SELECT id FROM assessments WHERE id = $1 FOR UPDATE', [q.assessment_id]);
      if ((await c.query('SELECT count(*)::int n FROM assessment_attempts WHERE assessment_id = $1', [q.assessment_id])).rows[0].n > 0) return false;
      await c.query('DELETE FROM assessment_questions WHERE id = $1', [q.id]); return true;
    });
    if (!ok) return flashBack(req, res, 'error', 'Já há tentativas: a questão só pode ser inativada.', back);
    await audit(req, 'question_deleted', { entity: 'assessment', entityId: q.assessment_id });
    flashBack(req, res, 'info', 'Questão excluída.', back);
  });

  // ---------- tentativas, tentativa extra e liberação manual ----------
  r.get('/admin/avaliacoes/:id/tentativas', async (req, res, next) => {
    const a = await load(req, next); if (!a) return;
    const course = await C.byId(a.course_id);
    const people = (await db.q(`SELECT u.id AS user_id, u.name, u.email FROM enrollments e JOIN users u ON u.id = e.user_id WHERE e.course_id = $1 AND e.status = 'active' AND u.role = 'student'
      UNION SELECT u.id, u.name, u.email FROM assessment_attempts t JOIN users u ON u.id = t.user_id WHERE t.assessment_id = $2 ORDER BY name LIMIT 300`, [a.course_id, a.id])).rows;
    const rows = [];
    for (const p of people) {
      const s = (await A.attemptStats(p.user_id, [a.id]))[a.id] || { used: 0, best: null, passed: false, extra: 0, manual_unlock: false };
      let unlocked = s.manual_unlock;
      if (a.kind === 'final' && !unlocked) {
        const ov = await A.overview(p.user_id, course);
        unlocked = !!(ov.final && ov.final.unlocked);
      }
      rows.push({ ...p, ...s, limit: a.max_attempts + s.extra, unlocked });
    }
    res.send(views.attemptsPage(ctx(req, res), { a, course, rows }));
  });

  const targetUser = async (req) => (ID.test(String(req.body.user || '')) ? (await db.q("SELECT id, name FROM users WHERE id = $1 AND role = 'student'", [req.body.user])).rows[0] : null);
  r.post('/admin/avaliacoes/:id/extra', async (req, res, next) => {
    const a = await load(req, next); if (!a) return;
    const u = await targetUser(req);
    const back = `/admin/avaliacoes/${a.id}/tentativas`;
    if (!u) return flashBack(req, res, 'error', 'Aluno não encontrado.', back);
    await db.q('INSERT INTO attempt_grants (assessment_id, user_id, extra, granted_by) VALUES ($1,$2,1,$3)', [a.id, u.id, req.user.id]);
    await audit(req, 'attempt_granted', { entity: 'assessment', entityId: a.id, meta: { user: u.id } });
    flashBack(req, res, 'success', `Tentativa extra liberada para ${u.name}.`, back);
  });
  r.post('/admin/avaliacoes/:id/liberar', async (req, res, next) => {
    const a = await load(req, next); if (!a) return;
    const u = await targetUser(req);
    const back = `/admin/avaliacoes/${a.id}/tentativas`;
    if (!u || a.kind !== 'final') return flashBack(req, res, 'error', 'Aluno ou prova não encontrados.', back);
    await db.q('INSERT INTO exam_unlocks (assessment_id, user_id, granted_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [a.id, u.id, req.user.id]);
    await audit(req, 'exam_unlocked', { entity: 'assessment', entityId: a.id, meta: { user: u.id } });
    flashBack(req, res, 'success', `Prova final liberada para ${u.name}.`, back);
  });

  // ---------- certificados ----------
  r.get('/admin/certificados', async (req, res) => {
    const f = { q: String(req.query.q || '').trim().slice(0, 80), curso: ID.test(String(req.query.curso || '')) ? String(req.query.curso) : '', situacao: ['valid', 'revoked'].includes(req.query.situacao) ? req.query.situacao : '' };
    const where = []; const p = [];
    if (f.q) { p.push('%' + f.q.replace(/[\\%_]/g, '\\$&') + '%'); where.push(`(c.student_name ILIKE $${p.length} OR u.email ILIKE $${p.length} OR c.code ILIKE $${p.length})`); }
    if (f.curso) { p.push(f.curso); where.push(`c.course_id = $${p.length}`); }
    if (f.situacao) { p.push(f.situacao); where.push(`c.status = $${p.length}`); }
    const W = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const total = (await db.q(`SELECT count(*)::int n FROM certificates c JOIN users u ON u.id = c.user_id ${W}`, p)).rows[0].n;
    const pages = Math.max(1, Math.ceil(total / PAGE));
    const page = Math.min(pages, Math.max(1, parseInt(req.query.p, 10) || 1));
    const rows = (await db.q(`SELECT c.*, u.email FROM certificates c JOIN users u ON u.id = c.user_id ${W} ORDER BY c.issued_at DESC, c.id DESC LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`, p)).rows;
    const courses = (await db.q('SELECT id, title FROM courses ORDER BY title')).rows;
    res.send(views.certificados(ctx(req, res), { rows, courses, f, page, pages, total }));
  });
  const certOr404 = async (req, next) => { const c = ID.test(req.params.id) ? (await db.q('SELECT * FROM certificates WHERE id = $1', [req.params.id])).rows[0] : null; if (!c) { next(); return null; } return c; };
  r.post('/admin/certificados/:id/revogar', async (req, res, next) => {
    const c = await certOr404(req, next); if (!c) return;
    const reason = String(req.body.reason || '').trim().slice(0, 200);
    if (!reason) return flashBack(req, res, 'error', 'Informe o motivo da revogação.', '/admin/certificados');
    await db.q("UPDATE certificates SET status = 'revoked', revoked_at = now(), revoke_reason = $2 WHERE id = $1 AND status = 'valid'", [c.id, reason]);
    await audit(req, 'certificate_revoked', { entity: 'certificate', entityId: c.id, meta: { code: c.code, reason } });
    flashBack(req, res, 'info', 'Certificado revogado. A página de verificação mostra “cancelado”.', '/admin/certificados');
  });
  r.post('/admin/certificados/:id/restabelecer', async (req, res, next) => {
    const c = await certOr404(req, next); if (!c) return;
    await db.q("UPDATE certificates SET status = 'valid', revoked_at = NULL, revoke_reason = '' WHERE id = $1", [c.id]);
    await audit(req, 'certificate_restored', { entity: 'certificate', entityId: c.id, meta: { code: c.code } });
    flashBack(req, res, 'success', 'Certificado restabelecido.', '/admin/certificados');
  });

  return r;
}
module.exports = { build };
