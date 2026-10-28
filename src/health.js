'use strict';
// Saúde do sistema: o que o administrador vê no Dashboard. Só leitura; nada aqui altera dados.
const fs = require('fs');
const db = require('./db');
const files = require('./files');

const MB = 1024 * 1024;
const WINDOW_MS = 15 * 60 * 1000;
const times = []; // tempos de resposta recentes (ms) — ficam só na memória e zeram a cada reinício
const jobs = {};  // última execução das tarefas automáticas

// Mede o tempo de resposta das páginas (ignora arquivos estáticos e o próprio alerta de saúde).
function track(req, res, next) {
  // só páginas: ignora estáticos, capas, downloads, envios e verificações de saúde (não refletem a lentidão que o usuário sente)
  if (req.method !== 'GET' || /^\/(static|capas|arquivos|webhooks)\//.test(req.path) || /^\/(sw\.js|health|version|manifest\.webmanifest|favicon\.ico)$/.test(req.path)) return next();
  const t0 = process.hrtime.bigint();
  res.on('finish', () => {
    times.push({ at: Date.now(), ms: Number(process.hrtime.bigint() - t0) / 1e6 });
    if (times.length > 500) times.splice(0, times.length - 500);
  });
  next();
}
const mark = (name, ok = true, detail = '') => { jobs[name] = { at: Date.now(), ok, detail }; };

function response() {
  const cut = Date.now() - WINDOW_MS;
  const xs = times.filter((x) => x.at >= cut).map((x) => x.ms).sort((a, b) => a - b);
  if (!xs.length) return null;
  return { n: xs.length, avg: xs.reduce((a, b) => a + b, 0) / xs.length, p95: xs[Math.min(xs.length - 1, Math.floor(xs.length * 0.95))] };
}

const lvl = { ok: 0, warn: 1, bad: 2 };
const worst = (items) => items.reduce((w, i) => (lvl[i.level] > lvl[w] ? i.level : w), 'ok');
const fmtUp = (s) => { const d = Math.floor(s / 86400); const h = Math.floor((s % 86400) / 3600); const m = Math.floor((s % 3600) / 60); return d ? `${d} d ${h} h` : h ? `${h} h ${m} min` : `${m} min`; };
const fmtSize = (n) => (n >= 1024 * MB ? `${(n / 1024 / MB).toFixed(1).replace('.', ',')} GB` : `${Math.max(0, Math.round(n / MB))} MB`);
const ago = (t) => { const s = Math.max(0, (Date.now() - t) / 1000); return s < 90 ? 'agora há pouco' : s < 5400 ? `há ${Math.round(s / 60)} min` : `há ${Math.round(s / 3600)} h`; };

async function snapshot(cfg) {
  const items = [];
  const add = (key, label, level, text) => items.push({ key, label, level, text });

  add('servidor', 'Servidor', 'ok', `No ar há ${fmtUp(process.uptime())} · versão ${cfg.version.version}`);

  // Banco de dados: uma consulta simples cronometrada
  let dbMs = null;
  try { const t0 = process.hrtime.bigint(); await db.q('SELECT 1'); dbMs = Number(process.hrtime.bigint() - t0) / 1e6; } catch { /* sem conexão */ }
  if (dbMs == null) add('banco', 'Banco de dados', 'bad', 'Sem conexão');
  else add('banco', 'Banco de dados', dbMs > 500 ? 'warn' : 'ok', `Conectado · resposta em ${Math.max(1, Math.round(dbMs))} ms`);

  const rs = response();
  if (!rs) add('resposta', 'Tempo de resposta das páginas', 'ok', 'Sem acessos recentes para medir');
  else add('resposta', 'Tempo de resposta das páginas', rs.p95 > 2000 ? 'bad' : rs.p95 > 800 ? 'warn' : 'ok', `média ${Math.round(rs.avg)} ms · 95% abaixo de ${Math.round(rs.p95)} ms (últimos 15 min, ${rs.n} acessos)`);

  // E-mail
  const mailOn = cfg.mailTransport === 'memory' || !!(cfg.resendApiKey && cfg.resendFrom);
  let failed = 0; let sent = 0;
  if (dbMs != null) {
    try { const r = (await db.q("SELECT count(*) FILTER (WHERE status = 'failed')::int AS f, count(*) FILTER (WHERE status = 'sent')::int AS s FROM email_log WHERE created_at > now() - interval '24 hours'")).rows[0]; failed = r.f; sent = r.s; } catch { /* sem tabela */ }
  }
  if (!mailOn) add('email', 'E-mail (Resend)', 'bad', 'Não configurado');
  else add('email', 'E-mail (Resend)', failed ? (failed >= 3 ? 'bad' : 'warn') : 'ok', `Configurado${cfg.resendFrom ? ' (' + cfg.resendFrom.replace(/^.*</, '').replace(/>$/, '') + ')' : ''} · ${sent} enviados e ${failed} com falha nas últimas 24 h`);

  // Pagamento
  if (cfg.paymentProvider === 'mercadopago') {
    let last = null;
    if (dbMs != null) { try { last = (await db.q("SELECT max(created_at) AS t FROM webhook_events WHERE provider = 'mercadopago'")).rows[0].t; } catch { /* ignora */ } }
    const tail = last ? ` · último aviso do Mercado Pago em ${new Date(last).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })}` : ' · nenhum aviso recebido ainda';
    add('pagamento', 'Pagamento', cfg.mpAccessToken ? 'ok' : 'bad', (cfg.mpAccessToken ? 'Mercado Pago ligado' : 'Mercado Pago sem credencial') + tail);
  } else add('pagamento', 'Pagamento', cfg.isProd ? 'bad' : 'ok', cfg.isProd ? 'Simulador em produção: troque para o Mercado Pago' : 'Simulador (ambiente de teste)');

  // Tarefas automáticas (lembretes, aniversários, limpeza)
  const j = jobs.tarefas;
  if (!j) add('tarefas', 'Tarefas automáticas', process.uptime() < 900 ? 'ok' : 'warn', process.uptime() < 900 ? 'Vão rodar em instantes (sistema recém-iniciado)' : 'Ainda não rodaram desde que o sistema iniciou');
  else add('tarefas', 'Tarefas automáticas', Date.now() - j.at > 3 * 3600 * 1000 ? 'warn' : j.ok ? 'ok' : 'warn', `Última execução ${ago(j.at)}${j.ok ? '' : ' (com avisos)'}`);

  // Volume do Railway
  if (!files.volumeOn()) add('volume', 'Volume de arquivos', 'warn', 'Desligado neste ambiente · arquivos só no banco (até 20 MB)');
  else {
    const dir = files.volDir();
    let used = 0; let n = 0; let writable = true; let free = null;
    try { fs.accessSync(dir, fs.constants.W_OK); } catch { writable = false; }
    try { const st = fs.statfsSync(dir); free = Number(st.bavail) * Number(st.bsize); } catch { /* sem statfs */ }
    if (dbMs != null) { try { const r = (await db.q("SELECT count(*)::int AS n, COALESCE(sum(size_bytes),0)::bigint AS b FROM files WHERE storage = 'volume'")).rows[0]; n = r.n; used = Number(r.b); } catch { /* ignora */ } }
    const low = free != null && free < 200 * MB;
    add('volume', 'Volume de arquivos', !writable ? 'bad' : low ? 'warn' : 'ok', `${writable ? 'Ligado' : 'Sem permissão de gravação'} · ${n} ${n === 1 ? 'arquivo' : 'arquivos'} (${fmtSize(used)})${free != null ? ` · ${fmtSize(free)} livres` : ''}`);
  }

  const mem = process.memoryUsage().rss;
  add('memoria', 'Memória do servidor', mem > 900 * MB ? 'warn' : 'ok', `${Math.round(mem / MB)} MB em uso`);
  return { level: worst(items), items };
}

module.exports = { track, mark, snapshot, response };
