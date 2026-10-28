'use strict';
const { html, raw } = require('../html');
const { shellApp, lumen } = require('../layout');
const { field, csrfInput } = require('./ui');
const { UFS } = require('../validation');

const fmtDate = (d) => new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const fmtTime = (d) => new Date(d).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
const DOC = { terms: 'Termos de uso', privacy: 'Política de privacidade' };

function titleRow(title, sub) {
  return html`<div class="title-row"><h1 class="t-display">${title}</h1>${sub ? html`<p class="muted">${sub}</p>` : ''}</div>`;
}

function adminHome({ cfg, user, csrf, flash, status }) {
  const row = (k, v, ok) => html`<div class="kv"><span>${k}</span><span class="${ok === false ? 'bad' : ok ? 'good' : ''}">${v}</span></div>`;
  return shellApp({
    cfg, user, csrf, flash, path: '/admin', title: 'Dashboard',
    content: html`${titleRow('Dashboard', 'Visão geral da EvoLumen Academy.')}
      <section class="card">
        <h2 class="t-card">Verificação do ambiente</h2>
        <p class="muted">O painel completo chega na Fase 5. Por enquanto, esta página confirma que a base está de pé.</p>
        <div class="kvs">
          ${row('Ambiente', cfg.appEnv)}
          ${row('Versão do sistema', cfg.version.display)}
          ${row('Fase entregue', String(cfg.version.phase))}
          ${row('Banco de dados', status.db ? 'Conectado' : 'Sem conexão', status.db)}
          ${row('Migrações aplicadas', String(status.migrations), status.migrations > 0)}
          ${row('E-mail (Resend)', status.mail ? `Configurado (${status.mailFrom})` : 'Não configurado', status.mail)}
          ${row('Endereço do sistema', cfg.baseUrl)}
          ${row('Conexão segura (HTTPS)', cfg.secureCookies ? 'Sim' : 'Não', cfg.secureCookies || !cfg.isProd)}
          ${row('Textos legais publicados', status.legalPublished > 0 ? `${status.legalPublished} de 2` : 'Nenhum ainda (rascunho)')}
        </div>
      </section>`,
  });
}

