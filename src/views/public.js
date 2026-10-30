'use strict';
const { html, raw } = require('../html');
const { shortName } = require('./ui');
const { shellPublic, lumen } = require('../layout');
const { icon } = require('../header');
const C = require('../courses');
const { sanitizeHtml } = require('../legal');

const dur = (min) => (!min ? '' : min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ' ' + (min % 60) + ' min' : ''}` : `${min} min`);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function priceBlock(c) {
  const p = C.effectivePrice(c);
  if (p.cents === 0) return html`<span class="price">Gratuito</span>`;
  return html`${p.original ? html`<s class="price__old">${C.brl(p.original)}</s>` : ''}<span class="price">${C.brl(p.cents)}</span>`;
}

function coverBox(c, cls = '') {
  return c.cover_file_id
    ? html`<img class="cover ${cls}" src="/capas/${c.cover_file_id}" alt="" loading="lazy">`
    : html`<div class="cover cover--empty ${cls}" aria-hidden="true">${lumen('guia', 72)}</div>`;
}

// Aviso de cupom (?cupom=). Ainda não há pagamento online: o desconto é aplicado na hora de pagar.
function couponBanner(coupon) {
  if (!coupon) return '';
  if (coupon.invalid) return html`<div class="alert alert--error" role="alert">Este cupom não está disponível. Ele pode ter vencido, esgotado ou não valer para este produto.</div>`;
  return html`<div class="alert alert--success" role="status">Cupom <b>${coupon.code}</b> guardado: ${coupon.label} de desconto.
    ${coupon.price ? html`Neste produto, de <s>${C.brl(coupon.price.original)}</s> por <b>${C.brl(coupon.price.cents)}</b>.` : ''}
    Ele vale no pagamento e substitui o preço promocional, se houver.
    ${coupon.promoCheaper ? html`<b>Atenção:</b> a promoção atual deste produto está igual ou mais barata que o cupom.` : ''}</div>`;
}

const starLine = (r) => (r ? html`<span class="rating" title="${r.n} avaliações">★ ${String(r.avg).replace('.', ',')} <small>(${r.n})</small></span>` : '');

function courseCard(c) {
  return html`<article class="ccard">
    <a class="ccard__cover" href="/cursos/${c.slug}" tabindex="-1" aria-hidden="true">${coverBox(c)}</a>
    <div class="ccard__body">
      <div class="ccard__tags">${c.featured ? html`<span class="pill pill--star">Destaque</span>` : ''}${c.product_type === 'download' ? html`<span class="pill pill--prod">${c.category || 'Produto digital'}</span>` : (c.category ? html`<span class="pill">${c.category}</span>` : '')}</div>
      <h3 class="ccard__title"><a href="/cursos/${c.slug}">${c.title}</a></h3>
      ${starLine(c.rating)}
      ${c.summary ? html`<p class="muted">${c.summary}</p>` : ''}
      <ul class="chips">${c.product_type === 'download' ? html`<li>${plural(c.n_files, 'arquivo', 'arquivos')}</li>` : ''}${c.workload_hours ? html`<li>${c.workload_hours} h</li>` : ''}${c.videos ? html`<li>${plural(c.videos, 'vídeo', 'vídeos')}</li>` : ''}${c.level !== 'nao_se_aplica' ? html`<li>${C.LEVELS[c.level]}</li>` : ''}</ul>
      <div class="ccard__foot">${priceBlock(c)}<a class="btn btn--outline btn--sm" href="/cursos/${c.slug}">${c.product_type === 'download' ? 'Ver produto →' : 'Ver curso →'}</a></div>
    </div>
  </article>`;
}

function landing({ cfg, user, courses, coupon }) {
  const content = html`
${couponBanner(coupon)}
<section class="hero">
  <div class="hero__text">
    <span class="eyebrow">Saúde emocional · cursos e produtos digitais</span>
    <h1 class="t-hero">Evolua com <b class="accent">clareza.</b></h1>
    <p class="lead">Cursos e produtos digitais de autoconhecimento e transformação do comportamento humano: videoaulas, e-books, apostilas e ferramentas para você evoluir no seu ritmo.</p>
    <div class="row"><a class="btn btn--primary btn--lg" href="#cursos">Ver os produtos</a><a class="btn btn--ghost btn--lg" href="${user ? '/meus-cursos' : '/entrar'}">Área de membros</a></div>
  </div>
  <div class="hero__lumen">${lumen('ola', 170)}<div class="bubble">Oi! Eu sou a Lumen. Vou te guiar por aqui.</div></div>
</section>

