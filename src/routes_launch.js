'use strict';
// Lançamento: checklist de go-live e reset dos dados de teste (só com ALLOW_LAUNCH_RESET=1).
const express = require('express');
const bcrypt = require('bcryptjs');
const L = require('./launch');
const log = require('./logger');
const { audit } = require('./audit');
const views = require('./views/launch');

function build(cfg, h) {
  const r = express.Router();
  r.use('/admin/lancamento', h.needUser, h.gate, h.needAdmin);
  const ctx = (req, res) => ({ ...h.appCtx(req, res) });
  const render = async (req, res, extra = {}, status = 200) => res.status(status).send(views.page(ctx(req, res), { checklist: await L.checklist(cfg), manual: L.MANUAL, allowed: cfg.allowLaunchReset, ...extra }));
  const off = (req, res) => { h.setFlash(res, 'error', 'O reset de lançamento está desligado neste ambiente.'); res.redirect(303, '/admin/lancamento'); };

  r.get('/admin/lancamento', (req, res) => render(req, res));

  r.post('/admin/lancamento/previa', async (req, res) => {
    if (!cfg.allowLaunchReset) return off(req, res);
    const emails = L.parseEmails(req.body.emails);
    if (!emails.length) return render(req, res, { emails: String(req.body.emails || '').slice(0, 4000), error: 'Informe ao menos um e-mail válido.' }, 422);
    const preview = await L.preview(emails);
    await render(req, res, { emails: emails.join('\n'), preview });
  });

  r.post('/admin/lancamento/executar', h.loginLimit, async (req, res) => {
    if (!cfg.allowLaunchReset) return off(req, res);
    const emails = L.parseEmails(req.body.emails);
    const preview = await L.preview(emails);
    const fail = (error) => render(req, res, { emails: emails.join('\n'), preview, error }, 422);
    const n = preview.students.length;
    if (!n || preview.blocked.length) return fail('Nada a apagar com esta lista.');
    if (preview.pending) return fail('Há pedido aguardando pagamento nestas contas. Espere ele vencer ou ser pago e tente de novo.');
    if (String(req.body.sig || '') !== preview.sig) return fail('Os dados mudaram desde a prévia. Veja a prévia de novo antes de confirmar.');
    const phrase = `APAGAR ${n} ${n === 1 ? 'CONTA' : 'CONTAS'}`;
    if (String(req.body.frase || '').trim().toUpperCase().replace(/\s+/g, ' ') !== phrase) return fail(`A frase não confere. Digite exatamente: ${phrase}`);
    if (preview.money && req.body.ciente !== '1') return fail('Marque a caixa de ciência sobre os pedidos do Mercado Pago.');
    if (!(await bcrypt.compare(String(req.body.senha || ''), req.user.password_hash))) { await audit(req, 'launch_reset_denied', { entity: 'users', meta: { reason: 'senha' } }); return fail('Senha incorreta.'); }
    let done;
    try { done = await L.run(emails, preview.sig); } catch (e) {
      if (e.expose) return fail(e.message);
      log.error('reset_falhou', { error: e.message }); return fail('Não foi possível concluir. Nada foi apagado. Tente de novo ou veja os registros do servidor.');
    }
    await L.record(req, done);
    h.setFlash(res, 'success', `Reset concluído: ${done.contas || 0} ${done.contas === 1 ? 'conta apagada' : 'contas apagadas'}, ${done.pedidos || 0} pedidos, ${done.matriculas || 0} matrículas e ${done.aceites || 0} aceites. Agora remova ALLOW_LAUNCH_RESET no Railway.`);
    res.redirect(303, '/admin/lancamento');
  });
  return r;
}
module.exports = { build };
