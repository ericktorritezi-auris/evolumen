'use strict';
// Lançamento: reset dos dados de teste (por e-mail, com prévia) e checklist de go-live.
// O reset só apaga contas de ALUNO escolhidas pelo administrador. Produtos, textos legais, configurações e o administrador ficam.
// A auditoria guarda apenas contagens (nunca nomes nem e-mails).
const crypto = require('crypto');
const db = require('./db');
const files = require('./files');
const { audit } = require('./audit');
const log = require('./logger');

const MAX_EMAILS = 50;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

// Aceita um e-mail por linha (ou separados por vírgula, ponto e vírgula ou espaço).
function parseEmails(text) {
  const out = [];
  for (const part of String(text || '').split(/[\s,;]+/)) {
    const e = part.trim().toLowerCase();
    if (e && EMAIL.test(e) && !out.includes(e)) out.push(e);
  }
  return out.slice(0, MAX_EMAILS);
}

// Pedidos de uma conta: os ligados ao usuário e os de convidado (sem usuário) feitos com o mesmo e-mail.
const ORDERS = '(user_id = ANY($1::bigint[]) OR (user_id IS NULL AND lower(buyer->>\'email\') = ANY($2::text[])))';

// O que seria apagado. Não altera nada. `c` é a conexão da transação (no reset) ou o banco (na prévia).
async function preview(emails, c) {
  const list = parseEmails(emails.join ? emails.join('\n') : emails);
  const qf = c ? (sql, p) => c.query(sql, p) : (sql, p) => db.q(sql, p);
  if (!list.length) return { emails: list, students: [], blocked: [], missing: [], counts: null, paid: { n: 0, cents: 0 }, money: 0, pending: 0, sig: '' };
  const found = (await qf('SELECT id, email, name, role FROM users WHERE lower(email) = ANY($1::text[]) ORDER BY id', [list])).rows;
  const students = found.filter((u) => u.role === 'student');
  const blocked = found.filter((u) => u.role !== 'student').map((u) => u.email);
  const have = new Set(found.map((u) => u.email.toLowerCase()));
  const missing = list.filter((e) => !have.has(e));
  const ids = students.map((u) => u.id);
  const mails = students.map((u) => u.email.toLowerCase());
  const one = async (sql, params) => (await qf(sql, params)).rows[0];
  const n = async (sql, params) => (await one(sql, params)).n;
  const counts = ids.length ? {
    contas: ids.length,
    matriculas: await n('SELECT count(*)::int AS n FROM enrollments WHERE user_id = ANY($1::bigint[])', [ids]),
    pedidos: await n(`SELECT count(*)::int AS n FROM orders WHERE ${ORDERS}`, [ids, mails]),
    reembolsos: await n(`SELECT count(*)::int AS n FROM refund_requests WHERE order_id IN (SELECT id FROM orders WHERE ${ORDERS})`, [ids, mails]),
    certificados: await n('SELECT count(*)::int AS n FROM certificates WHERE user_id = ANY($1::bigint[])', [ids]),
    aceites: await n('SELECT count(*)::int AS n FROM acceptances WHERE user_id = ANY($1::bigint[])', [ids]),
    tentativas: await n('SELECT count(*)::int AS n FROM assessment_attempts WHERE user_id = ANY($1::bigint[])', [ids]),
    progresso: await n('SELECT count(*)::int AS n FROM lesson_progress WHERE user_id = ANY($1::bigint[])', [ids]),
    forum: await n('SELECT count(*)::int AS n FROM forum_posts WHERE user_id = ANY($1::bigint[]) OR parent_id IN (SELECT id FROM forum_posts WHERE user_id = ANY($1::bigint[]))', [ids]),
    avaliacoes: await n('SELECT count(*)::int AS n FROM course_reviews WHERE user_id = ANY($1::bigint[])', [ids]),
    cupons_usados: await n('SELECT count(*)::int AS n FROM coupon_redemptions WHERE user_id = ANY($1::bigint[])', [ids]),
    pedidos_lgpd: await n('SELECT count(*)::int AS n FROM data_requests WHERE user_id = ANY($1::bigint[])', [ids]),
    notificacoes: await n('SELECT count(*)::int AS n FROM notifications WHERE user_id = ANY($1::bigint[]) OR subject_user_id = ANY($1::bigint[])', [ids]),
    emails_enviados: await n('SELECT count(*)::int AS n FROM email_log WHERE lower(to_email) = ANY($1::text[])', [mails]),
    envios_de_cupom: await n('SELECT count(*)::int AS n FROM coupon_sends WHERE lower(email) = ANY($1::text[])', [mails]),
  } : null;
  const empty = { n: 0, cents: 0 };
  const paid = ids.length ? await one(`SELECT count(*)::int AS n, COALESCE(sum(paid_cents),0)::int AS cents FROM orders WHERE ${ORDERS} AND status = 'approved'`, [ids, mails]) : empty;
  // pedidos do Mercado Pago (pagos, reembolsados ou estornados): são registros financeiros reais, pedem confirmação reforçada
  const money = ids.length ? await n(`SELECT count(*)::int AS n FROM orders WHERE ${ORDERS} AND provider = 'mercadopago' AND status IN ('approved','refunded','charged_back')`, [ids, mails]) : 0;
  // Pix ou cartão ainda esperando pagamento: apagar agora deixaria o dinheiro chegar sem pedido
  const pending = ids.length ? await n(`SELECT count(*)::int AS n FROM orders WHERE ${ORDERS} AND status = 'pending' AND created_at > now() - interval '3 hours'`, [ids, mails]) : 0;
  const sig = crypto.createHash('sha256').update(JSON.stringify([ids, counts, paid, money, pending])).digest('hex').slice(0, 24);
  return { emails: list, students, blocked, missing, counts, paid, money, pending, sig };
}