<section class="sec" id="sobre">
  <div class="sec__in">
    <span class="eyebrow">Sobre a EvoLumen</span>
    <h2 class="t-sec">Onde o autoconhecimento <b class="accent">acende.</b></h2>
    <p class="lead">A EvoLumen Academy é uma plataforma de produtos de saúde emocional, entre eles cursos online e produtos digitais, criada para quem quer entender a si mesmo e transformar hábitos, crenças e emoções. Os cursos reúnem videoaulas e material de apoio, e os produtos digitais (e-books, áudios e ferramentas) ficam disponíveis para baixar, para você usar no seu ritmo.</p>
    <div class="trio">
      <div class="card">${icon('clock', 26)}<h3 class="t-card">Aprenda no seu ritmo</h3><p class="muted">Videoaulas, apostilas e arquivos disponíveis quando você quiser, no celular ou no computador.</p></div>
      <div class="card">${icon('video', 26)}<h3 class="t-card">Conteúdo organizado</h3><p class="muted">Módulos e aulas em sequência, com o seu progresso sempre salvo.</p></div>
      <div class="card">${icon('cert', 26)}<h3 class="t-card">Material para baixar</h3><p class="muted">Apostilas, e-books e arquivos de apoio para baixar, estudar e consultar depois.</p></div>
    </div>
  </div>
</section>

<section class="sec sec--alt" id="idealizador">
  <div class="sec__in prof">
    <img class="prof__photo" src="/static/img/erick.jpg" width="320" height="320" alt="Erick Torritezi" loading="lazy">
    <div>
      <span class="eyebrow">Quem criou a EvoLumen</span>
      <h2 class="t-sec">Erick Torritezi</h2>
      <p class="lead">Psicanalista, psicoterapeuta integrativo e master hipnoterapeuta, com mais de 15 anos de experiência em treinamentos e liderança de equipes. Dedica-se ao desenvolvimento humano e à transformação das pessoas, por meio do autoconhecimento. Autor dos livros <i>Vivendo GenuinaMENTE</i> e <i>Diálogo com o Criador</i>, é criador do Programa 4F de Desenvolvimento Humano.</p>
      <ul class="chips"><li>ABRAPH</li><li>ATH</li></ul>
    </div>
  </div>
</section>

<section class="sec" id="cursos">
  <div class="sec__in">
    <span class="eyebrow">Vitrine</span>
    <h2 class="t-sec">Nossos produtos</h2>
    ${courses.length
      ? html`<p class="muted">Escolha um curso ou produto digital e veja os detalhes.</p><div class="cgrid">${courses.map(courseCard)}</div>`
      : html`<div class="card empty">${lumen('pensa', 96)}<div><h3 class="t-card">Novidades em breve</h3><p class="muted">Estamos preparando os primeiros produtos. Volte em alguns dias.</p></div></div>`}
  </div>
</section>

<section class="sec sec--alt" id="como-funciona">
  <div class="sec__in">
    <span class="eyebrow">Como funciona</span>
    <h2 class="t-sec">Do primeiro clique ao seu acesso</h2>
    <ol class="how">
      <li><b>Escolha o produto</b><span class="muted">Veja os detalhes do curso ou do produto digital e o que você vai receber.</span></li>
      <li><b>Cadastre-se e pague</b><span class="muted">Preencha seus dados e pague por Pix ou cartão.</span></li>
      <li><b>Receba seu acesso</b><span class="muted">Login e senha chegam no seu e-mail.</span></li>
      <li><b>Use no seu ritmo</b><span class="muted">Assista às aulas, baixe seus arquivos e acompanhe seu progresso.</span></li>
    </ol>
  </div>
</section>

<section class="sec" id="perguntas">
  <div class="sec__in sec__in--narrow">
    <span class="eyebrow">Perguntas frequentes</span>
    <h2 class="t-sec">Ficou com dúvida?</h2>
    <div class="faq">
      <details><summary>Como recebo o acesso?</summary><p>Depois do pagamento confirmado, você recebe por e-mail o seu login e a sua senha, e pode entrar na área de membros, onde ficam seus cursos e produtos.</p></details>
      <details><summary>Posso estudar pelo celular?</summary><p>Sim. A plataforma foi pensada primeiro para o celular e pode ser instalada como um app na tela inicial.</p></details>
      <details><summary>Quanto tempo tenho de acesso?</summary><p>Depende do produto: acesso vitalício ou por um período definido (por exemplo, 6 meses ou 1 ano). A modalidade aparece na página de cada produto. Ao fim do período, você pode renovar.</p></details>
      <details><summary>Posso pedir reembolso?</summary><p>Sim, em até 7 dias após a compra, conforme o Código de Defesa do Consumidor. Depois disso, você mantém o acesso durante todo o período contratado.</p></details>
    </div>
  </div>
