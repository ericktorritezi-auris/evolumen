'use strict';
// Modelos dos e-mails. Visual do desenho aprovado: faixa escura com a marca, cartão claro e botão âmbar.
const { esc } = require('./html');

function layout({ title, intro, bodyHtml, cta, outro, cfg }) {
  const button = cta
    ? `<p style="margin:26px 0"><a href="${esc(cta.url)}" style="display:inline-block;background:#FFB257;color:#0B0F26;font-weight:700;text-decoration:none;border-radius:999px;padding:14px 28px;font-size:15px">${esc(cta.label)}</a></p>
       <p style="margin:0 0 6px;font-size:12px;color:#5A6088">Se o botão não abrir, copie este endereço no navegador:<br><span style="word-break:break-all">${esc(cta.url)}</span></p>` : '';
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#EDEFFB;font-family:Arial,Helvetica,sans-serif;color:#1B2145">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EDEFFB"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:18px;overflow:hidden">
<tr><td style="background:#0B0F26;padding:22px 28px;color:#EDEFFB;font-size:22px;letter-spacing:.5px">Evo<b>Lumen</b> <span style="font-size:11px;letter-spacing:3px;color:#8E9BFF">ACADEMY</span></td></tr>
<tr><td style="height:4px;background:#FFB257;font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="padding:30px 28px 24px">
<h1 style="margin:0 0 14px;font-size:22px;font-weight:600">${esc(title)}</h1>
<p style="margin:0 0 14px;font-size:15px;line-height:1.6">${intro}</p>
${bodyHtml || ''}${button}
${outro ? `<p style="margin:18px 0 0;font-size:13px;line-height:1.6;color:#5A6088">${outro}</p>` : ''}
</td></tr>
<tr><td style="padding:16px 28px 24px;border-top:1px solid #D9DCEF;font-size:12px;color:#5A6088;line-height:1.6">EvoLumen Academy · Evolua com clareza.<br>Mais um produto Belle Planner.</td></tr>
</table></td></tr></table></body></html>`;
}

function resetPassword(cfg, name, url) {
  const first = esc(String(name).split(' ')[0]);
  return {
    subject: 'Redefinir sua senha na EvoLumen Academy',
    template: 'reset_senha',
    html: layout({ cfg, title: 'Redefinir sua senha', intro: `Olá, ${first}. Recebemos um pedido para criar uma nova senha. O link vale por ${cfg.resetTokenMinutes} minutos e só pode ser usado uma vez.`,
      cta: { url, label: 'Criar nova senha' }, outro: 'Se você não fez esse pedido, ignore este e-mail. Sua senha continua a mesma.' }),
    text: `Olá, ${name}. Para criar uma nova senha, abra: ${url}\nO link vale por ${cfg.resetTokenMinutes} minutos. Se não foi você, ignore este e-mail.`,
  };
}

function passwordChanged(cfg, name) {
  const first = esc(String(name).split(' ')[0]);
  return {
    subject: 'Sua senha da EvoLumen Academy foi alterada',
    template: 'senha_alterada',
    html: layout({ cfg, title: 'Senha alterada', intro: `Olá, ${first}. A senha da sua conta acaba de ser alterada.`,
      outro: 'Se não foi você, use "Esqueci minha senha" na tela de login para criar uma nova e avise o suporte.' }),
    text: `Olá, ${name}. A senha da sua conta acaba de ser alterada. Se não foi você, use "Esqueci minha senha" na tela de login.`,
  };
}

function emailChangeCode(cfg, name, code, kind, newEmail) {
  const first = esc(String(name).split(' ')[0]);
  const where = kind === 'current' ? 'Este código chegou ao seu e-mail atual.' : 'Este código chegou ao novo e-mail.';
  return {
    subject: 'Código para trocar o e-mail da EvoLumen Academy',
    template: kind === 'current' ? 'troca_email_codigo_atual' : 'troca_email_codigo_novo',
    html: layout({ cfg, title: 'Confirme a troca de e-mail', intro: `Olá, ${first}. Pediram para trocar o e-mail de acesso para <b>${esc(newEmail)}</b>. ${where}`,
      bodyHtml: `<p style="margin:18px 0;font-size:34px;letter-spacing:8px;font-weight:700;color:#0B0F26">${esc(code)}</p>`,
      outro: `A troca só acontece depois de digitar os dois códigos (o do e-mail atual e o do novo). Vale por ${cfg.emailCodeMinutes} minutos. Se não foi você, ignore este e-mail.` }),
    text: `Código para trocar o e-mail para ${newEmail}: ${code}. Vale por ${cfg.emailCodeMinutes} minutos. A troca só acontece com os dois códigos.`,
  };
}

function accessGranted(cfg, name, email, tempPassword, courseTitle) {
  const first = esc(String(name).split(' ')[0]);
  const url = `${cfg.baseUrl}/entrar`;
  return {
    subject: 'Seu acesso à EvoLumen Academy',
    template: 'acesso_liberado',
    html: layout({ cfg, title: 'Seu acesso está liberado', intro: `Olá, ${first}. Você agora tem acesso ao curso <b>${esc(courseTitle)}</b>.`,
      bodyHtml: `<p style="margin:14px 0 4px;font-size:14px">Login: <b>${esc(email)}</b></p><p style="margin:0 0 14px;font-size:14px">Senha provisória: <b style="letter-spacing:1px">${esc(tempPassword)}</b></p>`,
      cta: { url, label: 'Entrar na área de membros' }, outro: 'No primeiro acesso você escolhe sua própria senha. Guarde este e-mail só até lá.' }),
    text: `Olá, ${name}. Seu acesso ao curso ${courseTitle} está liberado.\nLogin: ${email}\nSenha provisória: ${tempPassword}\nEntre em: ${url}\nNo primeiro acesso você escolhe sua própria senha.`,
  };
}

function courseGranted(cfg, name, courseTitle, slug) {
  const first = esc(String(name).split(' ')[0]);
  const url = `${cfg.baseUrl}/curso/${slug}`;
  return {
    subject: `Acesso liberado: ${courseTitle}`,
    template: 'curso_liberado',
    html: layout({ cfg, title: 'Novo curso liberado', intro: `Olá, ${first}. Você agora tem acesso ao curso <b>${esc(courseTitle)}</b>.`, cta: { url, label: 'Abrir o curso' } }),
    text: `Olá, ${name}. Você agora tem acesso ao curso ${courseTitle}: ${url}`,
  };
}

function emailChanged(cfg, name, newEmail) {
  const first = esc(String(name).split(' ')[0]);
  return {
    subject: 'O e-mail da sua conta EvoLumen foi alterado',
    template: 'email_alterado',
    html: layout({ cfg, title: 'E-mail alterado', intro: `Olá, ${first}. O e-mail de acesso da sua conta agora é <b>${esc(newEmail)}</b>.`,
      outro: 'Se não foi você, responda a este aviso ou fale com o suporte.' }),
    text: `Olá, ${name}. O e-mail de acesso da sua conta agora é ${newEmail}.`,
  };
}

function adminEmailRequest(cfg, student, newEmail) {
  return {
    subject: 'Pedido de troca de e-mail de um aluno',
    template: 'pedido_troca_email_admin',
    html: layout({ cfg, title: 'Pedido de troca de e-mail', intro: `${esc(student.name)} (${esc(student.email)}) pediu para trocar o e-mail de acesso para <b>${esc(newEmail)}</b>.`,
      outro: 'Confirme com o aluno antes de alterar. A troca pelo painel chega na próxima fase.' }),
    text: `${student.name} (${student.email}) pediu para trocar o e-mail de acesso para ${newEmail}.`,
  };
}

module.exports = { accessGranted, courseGranted, resetPassword, passwordChanged, emailChangeCode, emailChanged, adminEmailRequest };
