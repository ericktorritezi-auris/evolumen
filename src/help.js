'use strict';
// Ajuda guiada da Lumen: o que fazer em cada tela, em passos curtos. Texto fixo, sem dados de ninguém.
const STUDENT = [
  { id: 'meus-cursos', match: /^\/meus-cursos/, title: 'Seus cursos', steps: [
    'Cada cartão é um curso que você comprou ou ganhou. Toque no cartão para abrir.',
    'Na página do curso, o botão grande leva direto para a próxima aula (Começar ou Continuar).',
    'A barra mostra quanto você já concluiu. O acesso vence na data indicada, se o curso tiver prazo.'] },
  { id: 'aula', match: /^\/curso\/[^/]+\/aula\//, title: 'Assistindo a uma aula', steps: [
    'Aperte o play e assista com atenção. O tempo assistido conta para liberar a prova final.',
    'Quando terminar, toque em Marcar como concluída. Depois use Próxima aula.',
    'Apostilas e materiais ficam abaixo do vídeo, no botão Baixar.',
    'Tem dúvida? Escreva em Dúvidas da aula, no fim da página. O professor responde e avisa por e-mail.'] },
  { id: 'avaliacao', match: /^\/curso\/[^/]+\/avaliacao\//, title: 'Quiz e prova final', steps: [
    'Responda todas as questões e envie. Você precisa de média 7 ou mais.',
    'Você tem até 3 tentativas. Depois disso, só o professor pode liberar mais uma.',
    'A correção das questões aparece quando você atinge a nota mínima.'] },
  { id: 'curso', match: /^\/curso\/[^/]+\/?$/, title: 'Página do curso', steps: [
    'Use o botão do topo para começar ou continuar de onde parou.',
    'Em Conteúdo do curso você vê os módulos e as aulas. Aulas concluídas ficam marcadas.',
    'Se o módulo tem quiz, ele precisa ser aprovado para liberar o próximo módulo.',
    'Quando você concluir o curso e receber o certificado, aparece aqui o convite para avaliar o curso.'] },
  { id: 'certificados', match: /^\/certificados/, title: 'Certificados', steps: [
    'O certificado é emitido sozinho quando você conclui o curso (95% ou mais) e passa nas avaliações.',
    'Baixe o PDF pelo botão do certificado. O QR Code e o código permitem que qualquer pessoa confira se ele é verdadeiro.',
    'O certificado continua válido mesmo depois que o prazo de acesso ao curso acabar.'] },
  { id: 'pagamentos', match: /^\/pagamentos/, title: 'Pagamentos e acessos', steps: [
    'Aqui estão suas compras, a situação de cada pagamento e até quando vai o acesso.',
    'Para renovar um acesso perto do fim, use Renovar agora.',
    'Comprou há menos de 7 dias e quer desistir? Use Pedir reembolso. O professor analisa e o valor volta pelo mesmo meio de pagamento.'] },
  { id: 'perfil', match: /^\/perfil/, title: 'Seu perfil', steps: [
    'Atualize seus dados e sua senha quando precisar.',
    'Para trocar o e-mail, o sistema envia um código de confirmação.',
    'Em Seus dados você baixa uma cópia deles ou pede a exclusão. O professor responde em até 15 dias.'] },
  { id: 'ajuda', match: /^\/ajuda/, title: 'Ajuda', steps: [
    'Aqui estão os passos para cada parte do sistema e as perguntas mais comuns.',
    'Em qualquer tela, o botão ? abre a ajuda daquele lugar.'] },
];