</section>

<section class="cta-band">
  <h2 class="t-sec">Pronto para evoluir com clareza?</h2>
  <p class="muted">Escolha seu produto e receba o acesso por e-mail.</p>
  <a class="btn btn--primary btn--lg" href="#cursos">Ver os produtos</a>
</section>`;
  return shellPublic({ cfg, user, title: 'Cursos e produtos de saúde emocional', description: 'EvoLumen Academy: cursos online e produtos digitais de autoconhecimento e saúde emocional.', content });
}

function coursePage({ cfg, user, course: c, cur, state, preview, coupon, buy = {}, items = [], rating = null, testimonials = [] }) {
  const dl = c.product_type === 'download';
  const lessons = cur.flatMap((m) => m.lessons);
  const videos = lessons.filter((l) => l.has_video || l.has_instagram).length;
  const materials = lessons.reduce((n, l) => n + (l.files ? l.files.length : 0), 0);
  const total = lessons.reduce((n, l) => n + (l.duration_min || 0), 0);
  const stat = (k, v) => html`<div class="stat"><span class="muted">${k}</span><b>${v}</b></div>`;
  const list = (items) => html`<ul class="tick">${items.map((i) => html`<li>${icon('check', 18)}<span>${i}</span></li>`)}</ul>`;
  const para = (t) => html`${String(t).split(/\n{2,}/).map((x) => html`<p>${x}</p>`)}`;
  const buyUrl = `/checkout/${c.slug}${coupon && coupon.code ? `?cupom=${encodeURIComponent(coupon.code)}` : ''}`;
  const cta = state === 'enrolled'
    ? html`<a class="btn btn--primary btn--lg btn--block" href="/curso/${c.slug}">${dl ? 'Baixar meus arquivos' : 'Ir para o curso'}</a>${buy.open && buy.renew ? html`<p class="muted small">Seu acesso termina em breve. <a href="/checkout/${c.slug}">Renovar agora</a>.</p>` : ''}`
    : state === 'expired'
      ? (buy.open ? html`<a class="btn btn--primary btn--lg btn--block" href="/checkout/${c.slug}">Renovar acesso</a><p class="muted small">Seu acesso terminou. Renove para voltar a ter acesso.</p>`
        : html`<button class="btn btn--primary btn--lg btn--block" type="button" disabled>Renovação em breve</button><p class="muted small">Seu acesso a este ${dl ? 'produto' : 'curso'} terminou. A renovação estará disponível em breve.</p>`)
      : (buy.open ? html`<a class="btn btn--primary btn--lg btn--block" href="${buyUrl}">${dl ? 'Comprar agora' : 'Matricular-se'}</a><p class="muted small">Pix ou cartão. Reembolso em até 7 dias.</p>`
        : html`<button class="btn btn--primary btn--lg btn--block" type="button" disabled>${dl ? 'Compra em breve' : 'Matrículas em breve'}</button><p class="muted small">${dl ? 'A compra' : 'As matrículas e o pagamento'} será${dl ? '' : 'o'} aberta${dl ? '' : 's'} nos próximos dias.</p>`);
  const content = html`
