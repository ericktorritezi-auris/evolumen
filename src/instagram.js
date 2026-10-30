'use strict';
// Vídeos do Instagram nas aulas (1.1.2).
// O administrador cola o código de incorporação ou o link. Daqui sai SÓ o endereço limpo da publicação;
// o código colado nunca é guardado nem mostrado ao aluno (o HTML do aluno é montado pelo próprio sistema).
const KINDS = { reel: 'reel', reels: 'reel', p: 'p', tv: 'tv' };
// aceita instagram.com/reel/ID, instagram.com/usuario/reel/ID, com ou sem www, com ?parâmetros
const RE = /(?<![A-Za-z0-9.-])(?:https?:\/\/)?(?:www\.)?instagram\.com\/(?:(?!share\/)[A-Za-z0-9._]{1,30}\/)?(reels?|p|tv)\/([A-Za-z0-9_-]{5,40})(?![A-Za-z0-9_-])/i;
const OK = /^https:\/\/www\.instagram\.com\/(reel|p|tv)\/[A-Za-z0-9_-]{5,40}\/$/;

// Devolve { url } (endereço canônico), {} (campo vazio) ou { error }.
function parse(input) {
  const s = String(input == null ? '' : input).trim();
  if (!s) return {};
  if (s.length > 8000) return { error: 'O texto colado é grande demais. Cole só o link ou o código de incorporação do Instagram.' };
  const m = RE.exec(s.replace(/&amp;/g, '&'));
  if (!m) return { error: 'Não encontrei um link do Instagram. Cole o link do reel, post ou vídeo (instagram.com/reel/...) ou o código de incorporação.' };
  return { url: `https://www.instagram.com/${KINDS[m[1].toLowerCase()]}/${m[2]}/` };
}
const isValid = (u) => typeof u === 'string' && OK.test(u);

// Endereço usado pelo script do Instagram para montar o vídeo.
const embedPermalink = (u) => (isValid(u) ? u + '?utm_source=ig_embed&utm_campaign=loading' : '');

// O Instagram só é liberado na política de segurança da página da aula que tem esse vídeo.
function allowCsp(header) {
  if (!header) return header;
  const add = { 'script-src': ['https://www.instagram.com'], 'frame-src': ['https://www.instagram.com'], 'img-src': ['https://*.cdninstagram.com', 'https://*.fbcdn.net'], 'connect-src': ['https://www.instagram.com'] };
  return String(header).split(';').map((d) => {
    const t = d.trim(); const name = t.split(/\s+/)[0];
    return add[name] ? `${t} ${add[name].join(' ')}` : t;
  }).filter(Boolean).join('; ');
}

module.exports = { parse, isValid, embedPermalink, allowCsp };
