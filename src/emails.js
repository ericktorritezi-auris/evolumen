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

function accessGranted(cfg, name, email, tempPassword, courseTitle, { gift = false, noun = 'curso' } = {}) {
  const first = esc(String(name).split(' ')[0]);
  const url = `${cfg.baseUrl}/entrar`;
  return {
    subject: gift ? `Um presente para você: ${courseTitle}` : 'Seu acesso à EvoLumen Academy',
    template: gift ? 'cortesia_acesso' : 'acesso_liberado',
    html: layout({ cfg, title: gift ? `Você ganhou um ${noun}` : 'Seu acesso está liberado',
      intro: gift ? `Olá, ${first}. O ${noun} <b>${esc(courseTitle)}</b> foi concedido a você como cortesia, sem nenhum custo.` : `Olá, ${first}. Você agora tem acesso ao ${noun} <b>${esc(courseTitle)}</b>.`,
      bodyHtml: `<p style="margin:14px 0 4px;font-size:14px">Login: <b>${esc(email)}</b></p><p style="margin:0 0 14px;font-size:14px">Senha provisória: <b style="letter-spacing:1px">${esc(tempPassword)}</b></p>`,
      cta: { url, label: 'Entrar na área de membros' }, outro: 'No primeiro acesso você escolhe sua própria senha. Guarde este e-mail só até lá.' }),
    text: `Olá, ${name}. ${gift ? `O ${noun} ${courseTitle} foi concedido a você como cortesia, sem custo.` : `Seu acesso ao ${noun} ${courseTitle} está liberado.`}\nLogin: ${email}\nSenha provisória: ${tempPassword}\nEntre em: ${url}\nNo primeiro acesso você escolhe sua própria senha.`,
  };
}

function courseGranted(cfg, name, courseTitle, slug, { gift = false, noun = 'curso' } = {}) {
  const first = esc(String(name).split(' ')[0]);
  const url = `${cfg.baseUrl}/curso/${slug}`;
  return {
    subject: gift ? `Um presente para você: ${courseTitle}` : `Acesso liberado: ${courseTitle}`,
    template: gift ? 'cortesia_curso' : 'curso_liberado',
    html: layout({ cfg, title: gift ? `Você ganhou um ${noun}` : `Novo ${noun} liberado`,
      intro: gift ? `Olá, ${first}. O ${noun} <b>${esc(courseTitle)}</b> foi concedido a você como cortesia, sem nenhum custo. Ele já está na sua área de membros.` : `Olá, ${first}. Você agora tem acesso ao ${noun} <b>${esc(courseTitle)}</b>.`,
      cta: { url, label: `Abrir o ${noun}` } }),
    text: gift ? `Olá, ${name}. O ${noun} ${courseTitle} foi concedido a você como cortesia, sem custo: ${url}` : `Olá, ${name}. Você agora tem acesso ao ${noun} ${courseTitle}: ${url}`,
  };
}

