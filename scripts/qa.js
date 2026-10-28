'use strict';
// QA automática: gera uma tabela em Markdown (QA-RELATORIO.md) e sai com erro se algo falhar.
// Uso: TEST_DATABASE_URL=postgres://... npm run qa
const fs = require('fs'); const path = require('path'); const cp = require('child_process');
const root = path.join(__dirname, '..');
const rows = [];
const add = (item, ok, detail) => rows.push({ item, ok, detail });
const walk = (d, out = []) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { if (f.name === 'node_modules' || f.name.startsWith('.')) continue; const p = path.join(d, f.name); f.isDirectory() ? walk(p, out) : out.push(p); } return out; };
const files = walk(root);

// 1. Sintaxe de todos os .js
const js = files.filter((f) => f.endsWith('.js'));
const badSyntax = js.filter((f) => cp.spawnSync(process.execPath, ['--check', f]).status !== 0);
add('Sintaxe dos arquivos JS', !badSyntax.length, `${js.length} arquivos${badSyntax.length ? '; com erro: ' + badSyntax.map((f) => path.relative(root, f)).join(', ') : ''}`);

// 2. JSON válidos
const jsons = files.filter((f) => f.endsWith('.json') || f.endsWith('.webmanifest'));
const badJson = jsons.filter((f) => { try { JSON.parse(fs.readFileSync(f, 'utf8')); return false; } catch { return true; } });
add('JSON válidos', !badJson.length, `${jsons.length} arquivos`);

// 3. IDs únicos de campos em cada tela (renderiza telas de exemplo)
try {
  const cfg = require('../src/config').load({ APP_ENV: 'test', SESSION_SECRET: 'x'.repeat(40) });
  const au = require('../src/views/auth'); const ap = require('../src/views/app');
  const user = { id: 1, name: 'Teste Silva', email: 't@x.com', role: 'student', mascot_enabled: true, cpf: '1' };
  const pages = { login: au.login({ cfg, csrf: 'c' }), primeiro: au.firstAccess({ cfg, csrf: 'c' }), esqueci: au.forgot({ cfg, csrf: 'c' }),
    reset: au.reset({ cfg, csrf: 'c', token: 't' }), perfil: ap.perfil({ cfg, user, csrf: 'c' }), email: ap.perfilEmail({ cfg, user, csrf: 'c' }),
    adminHome: ap.adminHome({ cfg, user: { ...user, role: 'admin' }, csrf: 'c', status: { db: true, migrations: 1, legalPublished: 0, mail: true, mailFrom: 'x' }, health: { level: 'ok', items: [{ key: 'banco', label: 'Banco de dados', level: 'ok', text: 'Conectado' }] }, dash: { month: { n: 0, gross: 0, refunds: 0, net: 0 }, students: 0, pubs: { cursos: 0, produtos: 0 }, pending: [{ n: 1, label: 'Pedidos', href: '/admin' }] } }) };
  const dup = [];
  for (const [n, h] of Object.entries(pages)) { const ids = [...h.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]); const d = ids.filter((x, i) => ids.indexOf(x) !== i); if (d.length) dup.push(`${n}: ${[...new Set(d)].join(',')}`); }
  add('IDs HTML únicos por tela', !dup.length, `${Object.keys(pages).length} telas${dup.length ? '; repetidos: ' + dup.join(' | ') : ''}`);
} catch (e) { add('IDs HTML únicos por tela', false, e.message); }

// 4. Versões coerentes
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const ver = JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8'));
const readme = fs.existsSync(path.join(root, 'README.md')) ? fs.readFileSync(path.join(root, 'README.md'), 'utf8') : '';
const inReadme = readme.includes(`| ${pkg.version} |`);
add('Versão igual em package.json, version.json e README', pkg.version === ver.version && inReadme, `package ${pkg.version} · version.json ${ver.version} · README ${inReadme ? 'tem a linha da versão' : 'SEM linha da versão'}`);

// 5. Migrações em sequência, sem buracos
const mig = fs.readdirSync(path.join(root, 'migrations')).filter((f) => f.endsWith('.sql')).sort();
const seq = mig.every((f, i) => Number(f.slice(0, 3)) === i + 1);
add('Migrações numeradas em sequência', seq && mig.length > 0, mig.join(', '));

// 6. Segredos no código
const secretRe = /(re_[A-Za-z0-9]{20,}|postgres(ql)?:\/\/[^\s'"]+:[^\s'"@]+@(?!127\.0\.0\.1|localhost))/;
const leaked = js.concat(files.filter((f) => /\.(md|json|sql|txt)$/.test(f))).filter((f) => secretRe.test(fs.readFileSync(f, 'utf8')));
add('Nenhum segredo no código', !leaked.length, leaked.length ? leaked.map((f) => path.relative(root, f)).join(', ') : 'varredura de chaves e URLs de banco');

// 7. Testes (inclui regressão: todos os testes de fases anteriores rodam sempre)
if (!process.env.TEST_DATABASE_URL) add('Testes automáticos', false, 'TEST_DATABASE_URL não definida');
else {
  const r = cp.spawnSync('npm', ['test', '--silent'], { cwd: root, encoding: 'utf8', env: process.env });
  const out = (r.stdout || '') + (r.stderr || '');
  const g = (k) => Number((out.match(new RegExp(`# ${k} (\\d+)`)) || [0, 0])[1]);
  add('Testes automáticos e regressão', r.status === 0 && g('pass') > 0 && g('fail') === 0, `${g('pass')} passaram, ${g('fail')} falharam`);
}

const pass = rows.every((r) => r.ok);
const md = ['# Relatório de QA', '', `Versão ${pkg.version} · Fase ${ver.phase} · ${new Date().toISOString().slice(0, 10)}`, '',
  '| # | Verificação | Resultado | Detalhe |', '|---|---|---|---|',
  ...rows.map((r, i) => `| ${i + 1} | ${r.item} | ${r.ok ? 'OK' : 'FALHOU'} | ${r.detail} |`), '', pass ? '**Resultado geral: APROVADO**' : '**Resultado geral: REPROVADO**', ''].join('\n');
fs.writeFileSync(path.join(root, 'QA-RELATORIO.md'), md);
console.log(md);
process.exit(pass ? 0 : 1);
