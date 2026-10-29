'use strict';
const { html } = require('../html');
const { shellAuth } = require('../layout');
const { field, csrfInput } = require('./ui');

function login({ cfg, csrf, flash, email = '', next = '' }) {
  const showCourses = cfg.version.phase >= 2;
  return shellAuth({
    cfg, title: 'Entrar', flash,
    heading: html`Sua área de <b class="accent">membros.</b>`,
    lead: 'Entre para acessar seus produtos, continuar seus cursos, falar com o professor e emitir seus certificados.',
    pose: 'guia', bubble: 'Use o login e a senha que enviamos por e-mail.',
    content: html`
      <h2 class="t-card">Entrar</h2>
      <p class="muted">Alunos e administrador entram por aqui.</p>
      <form method="post" action="/entrar" class="form" novalidate>
        ${csrfInput(csrf)}${next ? html`<input type="hidden" name="next" value="${next}">` : ''}
        ${field({ id: 'email', label: 'E-mail', type: 'email', value: email, autocomplete: 'username', required: true, placeholder: 'nome@email.com' })}
        ${field({ id: 'senha', name: 'password', label: 'Senha', type: 'password', autocomplete: 'current-password', required: true, password: true })}
        <div class="form__aside"><a href="/esqueci-senha">Esqueci minha senha</a></div>
        <button class="btn btn--primary btn--lg btn--block" type="submit">Entrar</button>
      </form>
      ${showCourses ? html`<p class="muted small center">Ainda não tem acesso? <a href="/#cursos">Conheça os produtos</a></p>` : ''}`,
  });
}

function firstAccess({ cfg, csrf, flash, errors = {} }) {
  return shellAuth({
    cfg, title: 'Primeiro acesso', flash,
    heading: html`Crie sua <b class="accent">nova senha.</b>`,
    lead: 'Por segurança, a senha que enviamos por e-mail serve só para o primeiro acesso.',
    pose: 'ola', bubble: 'Escolha uma senha só sua. Eu espero aqui!',
    content: html`
      <div class="eyebrow">Primeiro acesso</div>
      <h2 class="t-card">Nova senha</h2>
      <p class="muted">Esta etapa é obrigatória para entrar na área de membros.</p>
      <form method="post" action="/primeiro-acesso" class="form" novalidate>
        ${csrfInput(csrf)}
        ${field({ id: 'atual', name: 'current', label: 'Senha provisória (do e-mail)', type: 'password', autocomplete: 'current-password', required: true, password: true, error: errors.current })}
        ${field({ id: 'nova', name: 'password', label: 'Nova senha', type: 'password', autocomplete: 'new-password', required: true, password: true, error: errors.password, note: 'Mínimo de 8 caracteres, com letras e números.' })}
        ${field({ id: 'confirmar', name: 'confirm', label: 'Confirmar nova senha', type: 'password', autocomplete: 'new-password', required: true, password: true, error: errors.confirm })}
        <button class="btn btn--primary btn--lg btn--block" type="submit">Salvar e entrar</button>
      </form>`,
  });
}

function forgot({ cfg, csrf, flash }) {
  return shellAuth({
    cfg, title: 'Esqueci minha senha', flash,
    heading: html`Vamos criar uma <b class="accent">nova senha.</b>`,
    lead: 'Informe o e-mail da sua conta. Se ele estiver cadastrado, enviamos um link para você criar uma nova senha.',
    pose: 'pensa', bubble: 'Sem pressa. O link chega em instantes.',
    content: html`
      <h2 class="t-card">Esqueci minha senha</h2>
      <p class="muted">O link vale por 60 minutos.</p>
      <form method="post" action="/esqueci-senha" class="form" novalidate>
        ${csrfInput(csrf)}
        ${field({ id: 'email', label: 'E-mail', type: 'email', autocomplete: 'username', required: true, placeholder: 'nome@email.com' })}
        <button class="btn btn--primary btn--lg btn--block" type="submit">Enviar link</button>
      </form>
      <p class="muted small center"><a href="/entrar">Voltar para o login</a></p>`,
  });
}

function reset({ cfg, csrf, flash, token, errors = {}, invalid = false }) {
  return shellAuth({
    cfg, title: 'Nova senha', flash,
    heading: html`Crie sua <b class="accent">nova senha.</b>`,
    lead: 'Escolha uma senha só sua. Depois é só entrar.',
    pose: 'ola', bubble: 'Quase lá!',
    content: invalid ? html`
      <h2 class="t-card">Link inválido</h2>
      <p class="muted">Este link já foi usado ou expirou. Peça um novo para continuar.</p>
      <a class="btn btn--primary btn--lg btn--block" href="/esqueci-senha">Pedir novo link</a>` : html`
      <h2 class="t-card">Nova senha</h2>
      <form method="post" action="/redefinir-senha/${token}" class="form" novalidate>
        ${csrfInput(csrf)}
        ${field({ id: 'nova', name: 'password', label: 'Nova senha', type: 'password', autocomplete: 'new-password', required: true, password: true, error: errors.password, note: 'Mínimo de 8 caracteres, com letras e números.' })}
        ${field({ id: 'confirmar', name: 'confirm', label: 'Confirmar nova senha', type: 'password', autocomplete: 'new-password', required: true, password: true, error: errors.confirm })}
        <button class="btn btn--primary btn--lg btn--block" type="submit">Salvar nova senha</button>
      </form>`,
  });
}

function errorPage({ cfg, status, message, loggedIn }) {
  return shellAuth({
    cfg, title: status === 404 ? 'Página não encontrada' : 'Algo deu errado',
    heading: html`${status === 404 ? 'Não achei essa' : 'Algo deu'} <b class="accent">${status === 404 ? 'página.' : 'errado.'}</b>`,
    lead: message, pose: 'pensa', bubble: 'Vamos voltar ao caminho certo?',
    content: html`<h2 class="t-card">${status === 404 ? 'Página não encontrada' : 'Não foi possível concluir'}</h2>
      <p class="muted">${message}</p>
      <a class="btn btn--primary btn--lg btn--block" href="${loggedIn ? '/' : '/entrar'}">${loggedIn ? 'Voltar ao início' : 'Ir para o login'}</a>`,
  });
}

module.exports = { login, firstAccess, forgot, reset, errorPage };