class Changed extends Error { constructor(m) { super(m); this.expose = true; } }

// Apaga de verdade, tudo ou nada. Confere a assinatura da prévia DENTRO da transação, com os pedidos travados.
async function run(emails, sig) {
  const list = parseEmails(emails.join ? emails.join('\n') : emails);
  const done = {};
  await db.tx(async (c) => {
    await c.query("SELECT set_config('evl.launch_reset', 'on', true)"); // vale só nesta transação
    const users = (await c.query("SELECT id, lower(email) AS email FROM users WHERE lower(email) = ANY($1::text[]) AND role = 'student' FOR UPDATE", [list])).rows;
    const ids = users.map((u) => u.id); const mails = users.map((u) => u.email);
    if (!ids.length) throw new Changed('Nenhuma conta de aluno encontrada. Nada foi apagado.');
    await c.query(`SELECT id FROM orders WHERE ${ORDERS} FOR UPDATE`, [ids, mails]);
    const p = await preview(list, c);
    if (sig && p.sig !== sig) throw new Changed('Os dados mudaram desde a prévia (por exemplo, um pagamento acabou de entrar). Nada foi apagado. Veja a prévia de novo.');
    if (p.pending) throw new Changed('Há pedido aguardando pagamento nestas contas. Espere ele vencer ou ser pago e tente de novo. Nada foi apagado.');
    const del = async (key, sql, params) => { done[key] = (await c.query(sql, params)).rowCount; };
    const orders = `SELECT id FROM orders WHERE ${ORDERS}`;
    await del('avisos_do_gateway', `DELETE FROM webhook_events WHERE payment_id IN (SELECT provider_payment_id FROM orders WHERE ${ORDERS} AND provider_payment_id IS NOT NULL)`, [ids, mails]);
    await del('reembolsos', `DELETE FROM refund_requests WHERE order_id IN (${orders})`, [ids, mails]);
    await del('pedidos', `DELETE FROM orders WHERE ${ORDERS}`, [ids, mails]);
    await del('cupons_usados', 'DELETE FROM coupon_redemptions WHERE user_id = ANY($1::bigint[])', [ids]);
    await del('certificados', 'DELETE FROM certificates WHERE user_id = ANY($1::bigint[])', [ids]);
    await del('tentativas', 'DELETE FROM assessment_attempts WHERE user_id = ANY($1::bigint[])', [ids]);
    await del('respostas_do_forum', 'DELETE FROM forum_posts WHERE parent_id IN (SELECT id FROM forum_posts WHERE user_id = ANY($1::bigint[]))', [ids]);
    await del('forum', 'DELETE FROM forum_posts WHERE user_id = ANY($1::bigint[])', [ids]);
    await del('avaliacoes', 'DELETE FROM course_reviews WHERE user_id = ANY($1::bigint[])', [ids]);
    await del('aceites', 'DELETE FROM acceptances WHERE user_id = ANY($1::bigint[])', [ids]);
    await del('emails_enviados', 'DELETE FROM email_log WHERE lower(to_email) = ANY($1::text[])', [mails]);
    await del('envios_de_cupom', 'DELETE FROM coupon_sends WHERE lower(email) = ANY($1::text[])', [mails]);
    // o resto (matrículas, progresso, sessões, notificações, pedidos LGPD, downloads) sai junto com a conta
    done.matriculas = p.counts.matriculas; done.pedidos_lgpd = p.counts.pedidos_lgpd;
    await del('contas', "DELETE FROM users WHERE id = ANY($1::bigint[]) AND role = 'student'", [ids]);
  });
  files.sweepVolume().catch((e) => log.warn('reset_varredura_falhou', { error: e.message })); // arquivos soltos no volume saem na varredura
  return done;
}