const ADMIN = [
  { id: 'a-forum', match: /^\/admin\/forum/, title: 'Fórum e avaliações', steps: [
    'A lista mostra as dúvidas sem resposta, da mais antiga para a mais nova.',
    'Toque em Abrir e responder para ir até a aula e escrever sua resposta. O aluno é avisado por e-mail.',
    'Ocultar esconde uma mensagem dos alunos sem apagar. Em Avaliações você vê a média e o NPS de cada curso.'] },
  { id: 'a-fin', match: /^\/admin\/financeiro/, title: 'Cockpit financeiro', steps: [
    'Escolha o período e, se quiser, um curso. Toque em Atualizar.',
    'Receita bruta, devolvido e líquida mostram o dinheiro do período. Churn e efetividade mostram retenção.',
    'A fórmula de cada número está no fim da página.'] },
  { id: 'a-vendas', match: /^\/admin\/(vendas|reembolsos|simulador)/, title: 'Vendas e reembolsos', steps: [
    'Cada linha é um pedido. Abra para ver o pagamento, o cupom e o histórico.',
    'Pedidos de reembolso aparecem no topo. Aprovar devolve o valor, cancela o acesso e revoga o certificado.',
    'O simulador de pagamento só existe em teste e staging.'] },
  { id: 'a-lgpd', match: /^\/admin\/lgpd/, title: 'LGPD e aceites', steps: [
    'Em Pedidos, atenda ou negue cada pedido do titular dentro do prazo de 15 dias.',
    'Atender uma exclusão anonimiza a conta. Pedidos, aceites e certificados ficam guardados por obrigação legal.',
    'Em Aceites você consulta e exporta quem aceitou qual texto, quando e de qual IP.'] },
  { id: 'a-textos', match: /^\/admin\/textos/, title: 'Textos legais', steps: [
    'Edite o rascunho no editor visual e salve. Publicar trava a versão.',
    'Depois de publicar, todos precisam aceitar o texto novo para continuar usando o sistema.'] },
  { id: 'a-config', match: /^\/admin\/configuracoes/, title: 'Configurações', steps: [
    'Defina o contato de suporte que aparece na Ajuda dos alunos.',
    'Ligue ou desligue o fórum e os avisos de nova dúvida por e-mail.',
    'O quadro Situação do sistema mostra a versão e se e-mail e pagamentos estão configurados.'] },
  { id: 'a-cursos', match: /^\/admin\/(cursos|avaliacoes)/, title: 'Cursos', steps: [
    'Crie o curso, depois monte os módulos e as aulas (vídeos do YouTube não listado e apostilas).',
    'Em Avaliações e certificado, cadastre o quiz e a prova final.',
    'Só publique quando estiver pronto: curso em rascunho não aparece na vitrine.'] },
  { id: 'a-home', match: /^\/admin\/?$/, title: 'Painel', steps: [
    'O quadro mostra o estado do sistema. Use o menu para chegar a cada área.',
    'Em qualquer tela, o botão ? mostra o que fazer ali.'] },
];

const FAQ = [
  ['Esqueci minha senha. E agora?', 'Na tela de entrada, toque em Esqueci minha senha. Enviaremos um link por e-mail que vale por pouco tempo.'],
  ['Paguei e o curso não apareceu.', 'O Pix e o cartão podem levar alguns instantes para confirmar. Atualize a página Pagamentos e acessos. Se passar de 10 minutos, fale com o suporte.'],
  ['Posso pedir meu dinheiro de volta?', 'Sim, em até 7 dias da compra. Peça em Pagamentos e acessos. O professor analisa e o valor volta pelo mesmo meio de pagamento.'],
  ['Meu acesso venceu. Perco o certificado?', 'Não. O certificado emitido continua válido. Para voltar às aulas, é preciso renovar.'],
  ['Como funciona a prova final?', 'Ela libera quando você chega à última aula e assiste mais da metade dela. Você precisa de média 7, em até 3 tentativas.'],
  ['Como sei se um certificado é verdadeiro?', 'Pelo QR Code ou pelo código, na página Verificar certificado do site.'],
  ['Meus dados estão seguros?', 'Sim. Veja a Política de Privacidade. Você pode baixar uma cópia dos seus dados ou pedir a exclusão no seu Perfil.'],
];

// O caminho real da página (e não o item de menu destacado) vem do pedido em andamento.
const { AsyncLocalStorage } = require('async_hooks');
const als = new AsyncLocalStorage();
const middleware = (req, res, next) => als.run({ path: req.path }, next);
const current = () => (als.getStore() || {}).path || null;

const forPath = (path, role) => (role === 'admin' ? ADMIN : STUDENT).find((x) => x.match.test(path)) || null;

module.exports = { STUDENT, ADMIN, FAQ, forPath, middleware, current };
