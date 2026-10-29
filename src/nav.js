'use strict';
// MENU ÚNICO. Esta é a única definição de menus do sistema (público, aluno e administrador).
// Para mudar um menu, altere só este arquivo. Nenhuma página tem menu próprio.
// `fase` é a fase em que o item passa a existir; itens de fases futuras ficam ocultos até lá.
const NAV = {
  publico: [
    { href: '/#sobre', icon: 'compass', label: 'Sobre', fase: 2 },
    { href: '/#idealizador', icon: 'user', label: 'Idealizador', fase: 2 },
    { href: '/#cursos', icon: 'book', label: 'Produtos', fase: 2 },
    { href: '/#perguntas', icon: 'chat', label: 'Perguntas', fase: 2 },
  ],
  aluno: [
    { href: '/meus-cursos', icon: 'book', label: 'Meus produtos', fase: 1 },
    { href: '/certificados', icon: 'cert', label: 'Certificados', fase: 3 },
    { href: '/pagamentos', icon: 'card', label: 'Pagamentos e acessos', fase: 4 },
    { href: '/perfil', icon: 'user', label: 'Perfil', fase: 1 },
    { href: '/ajuda', icon: 'help', label: 'Ajuda', fase: 5 },
  ],
  admin: [
    { href: '/admin', icon: 'chart', label: 'Dashboard', fase: 1 },
    { href: '/admin/cursos', icon: 'book', label: 'Cursos e produtos', fase: 2 },
    { href: '/admin/alunos', icon: 'users', label: 'Alunos', fase: 2 },
    { href: '/admin/cortesias', icon: 'star', label: 'Cortesias', fase: 2 },
    { href: '/admin/cupons', icon: 'card', label: 'Cupons', fase: 2 },
    { href: '/admin/financeiro', icon: 'chart', label: 'Cockpit financeiro', fase: 4 },
    { href: '/admin/vendas', icon: 'cash', label: 'Vendas e renovações', fase: 4 },
    { href: '/admin/forum', icon: 'chat', label: 'Fórum e avaliações', fase: 5 },
    { href: '/admin/downloads', icon: 'file', label: 'Pedidos de download', fase: 6 },
    { href: '/admin/certificados', icon: 'cert', label: 'Certificados', fase: 3 },
    { href: '/admin/textos', icon: 'file', label: 'Textos legais', fase: 4 },
    { href: '/admin/lgpd', icon: 'shield', label: 'LGPD e aceites', fase: 5 },
    { href: '/admin/log', icon: 'clock', label: 'Registro de atividades', fase: 2 },
    { href: '/admin/configuracoes', icon: 'gear', label: 'Configurações', fase: 5 },
    { href: '/admin/lancamento', icon: 'shield', label: 'Lançamento', fase: 6 },
    { href: '/perfil', icon: 'user', label: 'Perfil', fase: 1 },
  ],
};

function isActive(href, path) {
  const h = href.split('#')[0];
  if (!h || h === '/') return false;
  return path === h || path.startsWith(h + '/');
}

// Devolve o menu do perfil, só com os itens já disponíveis na fase atual, e marca o da tela aberta.
function menuFor(area, path, phase) {
  const items = (NAV[area] || []).filter((i) => i.fase <= phase);
  const exact = items.find((i) => i.href === path);
  return items.map((i) => ({
    ...i,
    active: exact ? i === exact : isActive(i.href, path),
  }));
}

module.exports = { NAV, menuFor, isActive };