function perfil({ cfg, user, csrf, flash, errors = {}, values = null, acceptances = [], openRequests = {} }) {
  const v = values || user;
  const isStudent = user.role === 'student';
  const act = acceptances.length
    ? acceptances.map((a) => html`<li>${DOC[a.doc_type] || a.doc_type} ${a.version}: aceito em ${fmtDate(a.accepted_at)} às ${fmtTime(a.accepted_at)}</li>`)
    : html`<li class="muted">Nenhum aceite registrado ainda.</li>`;
  const content = html`${titleRow('Meu perfil', 'Seus dados, sua senha e sua privacidade.')}
    <section class="card">
      <h2 class="t-card">Meus dados</h2>
      <p class="muted">Mantenha seu cadastro atualizado: ele aparece no certificado.</p>
      <form method="post" action="/perfil" class="form form--grid" novalidate>
        ${csrfInput(csrf)}
        <div class="span2">${field({ id: 'name', label: 'Nome completo', value: v.name, error: errors.name, autocomplete: 'name', required: true })}</div>
        ${field({ id: 'phone', label: 'Telefone / WhatsApp', value: v.phone || '', error: errors.phone, autocomplete: 'tel', inputmode: 'tel' })}
        ${isStudent
          ? field({ id: 'cpf', label: 'CPF', value: user.cpf || '', readonly: true, note: 'O CPF só pode ser alterado pelo administrador.' })
          : field({ id: 'cpf', name: 'cpf', label: 'CPF', value: v.cpf || '', error: errors.cpf, inputmode: 'numeric', maxlength: 14, note: 'Aparece nos recibos e certificados.' })}
        ${field({ id: 'birth_date', label: 'Data de nascimento', type: 'date', value: v.birth_date || '', error: errors.birth_date, autocomplete: 'bday', note: 'Opcional. Usada só para o professor lembrar do seu aniversário.' })}
        ${field({ id: 'cep', label: 'CEP', value: v.cep || '', error: errors.cep, autocomplete: 'postal-code', inputmode: 'numeric' })}
        ${field({ id: 'street', label: 'Endereço', value: v.street || '', autocomplete: 'address-line1' })}
        ${field({ id: 'street_number', label: 'Número', value: v.street_number || '' })}
        ${field({ id: 'complement', label: 'Complemento', value: v.complement || '' })}
        ${field({ id: 'district', label: 'Bairro', value: v.district || '' })}
        ${field({ id: 'city', label: 'Cidade', value: v.city || '', autocomplete: 'address-level2' })}
        <div class="field${errors.state ? ' field--err' : ''}"><label for="state">UF</label>
          <select id="state" name="state" autocomplete="address-level1"><option value="">—</option>${UFS.map((u) => html`<option value="${u}"${v.state === u ? raw(' selected') : ''}>${u}</option>`)}</select>
          ${errors.state ? html`<div class="field__msg field__msg--err">${errors.state}</div>` : ''}</div>
        <div class="span2"><button class="btn btn--primary" type="submit">Salvar alterações</button></div>
      </form>
    </section>
    <section class="card">
      <h2 class="t-card">E-mail de acesso</h2>
      <p class="muted">É com este e-mail que você entra. Para trocar, pedimos uma confirmação em duas etapas.</p>
      <p class="kv kv--solo"><span>E-mail atual</span><b>${user.email}</b></p>
      <ol class="steps"><li>Você informa o novo e-mail.</li><li>Enviamos um código para o e-mail atual e outro para o novo.</li><li>Só depois de confirmar os dois a troca é feita.</li></ol>
      <div class="row">
        <a class="btn btn--outline" href="/perfil/email">${openRequests.pendingChange ? 'Continuar a troca de e-mail' : 'Alterar e-mail'}</a>
        ${isStudent ? html`<a class="btn btn--ghost" href="/perfil/email?admin=1">Pedir ao administrador</a>` : ''}
      </div>
    </section>
    <section class="card">
      <h2 class="t-card">Alterar senha</h2>
      <form method="post" action="/perfil/senha" class="form" novalidate>
        ${csrfInput(csrf)}
        ${field({ id: 'atual', name: 'current', label: 'Senha atual', type: 'password', autocomplete: 'current-password', required: true, password: true, error: errors.current })}
        ${field({ id: 'nova', name: 'password', label: 'Nova senha', type: 'password', autocomplete: 'new-password', required: true, password: true, error: errors.password, note: 'Mínimo de 8 caracteres, com letras e números.' })}
        ${field({ id: 'confirmar', name: 'confirm', label: 'Confirmar nova senha', type: 'password', autocomplete: 'new-password', required: true, password: true, error: errors.confirm })}
        <div><button class="btn btn--primary" type="submit">Salvar nova senha</button></div>
      </form>
    </section>
    <section class="card">
      <h2 class="t-card">Privacidade e aceites</h2>
      <ul class="plain">${act}</ul>
      <div class="row">
        <a class="btn btn--ghost" href="/perfil/meus-dados.json" download="meus-dados-evolumen.json">Baixar meus dados</a>
        <form method="post" action="/perfil/exclusao" class="inline" data-confirm="Pedir a exclusão da sua conta? O administrador analisa o pedido e responde por e-mail.">
          ${csrfInput(csrf)}<button class="btn btn--ghost" type="submit">${openRequests.deleteOpen ? 'Pedido de exclusão em análise' : 'Solicitar exclusão da conta'}</button></form>
      </div>
      ${isStudent ? html`<form method="post" action="/perfil/preferencias" class="form pref">${csrfInput(csrf)}
        <label class="check"><input type="checkbox" name="mascot" value="1"${user.mascot_enabled ? raw(' checked') : ''}><span>Mostrar a mascote Lumen nas telas</span></label>
        <button class="btn btn--ghost btn--sm" type="submit">Salvar preferência</button></form>` : ''}
    </section>`;
  return shellApp({ cfg, user, csrf, flash, path: '/perfil', title: 'Perfil', content });
}

