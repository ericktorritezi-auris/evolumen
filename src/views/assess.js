'use strict';
// Telas do aluno e públicas da Fase 3: quiz, prova final, certificados e verificação.
const { html, raw } = require('../html');
const { shellApp, shellPublic, lumen } = require('../layout');
const { icon } = require('../header');
const { csrfInput } = require('./ui');
const { bar, titleRow } = require('./student');
const certs = require('../certificates');

const score = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 }));
const navPath = (user) => (user.role === 'admin' ? '/admin/cursos' : '/meus-cursos');
const fmtDate = certs.fmtDate;

function attemptInfo(st) {
  return html`<ul class="facts"><li><b>${st.qcount}</b> ${st.qcount === 1 ? 'questão' : 'questões'}</li><li>Nota mínima <b>${score(st.pass)}</b></li>
    <li>Tentativas: <b>${st.used}</b> de <b>${st.limit}</b></li>${st.best != null ? html`<li>Melhor nota: <b>${score(st.best)}</b></li>` : ''}</ul>`;
}

function reviewList(rev, reveal) {
  return html`<ol class="qreview">${rev.map((q) => html`<li class="qreview__i ${q.ok ? 'is-ok' : 'is-bad'}"><p class="qreview__q">${q.body}</p>
    <ul class="qopts">${q.options.map((o) => {
      const mine = q.picked === String(o.id); const right = reveal && q.rightId === String(o.id);
      return html`<li class="${right ? 'is-right' : ''}${mine && !q.ok ? ' is-wrong' : ''}">${mine ? '● ' : '○ '}${o.body}${right ? html` <span class="pill pill--ok">resposta certa</span>` : ''}${mine ? html` <span class="muted small">(sua resposta)</span>` : ''}</li>`;
    })}</ul>
    <p class="small ${q.ok ? 'up' : 'down'}">${q.ok ? 'Você acertou.' : (q.picked ? 'Você errou.' : 'Sem resposta.')}</p>
    ${q.explanation ? html`<p class="muted small">${q.explanation}</p>` : ''}</li>`)}</ol>`;
}

