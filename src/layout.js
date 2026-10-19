'use strict';
// Estrutura das páginas: documento, tela do app (aluno e admin) e tela de autenticação.
// Menu, cabeçalho e rodapé vêm dos arquivos únicos nav.js, header.js e footer.js.
const { html, raw } = require('./html');
const { menuFor } = require('./nav');
const { renderFooter } = require('./footer');
const { brand, icon, mobileHeader } = require('./header');

function lumen(pose, size, alt = '') {
  return html`<img class="lumen lumen--${pose}" src="/static/img/lumen-${pose}.svg" width="${size}" alt="${alt}">`;
}

function documentShell({ cfg, title, body, robots = 'noindex, nofollow', bodyClass = '', description = '' }) {
  const v = cfg.version.version;
  return '<!doctype html>' + html`<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title} · EvoLumen Academy</title>
<meta name="robots" content="${cfg.isProd ? robots : 'noindex, nofollow'}">
${description ? html`<meta name="description" content="${description}">` : ''}
<meta name="theme-color" content="#0B0F26">
<meta name="color-scheme" content="dark">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/static/icons/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/static/icons/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/static/icons/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="EvoLumen">
<link rel="preload" href="/static/fonts/quicksand-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/static/fonts/nunito-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/static/css/app.css?v=${v}">
<script src="/static/js/app.js?v=${v}" defer></script>
</head>
<body class="${bodyClass}">
${cfg.isProd ? '' : html`<div class="env-banner" role="status">Ambiente de testes (${cfg.appEnv}). Nada aqui é real.</div>`}
${body}
</body>
</html>`.s;
}

function flash(f) {
  if (!f) return '';
  return html`<div class="alert alert--${f.type}" role="${f.type === 'error' ? 'alert' : 'status'}">${f.text}</div>`;
}

// Tela do app: barra lateral no computador, menu sanduíche por cima da tela no celular.
function shellApp({ cfg, user, path, title, content, flash: f, csrf }) {
  const area = user.role === 'admin' ? 'admin' : 'aluno';
  const items = menuFor(area, path, cfg.version.phase);
  const sub = area === 'admin' ? 'ADMIN' : 'ÁREA DE MEMBROS';
  const links = items.map((i) => html`<a href="${i.href}" class="nav__item${i.active ? ' is-active' : ''}"${i.active ? raw(' aria-current="page"') : ''}>${icon(i.icon, 20)}<span>${i.label}</span></a>`);
  const logoutForm = (cls) => html`<form method="post" action="/sair" class="${cls}"><input type="hidden" name="_csrf" value="${csrf}"><button type="submit" class="nav__item nav__item--btn">${icon('out', 20)}<span>Sair</span></button></form>`;
  const mascot = area === 'aluno' && user.mascot_enabled;
  const body = html`
<div class="app">
  <aside class="sidebar" aria-label="Menu">
    <div class="sidebar__brand">${brand({ sub, size: 34 })}</div>
    <nav class="nav" aria-label="${area === 'admin' ? 'Painel do administrador' : 'Área do aluno'}">${links}${logoutForm('nav__logout')}</nav>
    ${mascot ? html`<div class="sidebar__lumen">${lumen('ola', 64)}<p>Oi! Eu sou a Lumen. Estou por aqui.</p></div>` : ''}
  </aside>
  ${mobileHeader({ area })}
  <div class="menu-overlay" id="menu-overlay" hidden>
    <div class="menu-overlay__scrim" data-menu-close></div>
    <aside class="menu-overlay__panel" role="dialog" aria-modal="true" aria-label="Menu">
      <div class="menu-overlay__top">${brand({ size: 30 })}<button type="button" class="icon-btn" data-menu-close aria-label="Fechar menu">${icon('close', 22)}</button></div>
      <div class="who">${lumen('ola', 44)}<div><div class="who__name">${user.name}</div><div class="who__mail">${user.email}</div></div></div>
      <nav class="nav" aria-label="Menu principal">${links}${logoutForm('nav__logout')}</nav>
      <p class="menu-overlay__note">O menu abre por cima da tela e não empurra o conteúdo.</p>
    </aside>
  </div>
  <main class="main" id="conteudo">
    <div class="topbar"><span>Olá, ${user.name.split(' ')[0]}</span></div>
    ${flash(f)}
    ${content}
  </main>
  ${renderFooter(cfg)}
</div>`;
  return documentShell({ cfg, title, body });
}

// Tela de autenticação: duas colunas no computador, empilhada no celular.
function shellAuth({ cfg, title, heading, lead, pose = 'guia', bubble = '', content, flash: f, showBack = false }) {
  const body = html`
<div class="auth">
  <section class="auth__intro">
    ${brand({ size: 36 })}
    <div class="auth__text">
      <h1 class="t-display">${heading}</h1>
      ${lead ? html`<p class="lead">${lead}</p>` : ''}
    </div>
    <div class="auth__lumen">${lumen(pose, 150)}${bubble ? html`<div class="bubble">${bubble}</div>` : ''}</div>
  </section>
  <section class="auth__panel">
    <div class="auth__card">${flash(f)}${content}</div>
  </section>
  ${renderFooter(cfg, { compact: true })}
</div>`;
  return documentShell({ cfg, title, body, bodyClass: 'is-auth' });
}

// Página pública (landing e curso): cabeçalho com menu de seções, menu por cima da tela no celular.
function shellPublic({ cfg, user, title, content, flash: f, description = '', ogImage = '', robots = 'index, follow' }) {
  const items = menuFor('publico', '/', cfg.version.phase);
  const cta = user ? { href: user.role === 'admin' ? '/admin' : '/meus-cursos', label: user.role === 'admin' ? 'Painel' : 'Meus cursos' } : { href: '/entrar', label: 'Área de membros' };
  const links = items.map((i) => html`<a href="${i.href}" class="nav__item">${icon(i.icon, 20)}<span>${i.label}</span></a>`);
  const body = html`
<header class="p-header">
  <div class="p-header__in">
    ${brand({ size: 34 })}
    <nav class="p-nav" aria-label="Seções">${items.map((i) => html`<a href="${i.href}">${i.label}</a>`)}</nav>
    <div class="p-header__act"><a class="btn btn--outline btn--sm" href="${cta.href}">${cta.label}</a>
      <button type="button" class="icon-btn p-menu" id="menu-open" aria-label="Abrir menu" aria-expanded="false" aria-controls="menu-overlay">${icon('menu', 22)}</button></div>
  </div>
</header>
<div class="menu-overlay" id="menu-overlay" hidden>
  <div class="menu-overlay__scrim" data-menu-close></div>
  <aside class="menu-overlay__panel" role="dialog" aria-modal="true" aria-label="Menu">
    <div class="menu-overlay__top">${brand({ size: 30 })}<button type="button" class="icon-btn" data-menu-close aria-label="Fechar menu">${icon('close', 22)}</button></div>
    <nav class="nav" aria-label="Menu principal">${links}<a href="${cta.href}" class="nav__item nav__item--cta">${icon('user', 20)}<span>${cta.label}</span></a></nav>
    <p class="menu-overlay__note">O menu abre por cima da tela e não empurra o conteúdo.</p>
  </aside>
</div>
<main id="conteudo" class="p-main">${flash(f)}${content}</main>
${renderFooter(cfg)}`;
  return documentShell({ cfg, title, body, robots, bodyClass: 'is-public', description });
}

module.exports = { documentShell, shellApp, shellAuth, shellPublic, flash, lumen };