// Convite com cupom: não libera acesso. A pessoa precisa pagar usando o cupom.
function couponInvite(cfg, name, { code, discount, courses, link, validity }) {
  const first = name ? esc(String(name).split(' ')[0]) : '';
  const list = courses.length > 1 ? `nos produtos ${courses.map(esc).join(', ')}` : `no produto <b>${esc(courses[0])}</b>`;
  return {
    subject: `Seu cupom de desconto da EvoLumen Academy: ${code}`,
    template: 'cupom_convite',
    html: layout({ cfg, title: 'Seu cupom de desconto', intro: `${first ? `Olá, ${first}. ` : 'Olá. '}Separamos um desconto de <b>${esc(discount)}</b> para você ${list}.`,
      bodyHtml: `<p style="margin:16px 0 4px;font-size:13px;color:#5A6088">Seu cupom</p><p style="margin:0 0 6px;font-size:28px;letter-spacing:3px;font-weight:700;color:#0B0F26">${esc(code)}</p>${validity ? `<p style="margin:0 0 6px;font-size:13px;color:#5A6088">${esc(validity)}</p>` : ''}`,
      cta: { url: link, label: 'Ver o produto com o cupom' }, outro: 'Digite o cupom na hora do pagamento. O desconto só vale depois que o pagamento for aprovado e o acesso ao produto é liberado no mesmo momento.' }),
    text: `${first ? `Olá, ${name}. ` : ''}Seu cupom de desconto (${discount}): ${code}\n${validity || ''}\nAbra: ${link}\nUse o cupom na hora do pagamento. O acesso ao produto só é liberado depois da aprovação do pagamento.`,
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

const brl = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const nn = (c) => (c && c.product_type === 'download' ? 'produto' : 'curso');
const first = (n) => esc(String(n).split(' ')[0]);

// Compra aprovada. Conta nova: leva login e senha provisória. Conta existente: só avisa do curso.
function purchaseApproved(cfg, { name, email, password, course, order, renewal, expiresLabel }) {
  const url = password ? `${cfg.baseUrl}/entrar` : `${cfg.baseUrl}/curso/${course.slug}`;
  const intro = renewal ? `Olá, ${first(name)}. Sua renovação do ${nn(course)} <b>${esc(course.title)}</b> foi confirmada.` : `Olá, ${first(name)}. Seu pagamento foi aprovado e o ${nn(course)} <b>${esc(course.title)}</b> já está liberado para você.`;
  const resumo = `<p style="margin:14px 0 4px;font-size:14px">Valor pago: <b>${brl(order.paid_cents || order.price_cents)}</b></p>${expiresLabel ? `<p style="margin:0 0 4px;font-size:14px">Acesso até: <b>${esc(expiresLabel)}</b></p>` : '<p style="margin:0 0 4px;font-size:14px">Acesso: <b>vitalício</b></p>'}`;
  const cred = password ? `<p style="margin:14px 0 4px;font-size:14px">Login: <b>${esc(email)}</b></p><p style="margin:0 0 14px;font-size:14px">Senha provisória: <b style="letter-spacing:1px">${esc(password)}</b></p>` : '';
  return {
    subject: renewal ? `Renovação confirmada: ${course.title}` : `Pagamento aprovado: ${course.title}`,
    template: renewal ? 'compra_renovacao' : (password ? 'compra_acesso' : 'compra_curso'),
    html: layout({ cfg, title: renewal ? 'Renovação confirmada' : 'Pagamento aprovado', intro, bodyHtml: resumo + cred,
      cta: { url, label: password ? 'Entrar na área de membros' : (nn(course) === 'produto' ? 'Abrir o produto' : 'Abrir o curso') },
      outro: `Você pode pedir reembolso em até ${cfg.refundDays} dias após a compra, em Pagamentos e acessos.${password ? ' No primeiro acesso você escolhe sua própria senha.' : ''}` }),
    text: `Olá, ${name}. ${renewal ? 'Renovação confirmada' : 'Pagamento aprovado'}: ${course.title}.\nValor: ${brl(order.paid_cents || order.price_cents)}\n${password ? `Login: ${email}\nSenha provisória: ${password}\n` : ''}Acesse: ${url}\nReembolso em até ${cfg.refundDays} dias, em Pagamentos e acessos.`,
  };
}

// Pix que venceu sem pagamento: convida a tentar de novo.
function pixExpired(cfg, { name, course, retryUrl }) {
  return {
    subject: `Seu Pix venceu: ${course.title}`, template: 'pix_vencido',
    html: layout({ cfg, title: 'Seu Pix venceu', intro: `Olá, ${first(name)}. O Pix do ${nn(course)} <b>${esc(course.title)}</b> venceu antes de ser pago. Nada foi cobrado.`,
      cta: { url: retryUrl, label: 'Tentar de novo' }, outro: 'Se você já pagou, não se preocupe: a confirmação pode levar alguns minutos e o acesso chega por e-mail.' }),
    text: `Olá, ${name}. O Pix do ${nn(course)} ${course.title} venceu sem pagamento. Nada foi cobrado. Tente de novo: ${retryUrl}`,
  };
}

function refundDone(cfg, { name, course, amountCents }) {
  return {
    subject: `Reembolso realizado: ${course.title}`, template: 'reembolso_feito',
    html: layout({ cfg, title: 'Reembolso realizado', intro: `Olá, ${first(name)}. Devolvemos <b>${brl(amountCents)}</b> do ${nn(course)} <b>${esc(course.title)}</b> e o acesso foi encerrado.`,
      outro: 'O valor volta pela mesma forma de pagamento. O prazo para aparecer na fatura ou na conta depende do banco ou do cartão.' }),
    text: `Olá, ${name}. Devolvemos ${brl(amountCents)} do ${nn(course)} ${course.title} e o acesso foi encerrado. O prazo para o valor aparecer depende do seu banco ou cartão.`,
  };
}

function refundRejected(cfg, { name, course, note }) {
  return {
    subject: `Sobre o seu pedido de reembolso: ${course.title}`, template: 'reembolso_recusado',
    html: layout({ cfg, title: 'Pedido de reembolso analisado', intro: `Olá, ${first(name)}. Analisamos o pedido de reembolso do ${nn(course)} <b>${esc(course.title)}</b> e, desta vez, não foi aprovado.`,
      bodyHtml: note ? `<p style="margin:12px 0;font-size:14px;line-height:1.6">${esc(note)}</p>` : '', outro: 'Seu acesso ao ${nn(course)} continua normal.' }),
    text: `Olá, ${name}. O pedido de reembolso do ${nn(course)} ${course.title} não foi aprovado.${note ? ' ' + note : ''} Seu acesso continua normal.`,
  };
}

// Aviso ao aluno: o administrador liberou mais tentativas numa avaliação.
function attemptsGranted(cfg, { name, course, assessment, count, url }) {
  const n = Number(count);
  const qtd = n === 1 ? 'mais uma tentativa' : `mais ${n} tentativas`;
  return {
    subject: `${n === 1 ? 'Mais uma tentativa liberada' : `Mais ${n} tentativas liberadas`} para você: ${assessment}`, template: 'tentativas_liberadas',
    html: layout({ cfg, title: n === 1 ? 'Mais uma tentativa liberada' : `Mais ${n} tentativas liberadas`,
      intro: `Olá, ${first(name)}. Liberamos ${qtd} para você em <b>${esc(assessment)}</b>, do ${nn(course)} <b>${esc(course.title)}</b>.`,
      cta: { url, label: 'Fazer a avaliação' }, outro: 'Revise o conteúdo com calma e tente quando se sentir pronto. Boa sorte!' }),
    text: `Olá, ${name}. Liberamos ${qtd} para você em ${assessment}, do ${nn(course)} ${course.title}. Acesse: ${url}`,
  };
}

// Programa de afiliados (1.2.0).
function affiliateInvite(cfg, { name, email, password }) {
  const url = `${cfg.baseUrl}/entrar`;
  return {
    subject: 'Você foi convidado para o Programa de Afiliados da EvoLumen Academy', template: 'afiliado_convite',
    html: layout({ cfg, title: 'Convite para o Programa de Afiliados',
      intro: `Olá, ${first(name)}. Você foi convidado para o Programa de Afiliados da EvoLumen Academy. No seu painel você acompanha seus cupons, suas vendas e suas comissões.`,
      bodyHtml: `<p style="margin:14px 0 4px;font-size:14px">Login: <b>${esc(email)}</b></p><p style="margin:0 0 14px;font-size:14px">Senha provisória: <b style="letter-spacing:1px">${esc(password)}</b></p>`,
      cta: { url, label: 'Entrar no painel do afiliado' }, outro: 'No primeiro acesso você escolhe sua própria senha e lê e aceita o Termo do Programa de Afiliados.' }),
    text: `Olá, ${name}. Você foi convidado para o Programa de Afiliados da EvoLumen Academy.\nLogin: ${email}\nSenha provisória: ${password}\nEntre em: ${url}\nNo primeiro acesso você escolhe sua própria senha e lê e aceita o Termo do Programa de Afiliados.`,
  };
}
// Quem já tinha conta de aluno: nada de senha nova, só o aviso de que o painel apareceu no menu.
function affiliateLinked(cfg, { name }) {
  const url = `${cfg.baseUrl}/afiliado`;
  return {
    subject: 'Seu painel de afiliado da EvoLumen Academy está liberado', template: 'afiliado_vinculado',
    html: layout({ cfg, title: 'Painel de afiliado liberado',
      intro: `Olá, ${first(name)}. Você agora faz parte do Programa de Afiliados da EvoLumen Academy. Entre com o seu login e a senha de sempre: o menu <b>Afiliado</b> já está lá.`,
      cta: { url, label: 'Abrir o painel do afiliado' }, outro: 'Ao entrar, leia e aceite o Termo do Programa de Afiliados. Seu acesso aos seus produtos não muda.' }),
    text: `Olá, ${name}. Você agora faz parte do Programa de Afiliados da EvoLumen Academy. Entre com o seu login e a senha de sempre e abra o menu Afiliado: ${url}\nAo entrar, leia e aceite o Termo do Programa de Afiliados.`,
  };
}
function payoutRecorded(cfg, { name, amountCents, paidOn }) {
  const url = `${cfg.baseUrl}/afiliado`;
  const when = new Date(paidOn + 'T12:00:00').toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  return {
    subject: 'Repasse registrado na EvoLumen Academy', template: 'afiliado_repasse',
    html: layout({ cfg, title: 'Repasse registrado',
      intro: `Olá, ${first(name)}. Registramos um repasse de <b>${brl(amountCents)}</b> para você, com data de ${when}.`,
      cta: { url, label: 'Ver no painel do afiliado' }, outro: 'Se algo não bater com o que você recebeu, responda a quem combinou o pagamento com você em até 30 dias.' }),
    text: `Olá, ${name}. Registramos um repasse de ${brl(amountCents)} para você, com data de ${when}. Veja no painel: ${url}`,
  };
}

function refundRequested(cfg, { student, course, reason, orderId }) {
  const url = `${cfg.baseUrl}/admin/vendas/${orderId}`;
  return {
    subject: `Pedido de reembolso: ${course.title}`, template: 'reembolso_pedido_admin',
    html: layout({ cfg, title: 'Novo pedido de reembolso', intro: `<b>${esc(student.name)}</b> (${esc(student.email)}) pediu reembolso do ${nn(course)} <b>${esc(course.title)}</b>.`,
      bodyHtml: reason ? `<p style="margin:12px 0;font-size:14px;line-height:1.6">Motivo informado: ${esc(reason)}</p>` : '', cta: { url, label: 'Analisar o pedido' } }),
    text: `${student.name} (${student.email}) pediu reembolso do ${nn(course)} ${course.title}. ${reason || ''}\nAnalisar: ${url}`,
  };
}

function forumQuestion(cfg, { student, course, lesson, body, postId }) {
  const url = `${cfg.baseUrl}/curso/${course.slug}/aula/${lesson.id}#post-${postId}`;
  return {
    subject: `Nova dúvida no fórum: ${lesson.title}`, template: 'forum_pergunta_admin',
    html: layout({ cfg, title: 'Nova dúvida no fórum', intro: `<b>${esc(student.name)}</b> escreveu na aula <b>${esc(lesson.title)}</b> do curso <b>${esc(course.title)}</b>.`,
      bodyHtml: `<p style="margin:12px 0;font-size:14px;line-height:1.6;white-space:pre-wrap">${esc(String(body).slice(0, 600))}</p>`, cta: { url, label: 'Responder' } }),
    text: `${student.name} escreveu na aula "${lesson.title}" (${course.title}):\n${String(body).slice(0, 600)}\nResponder: ${url}`,
  };
}

function forumAnswer(cfg, { name, course, lesson, body, postId }) {
  const url = `${cfg.baseUrl}/curso/${course.slug}/aula/${lesson.id}#post-${postId}`;
  const first = esc(String(name).split(' ')[0]);
  return {
    subject: `O professor respondeu a sua dúvida: ${lesson.title}`, template: 'forum_resposta_aluno',
    html: layout({ cfg, title: 'Sua dúvida foi respondida', intro: `Olá, ${first}. O professor respondeu na aula <b>${esc(lesson.title)}</b> do curso <b>${esc(course.title)}</b>.`,
      bodyHtml: `<p style="margin:12px 0;font-size:14px;line-height:1.6;white-space:pre-wrap">${esc(String(body).slice(0, 600))}</p>`, cta: { url, label: 'Ver no fórum' } }),
    text: `Olá, ${name}. O professor respondeu na aula "${lesson.title}":\n${String(body).slice(0, 600)}\nVer: ${url}`,
  };
}

function accessExpiring(cfg, { name, course, days, whenLabel }) {
  const first = esc(String(name).split(' ')[0]);
  const url = `${cfg.baseUrl}/curso/${course.slug}`;
  const left = days <= 0 ? 'vence hoje' : days === 1 ? 'vence amanhã' : `vence em ${days} dias`;
  return {
    subject: `Seu acesso a "${course.title}" ${left}`, template: 'acesso_vencendo',
    html: layout({ cfg, title: 'Seu acesso está perto de vencer', intro: `Olá, ${first}. Seu acesso ao ${nn(course)} <b>${esc(course.title)}</b> ${left} (${esc(whenLabel)}).`,
      bodyHtml: `<p style="margin:12px 0;font-size:14px;line-height:1.6">${nn(course) === 'produto' ? 'Baixe os arquivos que ainda precisar enquanto o acesso está ativo.' : 'Aproveite para terminar as aulas e emitir o certificado.'} Se precisar de mais tempo, você pode renovar o acesso.</p>`, cta: { url, label: nn(course) === 'produto' ? 'Abrir o produto' : 'Continuar o curso' } }),
    text: `Olá, ${name}. Seu acesso a "${course.title}" ${left} (${whenLabel}). Continue em ${url}`,
  };
}

function courseNews(cfg, { name, course, message }) {
  const first = esc(String(name).split(' ')[0]);
  const url = `${cfg.baseUrl}/curso/${course.slug}`;
  const noun = course.product_type === 'download' ? 'produto' : 'curso';
  return {
    subject: `Novidade: ${course.title}`, template: 'novidade',
    html: layout({ cfg, title: 'Tem novidade para você', intro: `Olá, ${first}. O ${noun} <b>${esc(course.title)}</b> tem uma novidade.`,
      bodyHtml: `<p style="margin:12px 0;font-size:14px;line-height:1.6">${esc(message)}</p>`, cta: { url, label: `Abrir o ${noun}` } }),
    text: `Olá, ${name}. O ${noun} "${course.title}" tem uma novidade: ${message}. Veja em ${url}`,
  };
}

function productUpdated(cfg, { name, product }) {
  const first = esc(String(name).split(' ')[0]);
  const url = `${cfg.baseUrl}/curso/${product.slug}`;
  return {
    subject: `Atualização disponível: ${product.title}`, template: 'produto_atualizado',
    html: layout({ cfg, title: 'Tem novidade para você', intro: `Olá, ${first}. O produto <b>${esc(product.title)}</b> recebeu arquivos novos ou atualizados.`,
      bodyHtml: '<p style="margin:12px 0;font-size:14px;line-height:1.6">Entre na sua conta para baixar a versão mais recente.</p>', cta: { url, label: 'Baixar agora' } }),
    text: `Olá, ${name}. "${product.title}" recebeu arquivos novos ou atualizados. Baixe em ${url}`,
  };
}

function dataRequestDone(cfg, { name, kind, ok, note }) {
  const first = esc(String(name).split(' ')[0]);
  const what = kind === 'delete' ? 'exclusão dos seus dados' : kind === 'export' ? 'cópia dos seus dados' : 'pedido sobre os seus dados';
  return {
    subject: ok ? `Seu pedido de ${what} foi atendido` : `Sobre o seu pedido de ${what}`, template: 'lgpd_resposta',
    html: layout({ cfg, title: ok ? 'Pedido atendido' : 'Resposta ao seu pedido', intro: `Olá, ${first}. ${ok ? `Seu pedido de ${what} foi atendido.` : `Analisamos seu pedido de ${what}.`}`,
      bodyHtml: note ? `<p style="margin:12px 0;font-size:14px;line-height:1.6">${esc(note)}</p>` : '' }),
    text: `Olá, ${name}. ${ok ? `Seu pedido de ${what} foi atendido.` : `Analisamos seu pedido de ${what}.`} ${note || ''}`,
  };
}

module.exports = { affiliateInvite, affiliateLinked, payoutRecorded, courseNews, productUpdated, accessExpiring, forumQuestion, forumAnswer, dataRequestDone, purchaseApproved, pixExpired, refundDone, refundRejected, refundRequested, attemptsGranted, accessGranted, courseGranted, couponInvite, resetPassword, passwordChanged, emailChangeCode, emailChanged, adminEmailRequest };