function quizPage({ cfg, user, csrf, flash, course, a, st, ov, mode, attempt, rev, next }) {
  const isFinal = a.kind === 'final';
  const base = `/curso/${course.slug}/avaliacao/${a.id}`;
  const title = isFinal ? 'Prova final' : `Quiz · ${a.title || 'do módulo'}`;
  let body;
  if (mode === 'questions') {
    body = html`<form method="post" action="${base}/enviar" class="form">${csrfInput(csrf)}<input type="hidden" name="attempt" value="${attempt.id}">
      <p class="muted">Tentativa ${attempt.number} de ${st.limit}. Responda todas as questões e envie no final.</p>
      <ol class="qlist">${attempt.snapshot.map((q) => html`<li class="card qbox"><fieldset><legend class="qbox__q">${q.body}</legend>
        ${q.options.map((o) => html`<label class="opt"><input type="radio" name="q_${q.id}" value="${o.id}"><span>${o.body}</span></label>`)}</fieldset></li>`)}</ol>
      <div class="row"><button class="btn btn--primary" type="submit" data-confirm="Enviar as respostas? Depois de enviar, não dá para mudar.">Enviar respostas</button></div></form>`;
  } else if (mode === 'review') {
    body = html`<section class="card ${attempt.passed ? 'card--ok' : 'card--warn'}"><span class="eyebrow">Tentativa ${attempt.number}</span>
      <p class="score">${score(attempt.score)}</p>
      <p>${attempt.passed ? html`<b>Aprovado.</b> Você acertou ${attempt.correct_count} de ${attempt.total}.` : html`<b>Ainda não foi desta vez.</b> Você acertou ${attempt.correct_count} de ${attempt.total}. A nota mínima é ${score(st.pass)}.`}</p>
      ${isFinal && attempt.passed && !ov.cert.pctOk ? html`<p class="muted">Seu certificado será liberado quando você concluir 95% do curso. Faltam ${ov.cert.missing} ${ov.cert.missing === 1 ? 'aula' : 'aulas'}.</p>` : ''}
      <div class="row">${attempt.passed
        ? (next ? html`<a class="btn btn--primary" href="${next.href}">${next.label}</a>` : html`<a class="btn btn--primary" href="/curso/${course.slug}">Voltar ao curso</a>`)
        : (st.left > 0 ? html`<form method="post" action="${base}/iniciar" class="inline">${csrfInput(csrf)}<button class="btn btn--primary" type="submit">Tentar de novo (${st.left} ${st.left === 1 ? 'restante' : 'restantes'})</button></form>` : html`<p class="muted">Você usou todas as tentativas. Fale com o suporte para pedir uma tentativa extra.</p>`)}
        <a class="btn btn--ghost" href="/curso/${course.slug}">Voltar ao curso</a></div></section>
      ${isFinal ? '' : html`<h2 class="t-card">Correção</h2>${reviewList(rev, true)}`}`;
  } else {
    body = html`<section class="card">${isFinal
      ? html`<p>A prova final fecha o curso. Nota mínima <b>${score(st.pass)}</b>. Para receber o certificado, você também precisa concluir <b>95%</b> do curso.</p>`
      : html`<p>Este quiz <b>não vale nota</b>: ele serve para fixar o conteúdo e mostrar o quanto você entendeu. Para avançar para o próximo módulo, você precisa de pelo menos <b>${score(st.pass)}</b>.</p>`}
      ${attemptInfo(st)}
      ${st.passed ? html`<p class="up"><b>Você já foi aprovado${st.best != null ? ' com nota ' + score(st.best) : ''}.</b></p>` : ''}
      <div class="row">${st.open_id ? html`<form method="post" action="${base}/iniciar" class="inline">${csrfInput(csrf)}<button class="btn btn--primary" type="submit">Continuar tentativa em andamento</button></form>`
        : st.left > 0 && !st.passed ? html`<form method="post" action="${base}/iniciar" class="inline">${csrfInput(csrf)}<button class="btn btn--primary" type="submit">${st.used ? 'Fazer nova tentativa' : 'Começar'}</button></form>`
        : !st.passed ? html`<p class="muted">Você usou todas as tentativas. Fale com o suporte para pedir uma tentativa extra.</p>` : ''}
        ${next ? html`<a class="btn btn--outline" href="${next.href}">${next.label}</a>` : ''}
        <a class="btn btn--ghost" href="/curso/${course.slug}">Voltar ao curso</a></div></section>`;
  }
  const content = html`<a class="back" href="/curso/${course.slug}">← ${course.title}</a>${titleRow(title, isFinal ? course.title : null)}${body}`;
  return shellApp({ cfg, user, csrf, flash, path: navPath(user), title, content });
}

function notReady({ cfg, user, csrf, flash, course, title, message }) {
  const content = html`<a class="back" href="/curso/${course.slug}">← ${course.title}</a>${titleRow(title)}
    <section class="card empty">${icon('lock', 40)}<p class="muted">${message}</p><a class="btn btn--outline btn--sm" href="/curso/${course.slug}">Voltar ao curso</a></section>`;
  return shellApp({ cfg, user, csrf, flash, path: navPath(user), title, content });
}