${couponBanner(coupon)}
${preview ? html`<div class="alert alert--info">Pré-visualização: ${dl ? 'este produto' : 'este curso'} ainda não está publicado na vitrine.</div>` : ''}
<article class="cpage">
  <div class="cpage__main">
    <a class="back" href="/#cursos">← Todos os cursos e produtos</a>
    <div class="ccard__tags">${c.category ? html`<span class="pill${dl ? ' pill--prod' : ''}">${c.category}</span>` : (dl ? html`<span class="pill pill--prod">Produto digital</span>` : '')}${c.level !== 'nao_se_aplica' ? html`<span class="pill">${C.LEVELS[c.level]}</span>` : ''}</div>
    <h1 class="t-display">${c.title}</h1>
    ${starLine(rating)}
    ${c.summary ? html`<p class="lead">${c.summary}</p>` : ''}
    ${c.intro_youtube_id
      ? html`<div class="player"><iframe src="https://www.youtube-nocookie.com/embed/${c.intro_youtube_id}?rel=0" title="Apresentação" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`
      : (c.cover_file_id ? coverBox(c, 'cover--wide') : '')}
    <div class="stats">
      ${c.workload_hours ? stat('Carga horária', `${c.workload_hours} horas`) : ''}
      ${dl ? stat('Você recebe', plural(items.length, 'arquivo', 'arquivos')) : stat('Videoaulas', plural(videos, 'vídeo', 'vídeos'))}
      ${!dl && materials ? stat('Apostilas', plural(materials, 'material', 'materiais')) : ''}
      ${stat('Acesso', C.accessLabel(c))}
    </div>
    ${c.description || c.description_html ? html`<section class="blk"><h2 class="t-card">${dl ? 'Sobre o produto' : 'Sobre o curso'}</h2>${c.description_html ? html`<div class="desc">${raw(sanitizeHtml(c.description_html))}</div>` : para(c.description)}</section>` : ''}
    ${c.target_audience ? html`<section class="blk"><h2 class="t-card">Para quem é</h2>${para(c.target_audience)}</section>` : ''}
    ${c.prerequisites ? html`<section class="blk"><h2 class="t-card">Pré-requisitos</h2>${para(c.prerequisites)}</section>` : ''}
    ${c.learn_items.length ? html`<section class="blk"><h2 class="t-card">${dl ? 'O que você recebe' : 'O que você vai aprender'}</h2>${list(c.learn_items)}</section>` : ''}
    ${c.able_items.length ? html`<section class="blk"><h2 class="t-card">Ao concluir, você estará apto a</h2>${list(c.able_items)}</section>` : ''}
    ${dl && items.length ? html`<section class="blk"><h2 class="t-card">Arquivos incluídos</h2><ul class="tick">${items.map((f) => html`<li>${icon('file', 18)}<span>${f.label}</span></li>`)}</ul></section>` : ''}
    ${cur.length ? html`<section class="blk"><h2 class="t-card">Conteúdo do curso</h2>
      <p class="muted small">${plural(cur.length, 'módulo', 'módulos')} · ${plural(lessons.length, 'aula', 'aulas')}${total ? ' · ' + dur(total) : ''}</p>
      <div class="syl">${cur.map((m, i) => html`<details ${i === 0 ? raw('open') : ''}><summary><span>Módulo ${i + 1} · ${m.title}</span><span class="muted small">${plural(m.lessons.length, 'aula', 'aulas')}</span></summary>
        <ul>${m.lessons.map((l) => html`<li>${icon('video', 16)}<span>${l.title}</span>${l.duration_min ? html`<span class="muted small">${dur(l.duration_min)}</span>` : ''}</li>`)}</ul></details>`)}</div></section>` : ''}
    ${testimonials.length ? html`<section class="blk" id="depoimentos"><h2 class="t-card">Depoimentos</h2><div class="testi">${testimonials.map((t) => html`<blockquote class="testi__i"><p>${t.comment}</p><cite class="testi__by"><span class="rating">${'★'.repeat(t.stars)}</span> · ${shortName(t.author)}</cite></blockquote>`)}</div></section>` : ''}
    ${c.faq.length ? html`<section class="blk"><h2 class="t-card">Perguntas frequentes</h2><div class="faq">${c.faq.map((f) => html`<details><summary>${f.q}</summary><p>${f.a}</p></details>`)}</div></section>` : ''}
  </div>
  <aside class="cpage__side"><div class="buy card">
    <span class="muted small">Investimento</span>
    <div class="buy__price">${priceBlock(c)}</div>
    ${C.effectivePrice(c).cents > 0 && c.max_installments > 1 ? html`<p class="muted small">ou até ${c.max_installments}x no cartão</p>` : ''}
    ${cta}
    <ul class="buy__list"><li>${icon('lock', 16)} Pagamento único, sem mensalidade</li><li>${icon('clock', 16)} Acesso: ${C.accessLabel(c)}</li><li>${icon('shield', 16)} Reembolso em até 7 dias</li></ul>
  </div></aside>
</article>`;
  return shellPublic({ cfg, user, title: c.title, description: c.summary || '', content });
}

function legalPage({ cfg, user, doc, title }) {
  const content = html`<article class="sec"><div class="sec__in sec__in--narrow">
    <a class="back" href="/">← Início</a>
    <h1 class="t-display">${title}</h1>
    ${doc && doc.status === 'published'
      ? html`<p class="muted small">Versão ${doc.version}</p><div class="legal legal--page">${raw(doc.body_html)}</div>`
      : html`<div class="card empty">${lumen('pensa', 80)}<p class="muted">Este texto está em elaboração e será publicado em breve.</p></div>`}
  </div></article>`;
  return shellPublic({ cfg, user, title, content });
}

module.exports = { landing, coursePage, legalPage, priceBlock, coverBox, dur, plural };