// ---------- checklist de go-live ----------
async function checklist(cfg) {
  const one = async (sql) => (await db.q(sql)).rows[0];
  const items = [];
  const add = (level, label, text, href) => items.push({ level, label, text, href });
  add(cfg.isProd ? 'ok' : 'warn', 'Ambiente de produção', cfg.isProd ? 'APP_ENV=production.' : 'Este ambiente não é a produção. Faça o checklist de verdade no endereço de produção.');
  add(cfg.baseUrl.startsWith('https://') ? 'ok' : 'bad', 'Endereço público com HTTPS', cfg.baseUrl);
  add(cfg.resendApiKey && cfg.resendFrom ? 'ok' : 'bad', 'E-mail (Resend)', cfg.resendApiKey && cfg.resendFrom ? `Configurado. Remetente: ${cfg.resendFrom}. Teste uma recuperação de senha e confira que chega na caixa de entrada.` : 'Falta RESEND_API_KEY ou RESEND_FROM_EMAIL.');
  const mp = cfg.paymentProvider === 'mercadopago' && !!cfg.mpAccessToken && !!cfg.mpWebhookSecret;
  const live = /^APP_USR-/.test(cfg.mpAccessToken);
  add(mp && live ? 'ok' : mp ? 'warn' : 'bad', 'Mercado Pago (credenciais de produção)', mp && live ? 'MP_ACCESS_TOKEN (produção) e MP_WEBHOOK_SECRET definidas.' : mp ? 'O token não parece ser o de PRODUÇÃO (deve começar com APP_USR-). Confira no painel do Mercado Pago.' : 'Faltam MP_ACCESS_TOKEN e/ou MP_WEBHOOK_SECRET, ou o pagamento está em modo simulado.');
  const hook = await one("SELECT count(*)::int AS n FROM webhook_events WHERE provider = 'mercadopago'");
  add(hook.n > 0 ? 'ok' : 'warn', 'Webhook do Mercado Pago', hook.n > 0 ? 'O sistema já recebeu avisos do Mercado Pago.' : 'Nenhum aviso recebido ainda. Use "Simular notificação" no painel do Mercado Pago.');
  add(files.volumeOn() ? 'ok' : 'warn', 'Volume de arquivos (/data)', files.volumeOn() ? 'Ligado. Guarde os originais dos produtos fora do Railway: o volume não entra no backup do banco.' : 'Desligado. Arquivos ficam no banco (até 20 MB).');
  const legal = await one("SELECT count(DISTINCT doc_type)::int AS n FROM legal_documents WHERE status = 'published' AND doc_type IN ('terms','privacy')");
  add(legal.n === 2 ? 'ok' : 'bad', 'Textos legais publicados', legal.n === 2 ? 'Termos de uso e Política de privacidade publicados.' : 'Publique os Termos de uso e a Política de privacidade em Textos legais.', '/admin/textos');
  const prods = await one("SELECT count(*)::int AS n, count(*) FILTER (WHERE price_cents > 0 AND price_cents < 500)::int AS cheap FROM courses WHERE status = 'published' AND published_at <= now()");
  add(prods.n > 0 ? 'ok' : 'warn', 'Produto na vitrine', prods.n > 0 ? `${prods.n} publicado${prods.n === 1 ? '' : 's'}.` : 'Nenhum produto publicado.', '/admin/cursos');
  add(prods.n > 0 && prods.cheap === 0 ? 'ok' : 'warn', 'Preço de lançamento', prods.n === 0 ? 'Publique um produto com o preço real.' : prods.cheap === 0 ? 'Nenhum produto com preço de teste (abaixo de R$ 5,00).' : `${prods.cheap} produto${prods.cheap === 1 ? '' : 's'} com preço abaixo de R$ 5,00. Troque pelo preço real antes de abrir ao público.`, '/admin/cursos');
  const buy = await one("SELECT count(*) FILTER (WHERE status IN ('approved','refunded'))::int AS paid, count(*) FILTER (WHERE status = 'refunded')::int AS refunded FROM orders WHERE provider = 'mercadopago'");
  add(buy.paid > 0 ? 'ok' : 'warn', 'Compra de teste real (R$ 1,00)', buy.paid > 0 ? 'Há compra aprovada pelo Mercado Pago. Confira que a matrícula, o e-mail e o download funcionaram.' : 'Ainda não houve compra real. Faça uma de R$ 1,00 por Pix e cartão.', '/admin/vendas');
  add(buy.refunded > 0 ? 'ok' : 'warn', 'Reembolso de teste', buy.refunded > 0 ? 'Há reembolso concluído: o acesso foi cancelado.' : 'Peça o reembolso da compra de teste e confira que o acesso foi cancelado.', '/admin/vendas');
  add(cfg.allowLaunchReset ? 'warn' : 'ok', 'Reset de lançamento desligado', cfg.allowLaunchReset ? 'ALLOW_LAUNCH_RESET=1 está ligada. Depois de limpar os testes, REMOVA a variável no Railway.' : 'Desligado (ALLOW_LAUNCH_RESET não definida). É o estado certo para o público.');
  return items;
}

const MANUAL = [
  'UptimeRobot: monitor HTTP em /health a cada 5 minutos, com aviso para você.',
  'Domínio com certificado ativo (cadeado) e DNS apontado.',
  'Teste de e-mail: o aviso chega na caixa de entrada, não no spam.',
  'Cópia dos arquivos originais dos produtos fora do Railway (o volume não tem backup).',
  'Preço real definido e produto publicado.',
  'Depois do lançamento: olhar a Saúde do sistema e as pendências todo dia na primeira semana.',
];

async function record(req, counts) {
  await audit(req, 'launch_reset', { entity: 'users', meta: { counts } });
}

module.exports = { parseEmails, preview, run, checklist, record, MANUAL, MAX_EMAILS };
