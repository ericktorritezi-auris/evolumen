'use strict';
// Painel do administrador: afiliados, comissões e repasses (1.1.1).
const express = require('express');
const db = require('./db');
const A = require('./affiliates');
const C = require('./courses');
const L = require('./lgpd');
const { audit } = require('./audit');
const views = require('./views/affiliates');

const ID = /^\d{1,12}$/;
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

function build(cfg, h) {
  const r = express.Router();
  r.use('/admin/afiliados', h.needUser, h.gate, h.needAdmin);
  const ctx = (req, res) => ({ ...h.appCtx(req, res) });
  const flashBack = (req, res, type, text, to) => { h.setFlash(res, type, text); res.redirect(303, to); };
  const load = async (req, next) => { const a = ID.test(String(req.params.id)) ? await A.detail(req.params.id) : null; if (!a) { next(); return null; } return a; };

  r.get('/admin/afiliados', async (req, res) => res.send(views.cockpit(ctx(req, res), await A.list())));

  r.get('/admin/afiliados/novo', (req, res) => res.send(views.form(ctx(req, res), {})));

  r.post('/admin/afiliados', async (req, res) => {
    const { errors, values } = A.parse(req.body);
    if (!errors.email && await A.emailTaken(values.email)) errors.email = 'Já existe um afiliado com este e-mail.';
    if (Object.keys(errors).length) return res.status(422).send(views.form(ctx(req, res), { values: { ...req.body, phone: values.phone }, errors }));
    let id;
    try {
      id = (await db.q('INSERT INTO affiliates (name, email, phone, note, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id', [values.name, values.email, values.phone, values.note, req.user.id])).rows[0].id;
    } catch (e) {
      if (e.code !== '23505') throw e;
      return res.status(422).send(views.form(ctx(req, res), { values: { ...req.body, phone: values.phone }, errors: { email: 'Já existe um afiliado com este e-mail.' } }));
    }
    await audit(req, 'affiliate_created', { entity: 'affiliate', entityId: id });
    flashBack(req, res, 'success', 'Afiliado cadastrado. Agora escolha-o em um cupom para ele receber comissão.', `/admin/afiliados/${id}`);
  });

  // CSV antes de :id para não ser confundido com um afiliado
  r.get('/admin/afiliados/vendas.csv', async (req, res) => {
    const rows = await A.salesAll();
    await audit(req, 'affiliate_csv_exported', { entity: 'affiliate', meta: { linhas: rows.length } });
    res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', 'attachment; filename="afiliados-vendas-evolumen.csv"').set('Cache-Control', 'private, no-store').send(A.csv(rows, L.csvCell, { withAffiliate: true }));
  });

  const render = async (req, res, a, extra = {}, status = 200) => res.status(status).send(views.detail(ctx(req, res), {
    a, sales: await A.salesOf(a.id), payouts: await A.payoutsOf(a.id), coupons: await A.couponsOf(a.id), today: today(), ...extra }));

  r.get('/admin/afiliados/:id', async (req, res, next) => { const a = await load(req, next); if (a) await render(req, res, a); });

  r.get('/admin/afiliados/:id/vendas.csv', async (req, res, next) => {
    const a = await load(req, next); if (!a) return;
    const rows = await A.salesOf(a.id, 5000);
    await audit(req, 'affiliate_csv_exported', { entity: 'affiliate', entityId: a.id, meta: { linhas: rows.length } });
    const slug = C.slugify(a.name) || 'afiliado';
    res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="vendas-${slug}.csv"`).set('Cache-Control', 'private, no-store').send(A.csv(rows, L.csvCell));
  });

  r.post('/admin/afiliados/:id', async (req, res, next) => {
    const a = await load(req, next); if (!a) return;
    const { errors, values } = A.parse(req.body);
    if (!errors.email && await A.emailTaken(values.email, a.id)) errors.email = 'Já existe outro afiliado com este e-mail.';
    if (Object.keys(errors).length) return render(req, res, a, { errors, values: { ...req.body, phone: values.phone } }, 422);
    try {
      await db.q('UPDATE affiliates SET name = $2, email = $3, phone = $4, note = $5, updated_at = now() WHERE id = $1', [a.id, values.name, values.email, values.phone, values.note]);
    } catch (e) {
      if (e.code !== '23505') throw e;
      return render(req, res, a, { errors: { email: 'Já existe outro afiliado com este e-mail.' }, values: { ...req.body, phone: values.phone } }, 422);
    }
    await audit(req, 'affiliate_updated', { entity: 'affiliate', entityId: a.id });
    flashBack(req, res, 'success', 'Dados salvos.', `/admin/afiliados/${a.id}`);
  });

  r.post('/admin/afiliados/:id/inativar', async (req, res, next) => {
    const a = await load(req, next); if (!a) return;
    await db.q("UPDATE affiliates SET status = 'inactive', inactivated_at = now(), updated_at = now() WHERE id = $1 AND status = 'active'", [a.id]);
    await audit(req, 'affiliate_inactivated', { entity: 'affiliate', entityId: a.id });
    flashBack(req, res, 'info', 'Afiliado inativado. Vendas novas não geram comissão; o histórico fica guardado.', `/admin/afiliados/${a.id}`);
  });
  r.post('/admin/afiliados/:id/reativar', async (req, res, next) => {
    const a = await load(req, next); if (!a) return;
    await db.q("UPDATE affiliates SET status = 'active', inactivated_at = NULL, updated_at = now() WHERE id = $1 AND status = 'inactive'", [a.id]);
    await audit(req, 'affiliate_reactivated', { entity: 'affiliate', entityId: a.id });
    flashBack(req, res, 'success', 'Afiliado reativado.', `/admin/afiliados/${a.id}`);
  });

  // ---------- repasses ----------
  r.post('/admin/afiliados/:id/repasses', async (req, res, next) => {
    const a = await load(req, next); if (!a) return;
    const { errors, values } = A.parsePayout(req.body, today());
    if (Object.keys(errors).length) return render(req, res, a, { payErrors: errors, payValues: { amount: String(req.body.amount || ''), paid_on: String(req.body.paid_on || ''), note: String(req.body.note || '') } }, 422);
    // Duplo clique ou reenvio do formulário: o mesmo repasse (valor, data e quem lançou) nos últimos 30 segundos não grava de novo.
    const dupe = (await db.q("SELECT 1 FROM affiliate_payouts WHERE affiliate_id = $1 AND amount_cents = $2 AND paid_on = $3 AND created_by = $4 AND voided_at IS NULL AND created_at > now() - interval '30 seconds'", [a.id, values.cents, values.paid_on, req.user.id])).rowCount;
    if (dupe) return flashBack(req, res, 'info', 'Este repasse acabou de ser registrado. Não gravei de novo.', `/admin/afiliados/${a.id}`);
    const p = (await db.q('INSERT INTO affiliate_payouts (affiliate_id, amount_cents, paid_on, note, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id', [a.id, values.cents, values.paid_on, values.note, req.user.id])).rows[0];
    await audit(req, 'affiliate_payout_recorded', { entity: 'affiliate', entityId: a.id, meta: { payout: p.id, valor: values.cents, data: values.paid_on } });
    const over = values.cents > a.balance;
    flashBack(req, res, over ? 'info' : 'success', over ? `Repasse registrado. Atenção: o valor é maior que o saldo liberado (${C.brl(Math.max(0, a.balance))}), então o saldo ficou negativo.` : 'Repasse registrado.', `/admin/afiliados/${a.id}`);
  });

  r.post('/admin/afiliados/:id/repasses/:pid/anular', async (req, res, next) => {
    const a = await load(req, next); if (!a) return;
    const back = `/admin/afiliados/${a.id}`;
    const reason = String(req.body.reason || '').trim().slice(0, 200);
    if (!reason) return flashBack(req, res, 'error', 'Informe o motivo da anulação.', back);
    const p = ID.test(String(req.params.pid)) ? (await db.q('UPDATE affiliate_payouts SET voided_at = now(), voided_by = $3, void_reason = $4 WHERE id = $1 AND affiliate_id = $2 AND voided_at IS NULL RETURNING id, amount_cents', [req.params.pid, a.id, req.user.id, reason])).rows[0] : null;
    if (!p) return flashBack(req, res, 'error', 'Repasse não encontrado ou já anulado.', back);
    await audit(req, 'affiliate_payout_voided', { entity: 'affiliate', entityId: a.id, meta: { payout: p.id, valor: p.amount_cents, motivo: reason } });
    flashBack(req, res, 'info', 'Repasse anulado. Ele sai do saldo e continua no histórico.', back);
  });

  return r;
}

module.exports = { build };