function perfilEmail({ cfg, user, csrf, flash, errors = {}, pending = null, adminMode = false, newEmail = '' }) {
  const content = html`${titleRow('Trocar e-mail de acesso', 'Confirmação em duas etapas, para proteger sua conta.')}
    ${pending ? html`
    <section class="card">
      <h2 class="t-card">Digite os dois códigos</h2>
      <p class="muted">Enviamos um código para <b>${user.email}</b> e outro para <b>${pending.new_email}</b>. Eles valem por ${cfg.emailCodeMinutes} minutos.</p>
      <form method="post" action="/perfil/email/confirmar" class="form form--grid" novalidate>
        ${csrfInput(csrf)}
        ${field({ id: 'code_current', name: 'code_current', label: 'Código do e-mail atual', inputmode: 'numeric', maxlength: 6, autocomplete: 'one-time-code', required: true, error: errors.code_current })}
        ${field({ id: 'code_new', name: 'code_new', label: 'Código do novo e-mail', inputmode: 'numeric', maxlength: 6, autocomplete: 'one-time-code', required: true, error: errors.code_new })}
        <div class="span2 row"><button class="btn btn--primary" type="submit">Confirmar troca</button></div>
      </form>
      <form method="post" action="/perfil/email/cancelar" class="inline">${csrfInput(csrf)}<button class="btn btn--ghost btn--sm" type="submit">Cancelar a troca</button></form>
    </section>` : html`
    <section class="card">
      <h2 class="t-card">${adminMode ? 'Pedir ao administrador' : 'Informe o novo e-mail'}</h2>
      <p class="muted">${adminMode ? 'Se você não tem mais acesso ao e-mail atual, o administrador faz a troca depois de confirmar que é você.' : 'Vamos enviar um código para o e-mail atual e outro para o novo.'}</p>
      <form method="post" action="${adminMode ? '/perfil/email/admin' : '/perfil/email/solicitar'}" class="form" novalidate>
        ${csrfInput(csrf)}
        ${field({ id: 'new_email', name: 'new_email', label: 'Novo e-mail', type: 'email', value: newEmail, autocomplete: 'email', required: true, error: errors.new_email })}
        <div class="row"><button class="btn btn--primary" type="submit">${adminMode ? 'Enviar pedido' : 'Enviar códigos'}</button><a class="btn btn--ghost" href="/perfil">Voltar</a></div>
      </form>
    </section>`}`;
  return shellApp({ cfg, user, csrf, flash, path: '/perfil', title: 'Trocar e-mail', content });
}

function aceite({ cfg, user, csrf, flash, docs }) {
  const content = html`${titleRow('Termos e privacidade', 'Atualizamos nossos textos. Leia e aceite para continuar.')}
    <form method="post" action="/aceite" class="form">${csrfInput(csrf)}
      ${docs.map((d) => html`<section class="card"><h2 class="t-card">${d.title} <span class="pill">${d.version}</span></h2>
        <div class="legal" tabindex="0">${raw(d.body_html)}</div>
        <label class="check"><input type="checkbox" name="doc_${d.id}" value="1" required><span>Li e aceito: ${d.title}, versão ${d.version}.</span></label></section>`)}
      <p class="muted small">Registramos a data, a hora e o IP do seu aceite, como comprovante.</p>
      <div><button class="btn btn--primary btn--lg" type="submit">Aceitar e continuar</button></div>
    </form>`;
  return shellApp({ cfg, user, csrf, flash, path: '/aceite', title: 'Termos e privacidade', content });
}

module.exports = { adminHome, perfil, perfilEmail, aceite };
