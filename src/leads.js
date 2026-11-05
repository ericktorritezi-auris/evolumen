'use strict';
// Lead Parceiros (1.6.0): funil interno de acompanhamento. Não cria acesso, cupom nem afiliado.
const db = require('./db');

const STAGES = [
  { id: 'inicio', name: 'Início' },
  { id: 'aguardando', name: 'Aguardando resposta' },
  { id: 'aceitou', name: 'Aceitou' },
  { id: 'acessos', name: 'Criando acessos e cupom' },
  { id: 'explicando', name: 'Explicando como funciona' },
  { id: 'confirmado', name: 'Parceiro confirmado', ok: true },
  { id: 'sem', name: 'Sem retorno / desistiu', out: true },
];
const STAGE_IDS = STAGES.map((s) => s.id);
const TAGS = { afiliado: 'Afiliado', divulgador: 'Divulgador' };
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MABR = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const monthLabel = (iso) => { const m = /^(\d{4})-(\d{2})/.exec(String(iso)); return m ? `${MABR[+m[2] - 1]}/${m[1]}` : ''; };
const monthLong = (iso) => { const m = /^(\d{4})-(\d{2})/.exec(String(iso)); return m ? `${MONTHS[+m[2] - 1]} de ${m[1]}` : ''; };
const monthKey = (d) => (d instanceof Date ? d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) : String(d)).slice(0, 7);

// Meses oferecidos no cadastro: 6 anteriores, o atual e o próximo.
function monthOptions(now = new Date()) {
  const [y, m] = now.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }).split('-').map(Number);
  const out = [];
  for (let i = 1; i >= -6; i--) { const d = new Date(Date.UTC(y, m - 1 + i, 1)); const k = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; out.push({ value: k, label: monthLong(k) }); }
  return out;
}

function parse(b) {
  const errors = {};
  const name = String(b.name || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (name.length < 2) errors.name = 'Informe o nome.';
  const tag = Object.prototype.hasOwnProperty.call(TAGS, b.tag) ? b.tag : null;
  if (!tag) errors.tag = 'Escolha Afiliado ou Divulgador.';
  const mm = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(b.month || ''));
  if (!mm || +mm[1] < 2020 || +mm[1] > 2100) errors.month = 'Escolha o mês de entrada.';
  return { errors, values: { name, tag, month: mm ? `${mm[1]}-${mm[2]}-01` : null } };
}

async function create(v, userId) {
  return db.tx(async (c) => {
    const id = (await c.query('INSERT INTO partner_leads (name, tag, entry_month, created_by) VALUES ($1,$2,$3,$4) RETURNING id', [v.name, v.tag, v.month, userId])).rows[0].id;
    await c.query('INSERT INTO partner_lead_moves (lead_id, from_stage, to_stage, moved_by) VALUES ($1, NULL, $2, $3)', [id, 'inicio', userId]);
    return id;
  });
}

async function update(id, v) {
  return (await db.q('UPDATE partner_leads SET name = $2, tag = $3, entry_month = $4, updated_at = now() WHERE id = $1', [id, v.name, v.tag, v.month])).rowCount;
}

// Move o card de etapa e registra o horário. Devolve null se o lead não existe, ou {from,to,changed}.
async function move(id, to, userId) {
  if (!STAGE_IDS.includes(to)) return null;
  return db.tx(async (c) => {
    const l = (await c.query('SELECT id, stage FROM partner_leads WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!l) return null;
    if (l.stage === to) return { from: l.stage, to, changed: false };
    await c.query('UPDATE partner_leads SET stage = $2, stage_since = clock_timestamp(), updated_at = now() WHERE id = $1', [id, to]);
    await c.query('INSERT INTO partner_lead_moves (lead_id, from_stage, to_stage, moved_at, moved_by) SELECT $1,$2,$3, stage_since, $4 FROM partner_leads WHERE id = $1', [id, l.stage, to, userId]);
    return { from: l.stage, to, changed: true };
  });
}

// Médias (em horas) a partir do histórico. `now` é injetável para teste.
function metrics(leads, moves, now = Date.now()) {
  const byLead = new Map();
  for (const m of moves) { if (!byLead.has(m.lead_id)) byLead.set(m.lead_id, []); byLead.get(m.lead_id).push({ stage: m.to_stage, at: new Date(m.moved_at).getTime() }); }
  const idx = Object.fromEntries(STAGE_IDS.map((s, i) => [s, i]));
  const main = STAGES.length - 1; // etapas 0..5 (até "Parceiro confirmado"); "sem retorno" fica fora das médias entre etapas
  const trans = Array.from({ length: main - 1 }, () => []);
  const perLead = [];
  for (const l of leads) {
    const h = (byLead.get(l.id) || []).sort((a, b) => a.at - b.at);
    if (!h.length) h.push({ stage: l.stage, at: new Date(l.stage_since).getTime() });
    for (let i = 0; i < h.length - 1; i++) {
      const a = idx[h[i].stage]; const b = idx[h[i + 1].stage];
      if (b === a + 1 && b < main) trans[a].push((h[i + 1].at - h[i].at) / 3600000);
    }
    const last = h[h.length - 1]; const moveCount = h.length - 1;
    // Em etapa final (confirmado / sem retorno) o relógio para: o tempo no funil termina quando o card chegou lá.
    const final = l.stage === 'confirmado' || l.stage === 'sem';
    perLead.push({ id: l.id, final, since_stage: final ? null : (now - last.at) / 3600000, moves: moveCount, avg_move: moveCount ? (last.at - h[0].at) / moveCount / 3600000 : null, total: ((final ? last.at : now) - h[0].at) / 3600000 });
  }
  const between = trans.map((ds, i) => ({ from: STAGES[i].id, to: STAGES[i + 1].id, n: ds.length, avg: ds.length ? ds.reduce((x, y) => x + y, 0) / ds.length : null }));
  return { between, perLead: new Map(perLead.map((p) => [p.id, p])) };
}

async function board() {
  const leads = (await db.q("SELECT id, name, tag, to_char(entry_month, 'YYYY-MM') AS month, stage, stage_since FROM partner_leads ORDER BY stage_since DESC, id DESC")).rows;
  const moves = (await db.q('SELECT lead_id, to_stage, moved_at FROM partner_lead_moves ORDER BY lead_id, moved_at, id')).rows;
  const m = metrics(leads, moves);
  const by = (arr, t) => arr.filter((l) => l.tag === t).length;
  const andamento = leads.filter((l) => l.stage !== 'confirmado' && l.stage !== 'sem');
  const conf = leads.filter((l) => l.stage === 'confirmado');
  const kpi = { total: leads.length, afiliados: by(leads, 'afiliado'), divulgadores: by(leads, 'divulgador'),
    and: andamento.length, and_a: by(andamento, 'afiliado'), and_d: by(andamento, 'divulgador'),
    conf: conf.length, conf_a: by(conf, 'afiliado'), conf_d: by(conf, 'divulgador'),
    sem: leads.filter((l) => l.stage === 'sem').length, taxa: leads.length ? Math.round((conf.length / leads.length) * 100) : 0 };
  return { leads, kpi, between: m.between, perLead: m.perLead };
}

const hours = (n) => { if (n == null || Number.isNaN(n)) return '—'; const r = Math.round(n * 10) / 10; return `${r < 10 ? r.toFixed(1).replace('.', ',') : Math.round(n)} h`; };

module.exports = { STAGES, STAGE_IDS, TAGS, parse, create, update, move, metrics, board, hours, monthLabel, monthKey, monthOptions };