// ---- lista do aluno ----
function certificados({ cfg, user, csrf, flash, certs: list, going }) {
  const content = html`${titleRow('Certificados', 'Seus certificados e o caminho para conquistá-los.')}
  ${list.length ? html`<div class="mgrid">${list.map((c) => html`<article class="card mcard"><span class="eyebrow">${c.status === 'valid' ? 'Certificado válido' : 'Certificado cancelado'}</span>
      <h3 class="t-card">${c.course_title}</h3><p class="muted small">Emitido em ${fmtDate(c.issued_at)} · ${c.hours ? c.hours + ' h · ' : ''}código ${c.code}</p>
      ${c.status === 'valid' ? html`<div class="row"><a class="btn btn--primary btn--sm" href="/certificados/${c.code}/pdf">${icon('download', 16)} Baixar PDF</a><a class="btn btn--ghost btn--sm" href="/certificado/${c.code}">Página de verificação</a></div>`
        : html`<p class="muted small">Este certificado foi cancelado e não pode mais ser baixado.</p>`}</article>`)}</div>`
    : html`<section class="card card--hero"><div class="empty">${lumen('celebra', 110)}<div><h2 class="t-card">Nenhum certificado ainda</h2><p class="muted">Quando você terminar um curso, o certificado aparece aqui.</p></div></div></section>`}
  ${going.length ? html`<h2 class="t-card">Em andamento</h2>${going.map((g) => html`<section class="card"><h3 class="t-card"><a href="/curso/${g.slug}">${g.title}</a></h3>${bar(g.cert.pct)}
    <ul class="checks"><li class="${g.cert.pctOk ? 'is-ok' : ''}">${g.cert.pctOk ? '✔' : '○'} Concluir 95% do curso <span class="muted small">(você está em ${g.cert.pct}%${g.cert.pctOk ? '' : `, faltam ${g.cert.missing} ${g.cert.missing === 1 ? 'aula' : 'aulas'}`})</span></li>
      ${g.cert.needExam ? html`<li class="${g.cert.examOk ? 'is-ok' : ''}">${g.cert.examOk ? '✔' : '○'} Passar na prova final <span class="muted small">(nota mínima 7,0)</span></li>` : ''}</ul>
    <a class="btn btn--outline btn--sm" href="/curso/${g.slug}">Ir para o curso</a></section>`)}` : ''}`;
  return shellApp({ cfg, user, csrf, flash, path: '/certificados', title: 'Certificados', content });
}

// ---- verificação pública (mínimo: nome, curso, carga horária, data e código) ----
function verificar({ cfg, user, cert, code, notFound }) {
  let body;
  if (cert && cert.status === 'valid') {
    body = html`<div class="verify verify--ok"><img src="/static/img/selo-evolumen.png" alt="Selo EvoLumen" width="96" height="96"><span class="eyebrow">Certificado válido</span>
      <h1 class="t-display">${cert.student_name}</h1>
      <p class="lead">concluiu o curso <b>${cert.course_title}</b></p>
      <ul class="facts facts--center">${cert.hours ? html`<li>Carga horária: <b>${cert.hours} ${cert.hours === 1 ? 'hora' : 'horas'}</b></li>` : ''}<li>Data de emissão: <b>${fmtDate(cert.issued_at)}</b></li><li>Código: <b>${cert.code}</b></li></ul>
      <p class="muted small">Certificado emitido pela EvoLumen Academy.</p></div>`;
  } else if (cert) {
    body = html`<div class="verify verify--bad">${icon('close', 40)}<span class="eyebrow">Certificado cancelado</span>
      <h1 class="t-display">Este certificado foi cancelado</h1>
      <p class="muted">O certificado de código <b>${cert.code}</b> não é mais válido.</p></div>`;
  } else {
    body = html`<div class="verify"><span class="eyebrow">Verificar certificado</span><h1 class="t-display">${notFound ? 'Certificado não encontrado' : 'Confira um certificado'}</h1>
      <p class="muted">${notFound ? html`Não encontramos o código <b>${code}</b>. Confira se digitou igual ao que está no certificado.` : 'Digite o código que aparece no certificado (ex.: EVL-ABCD-EFGH-JKLM) ou leia o QR Code.'}</p></div>`;
  }
  const form = cert ? '' : html`<form method="get" action="/verificar" class="form form--narrow"><div class="field"><label for="codigo">Código do certificado</label><input id="codigo" name="codigo" value="${code || ''}" placeholder="EVL-XXXX-XXXX-XXXX" maxlength="20" autocomplete="off" required></div>
    <button class="btn btn--primary" type="submit">Verificar</button></form>`;
  const content = html`<article class="sec"><div class="sec__in sec__in--narrow center"><a class="back" href="/">← Início</a>${body}${form}</div></article>`;
  return shellPublic({ cfg, user, title: 'Verificar certificado', content, robots: 'noindex, nofollow' });
}

module.exports = { quizPage, notReady, certificados, verificar, score };
