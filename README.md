# EvoLumen Academy

Plataforma de cursos online e produtos digitais de saúde emocional do professor Erick Torritezi.
Mais um produto Belle Planner.

## Versões entregues

| Versão | Fase | Data | O que mudou |
|---|---|---|---|
| 1.0.0 | 6 · Lançamento | 2026-10-29 | **Primeira versão em produção.** É a 0.9.0 validada em staging e produção (compra por Pix e cartão, reembolso, estorno, e-mails e campainhas), sem mudança de funcionalidade: só versão e nota. Para abrir ao público: reset dos testes feito, `ALLOW_LAUNCH_RESET` removida e preço real no produto. |
| 0.9.0 | 6 · Lançamento | 2026-10-29 | **Reset de lançamento** em *Lançamento* (menu do administrador): você informa os e-mails das contas de aluno de teste, vê a **prévia** com as contagens, confirma digitando a frase e a sua senha, e só então apaga (pedidos, reembolsos, matrículas, progresso, provas, certificados, aceites, fórum, avaliações, cupons usados, pedidos LGPD, notificações e registros de e-mail dessas contas). Produtos, textos legais, configurações, o administrador e o registro de atividades ficam; o registro guarda só as contagens. Só funciona com `ALLOW_LAUNCH_RESET=1` no Railway (remova depois). **Checklist de go-live** com verificação automática (HTTPS, e-mail, Mercado Pago e webhook, volume, textos legais, produto e preço, compra e reembolso de teste). Textos da landing, perguntas frequentes, ajuda, menus e e-mails agora falam em **produtos** (curso é um tipo de produto). Migração 012 libera a exclusão dos aceites só dentro do reset. Inclui tudo da 0.8.1. |
| 0.8.1 | 6 · Painel e acabamento | 2026-10-28 | **Duplicar** cursos e produtos (botão na lista): abre o cadastro preenchido, sem o endereço (slug); nada é criado até salvar. Leva dados, capa e, no curso, módulos, aulas e anexos; no produto, os arquivos (caixa para desmarcar). Não leva vendas, matrículas, avaliações, cupons nem provas; nasce como rascunho. **Dashboard renovado**: vendas e líquido do mês, alunos com acesso, pendências com atalho, atalhos e o cartão **Saúde do sistema** (servidor, banco e tempo de resposta, e-mail, pagamento, tarefas automáticas, volume e memória). Sai a linha "Fase entregue" e o texto antigo. **Caixas de seleção e opções** alinhadas com o texto em todo o sistema. Aniversário: só "Opcional.". Sem migração nova. Inclui tudo da 0.8.0. |
| 0.8.0 | 6 · Downloads e avaliações | 2026-10-28 | **Limite de downloads** dos produtos digitais: cada aluno baixa cada arquivo 3 vezes (ajustável em Configurações); depois, **pedido com motivo** que você aprova ou nega em *Pedidos de download*, tudo pela campainha, sem e-mail. Download interrompido não conta; acesso cancelado zera o contador. **Avaliação e depoimento**: no produto digital abre após o primeiro download (no curso, após o certificado); estrelas, indicação 0–10 e texto opcional com **aceite** para publicar; você publica ou retira cada depoimento em *Fórum e avaliações*; na página pública aparece com primeiro nome e inicial (ex.: "Ana L."). **Média de estrelas** na vitrine e na página (só com 3 ou mais avaliações; cancelados não contam). **Aviso de novidade** para cursos e produtos: campainha por padrão, e-mail só se marcar. **Produto digital não aparece em Certificados**. **Não publica produto sem arquivos**; avisa ao remover o último arquivo de quem já comprou. Migração 011. Inclui tudo da 0.7.1. |
| 0.7.1 | 6 · Produtos digitais e volume | 2026-10-28 | **Correção**: o formulário de arquivo de apoio da aula não mostrava o campo "Onde guardar" (banco ou volume). Agora mostra, com o modo Automático. Sem outras mudanças. |
| 0.7.0 | 6 · Produtos digitais e volume | 2026-10-28 | **Novo cadastro com escolha do tipo**: Curso ou **Produto digital** (e-book, ferramenta, áudio guiado, pacote). Produto digital tem descrição, capa, vídeo de apresentação opcional, etiqueta e **arquivos para baixar**, sem módulos, aulas, quiz, prova nem certificado. Checkout, Mercado Pago, cupons, reembolso, cortesia e cockpit funcionam igual (o cockpit ganhou o filtro **Tipo**). **Onde guardar cada arquivo**: ao enviar (produto ou apostila de aula) você escolhe **Banco de dados (até 20 MB)** ou **Volume do Railway (até 350 MB)**; o sistema sugere pelo tamanho. Arquivos antigos continuam no banco. Envio direto para o disco (não ocupa memória). Tipos aceitos nos produtos: PDF, EPUB, ZIP, MP3, M4A, WAV, MP4, DOCX, XLSX, PPTX, PNG e JPG, conferidos pelo conteúdo real. Download só para quem tem acesso vigente. Botão **Avisar sobre a atualização** (sino e e-mail, uma vez por alteração). Limpeza automática de arquivos órfãos do volume. E-mails e telas de compra falam "produto" quando for o caso. Migração 010. Inclui tudo da 0.6.1. |
| 0.6.1 | 5 · Campainha | 2026-10-28 | **Campainha de avisos** para o professor e para o aluno (sino ao lado do **?**, com contador). Amarelo = novo; ao abrir ou responder fica cinza e some em 7 dias. Professor: pergunta no fórum, venda, pedido de reembolso, chargeback, pedido de exclusão ou troca de e-mail, aluno com 50% do curso, aulas todas vistas, certificado emitido, avaliação nova e aniversários da semana. Aluno: professor respondeu, pagamento confirmado, certificado pronto, reembolso, resposta ao pedido de dados, prazo do acesso acabando (30, 7 e 1 dias, agora **também por e-mail**), lembretes de estudo e feliz aniversário. O que já estava pendente aparece no sino na primeira subida. Novo campo opcional **Data de nascimento** no perfil. Exclusão de dados apaga os avisos da pessoa. Migração 009. Inclui tudo da 0.6.0. |
| 0.6.0 | 5 · Comunidade, ajuda e LGPD | 2026-10-28 | **Fórum por aula** (só alunos com acesso; o professor responde pelo painel e o aluno é avisado por e-mail; ocultar mensagens; o aluno apaga a própria se ainda não tiver respostas). **Avaliação do curso** (1 a 5 estrelas e NPS) para quem recebeu o certificado, com média e NPS em **Fórum e avaliações**. **Ajuda da Lumen**: botão **?** em cada tela com o passo a passo dela e página **Ajuda** com perguntas frequentes. **LGPD e aceites** no painel: fila de pedidos do titular (prazo de 15 dias, cópia dos dados em JSON, exclusão com anonimização; pedidos com os dados da compra, aceites e certificados ficam guardados por obrigação legal) e consulta e exportação (CSV) dos aceites com data, hora e IP. **Configurações**: contato de suporte, fórum ligado ou desligado, aviso de nova dúvida e situação do sistema. Receita e valor recebido passam a usar o preço do curso (sem juros do parcelamento). Limite de requisições no acompanhamento do pedido. Tag "Sociedade Brasileira de Coaching" removida da landing. Migração 008. |
| 0.5.2 | 4 · Pagamentos (cockpit) | 2026-10-27 | **Cockpit financeiro** em `/admin/financeiro` (receita bruta, devolvido, receita líquida, ticket médio, novas e renovações, conclusões, churn e efetividade; gráfico por dia ou mês; tabelas por curso e por forma de pagamento; filtros de período e curso). Aula: mensagem passa a "Assista sua aula!". Webhook com assinatura inválida agora registra no log um diagnóstico seguro (sem segredos). Sem migração nova. |
| 0.5.1 | 4 · Pagamentos (correções) | 2026-10-20 | Editor visual completo para Termos e Política (títulos, negrito, itálico, sublinhado, listas, citação, link, colagem limpa do Word, sem código; o servidor limpa o HTML). Cupom limitado agora fica reservado enquanto há compra pendente e não vale em dois pedidos ao mesmo tempo. Correção do título "vv1.0". Inclui tudo da 0.5.0. |
| 0.5.0 | 4 · Pagamentos | 2026-10-20 | Checkout com Pix e cartão (Mercado Pago), matrícula automática só após o pagamento aprovado (webhook com assinatura), conta criada na compra com senha provisória por e-mail, cupom reconferido no servidor, renovação por nova compra, reembolso em até 7 dias (aluno pede, administrador aprova, sistema devolve e cancela acesso e certificado), Pix de 30 minutos com e-mail de lembrete, telas Vendas e renovações, Pagamentos e acessos, Textos legais editáveis e simulador de pagamento (só teste/staging). Tabelas passam a usar fonte menor em todas as telas. Migração 007. Guia do Mercado Pago em `docs/GUIA-MERCADO-PAGO.md`. |
| 0.4.0 | 3 · Avaliações, progresso e certificados | 2026-10-19 | Tempo assistido pelo player do YouTube. Quiz por módulo (opcional, não pesa na nota, bloqueia o avanço até a nota mínima). Prova final por curso (libera com mais da metade da última aula assistida). Tentativas (3) e tentativa extra pelo administrador. Certificado em PDF com selo e QR Code, emitido ao passar na prova e concluir 95%, texto e carga horária editáveis, página pública de verificação mínima e revogação. Migração 006. Nova dependência: pdfkit. |
| 0.3.0 | 2 · Etapa de base | 2026-10-19 | Fonte nova (Quicksand + Nunito, instaladas no próprio sistema). Cortesia. Regra "exclui só sem vínculo, senão inativa" em alunos, matrículas, módulos, aulas e cupons. Registro de atividades (30 por página, guardado 30 dias). Cupons com QR Code, imagem PNG (miniatura que abre em janela, baixar) e envio por e-mail. Migração 005. Novas dependências: qrcode e @resvg/resvg-js. |
| 0.2.2 | 2 · Cursos e aulas | 2026-10-18 | Nível do curso ganha a opção "Não se aplica" (não aparece para o público). Nova migração 004. |
| 0.2.1 | 2 · Cursos e aulas | 2026-10-17 | Foto do professor na página inicial. |
| 0.2.0 | 2 · Cursos e aulas | 2026-10-17 | Página inicial pública com vitrine, página de cada curso, painel de cursos (módulos, aulas com vídeo do YouTube, apostilas até 20 MB, capa, preço, acesso e publicação), liberação manual de acesso para teste, Meus cursos, aula com player e progresso, textos legais públicos em /termos e /privacidade. |
| 0.1.1 | 1 · Base e contas | 2026-10-17 | Correção: o administrador agora edita o próprio CPF no perfil (validado e único). O aluno continua sem poder alterar. |
| 0.1.0 | 1 · Base e contas | 2026-10-17 | Login único, primeiro acesso com troca de senha, recuperação de senha, perfil, troca de e-mail em duas etapas, e-mails pelo Resend, PWA, aceites LGPD, auditoria, ambientes staging e produção. |

A versão 1.0 será a primeira entrada em produção. Antes disso, 0.x.

Endereço de produção: https://evolumen.ericktorritezi.com.br

## Variáveis no Railway (cada ambiente)

| Variável | Obrigatória | Para quê |
|---|---|---|
| DATABASE_URL | sim | Postgres do ambiente |
| SESSION_SECRET | sim | 32+ caracteres, diferente em cada ambiente |
| ADMIN_EMAIL | sim, na 1ª subida | e-mail do administrador |
| ADMIN_INITIAL_PASSWORD | sim, na 1ª subida | senha provisória (troca obrigatória no 1º acesso) |
| RESEND_API_KEY | sim | envio de e-mails |
| RESEND_FROM_EMAIL | sim | remetente (noreply@belleplanner.com.br) |
| APP_ENV | não | `staging` ou `production` (detectado pelo Railway) |
| APP_BASE_URL | não | endereço público (detectado pelo Railway) |
| LOG_LEVEL | não | error, warn, info, debug |
| MP_ACCESS_TOKEN | produção: sim para vender | Access Token do Mercado Pago (teste no staging, produção na produção). Sem ele a produção sobe, mas a matrícula mostra "em breve" |
| MP_WEBHOOK_SECRET | obrigatória se houver token | chave secreta do webhook (Webhooks > Configurar notificações) |
| ALLOW_LAUNCH_RESET | só durante a limpeza | `1` liga o reset de lançamento (tela Lançamento). Remova depois de usar. Sem ela, o reset não executa nada |
| PAYMENT_PROVIDER | não | `mercadopago` ou `simulated`. **Nunca `simulated` na produção** (o sistema recusa subir). Sem token, teste e staging usam o simulador |

## Como subir

1. Envie o conteúdo do ZIP para a branch `staging` do GitHub.
2. O Railway faz o deploy; migrações e seeds rodam sozinhos ao iniciar.
3. Confira `/health` e entre com ADMIN_EMAIL e ADMIN_INITIAL_PASSWORD.

## Como testar produtos digitais e o volume (0.7.0)

Antes: crie o volume no Railway do ambiente (serviço do site, caminho `/data`). O sistema lê o caminho sozinho; nenhuma variável nova é necessária. Suba por cima da 0.6.1. A migração 010 roda na subida.

1. **Cursos e produtos** → **Novo cadastro**: aparecem as duas opções. Escolha **Produto digital**. O formulário não pede nível, carga horária nem pré-requisitos. Preencha nome, etiqueta (ex.: E-book), resumo, preço e publique.
2. Na aba **Arquivos** do produto, envie um PDF pequeno e escolha **Banco de dados**. Envie um ZIP ou MP3 e escolha **Volume do Railway**. Ao escolher um arquivo maior que 20 MB, o sistema sugere o volume.
3. Em **Configurações** > situação do sistema nada muda; o volume vale quando a opção **Volume do Railway** aparece habilitada. Se aparecer "indisponível neste ambiente", o volume não está montado.
4. Faça uma **cortesia** do produto para um aluno de teste (ou uma compra pelo simulador). Entre como o aluno: em **Meus cursos** o produto aparece com **Baixar arquivos**. Baixe os dois arquivos e confira que abrem.
5. Teste com a conta de outro aluno sem acesso: não baixa. Teste enviar um arquivo com extensão trocada (ex.: .exe renomeado): é recusado.
6. **Avisar sobre a atualização**: o aluno recebe o aviso no sino e por e-mail, uma vez.
7. Apostila de aula de um **curso** também tem a escolha banco ou volume.
8. **Cockpit financeiro**: o filtro **Tipo** separa cursos e produtos digitais.
9. Teste um arquivo grande (ex.: 100 MB) no volume para conferir o tempo de envio no seu celular ou computador.

## Como testar a campainha (0.6.1)

Suba por cima da 0.6.0. A migração 009 roda na subida.

1. **Sino do professor**: ao lado do **?** (no celular, no topo, ao lado do menu). Tudo que estava pendente (perguntas sem resposta, pedidos de reembolso e de dados) já aparece em amarelo.
2. Como aluno, faça uma pergunta no fórum: o sino do professor ganha um aviso amarelo. Responda pelo botão **Responder**: o aviso fica cinza e o aluno ganha "O professor respondeu sua dúvida".
3. Toque em um aviso: abre a tela certa e ele fica cinza. **Marcar todos como lidos** limpa o contador. Avisos lidos somem depois de 7 dias.
4. Compra aprovada, pedido de reembolso, conclusão de 50% e certificado também acendem o sino (professor e aluno, conforme o caso).
5. **Perfil**: preencha a **Data de nascimento** (opcional). Aniversários dos próximos 7 dias aparecem para o professor, e no dia o aluno recebe o parabéns.
6. **Prazo do acesso**: o aluno é avisado no sino e por e-mail nos dias definidos no curso (padrão 30, 7 e 1). A varredura roda de hora em hora.

## Como testar a Fase 5 (0.6.0)

Suba por cima da 0.5.2. A migração 008 roda na subida.

1. **Fórum**: como aluno com acesso, abra uma aula e escreva em **Dúvidas da aula**. Como administrador você recebe um e-mail e vê a dúvida em **Fórum e avaliações**. Abra a aula e responda; o aluno recebe um e-mail. Teste **Ocultar** e **Mostrar**. O aluno só apaga a própria mensagem se ela ainda não tiver respostas.
2. **Fórum desligado**: em **Configurações**, desmarque o fórum. As aulas passam a mostrar "O fórum está desativado".
3. **Avaliação do curso**: o aluno que recebeu o certificado vê, na página do curso, **Como foi o curso?** (estrelas, nota de 0 a 10 e comentário). Pode mudar depois. A média e o NPS aparecem em **Fórum e avaliações**.
4. **Ajuda**: em qualquer tela toque no **?** ao lado de "Olá, ..." (no celular, ao lado do menu). Abra também **Ajuda** no menu do aluno. O contato de suporte vem de **Configurações**.
5. **LGPD, pedidos**: como aluno, em **Perfil**, peça a exclusão dos dados. Em **LGPD e aceites** o pedido aparece com prazo de 15 dias. **Baixar dados** entrega a cópia em JSON. **Atender** em uma exclusão anonimiza a conta e cancela os acessos (pedidos, aceites e certificados ficam guardados por obrigação legal). Use uma conta de teste.
6. **LGPD, aceites**: na aba **Aceites dos textos**, filtre por aluno ou documento e use **Exportar CSV**.
7. **Configurações**: salve e-mail e WhatsApp de suporte e confira em **Ajuda**. O quadro **Situação do sistema** mostra versão, e-mail, pagamentos e textos publicados.
8. **Landing**: na seção do idealizador restam as tags ABRAPH e ATH.

## Como testar a Fase 4 (0.5.0, 0.5.1 e 0.5.2)

Suba por cima da 0.4.0. A migração 007 roda na subida. Passo a passo do Mercado Pago (conta, credenciais, webhook, variáveis, cartões de teste, Pix real de R$ 1,00): **`docs/GUIA-MERCADO-PAGO.md`**.

1. **Textos legais**: em **Textos legais**, abra o rascunho e escreva no **editor visual** (botões de Título, Subtítulo, Negrito, Itálico, Sublinhado, Lista, Lista numerada, Citação e Link; colar do Word já vem limpo). **Salve o rascunho** e depois **Publique** os dois (o checkout só abre com Termos e Privacidade publicados). Depois de publicado não edita mais; para mudar, crie uma nova versão.
2. **Ensaio com o simulador (staging sem token)**: abra um curso pago como visitante > **Matricular-se**. Preencha, escolha Pix e vá para o pagamento. Como administrador, abra **Vendas e renovações > simulador** e **Aprove**. O comprador recebe o e-mail com a senha provisória, entra e vê o curso. Aprovar duas vezes não duplica nada.
3. **E-mail que já tem conta**: no checkout, o sistema pede para entrar e volta para a compra.
4. **Cupom**: aplique um cupom; o valor é recalculado no servidor. Com cupom de poucos usos, uma compra ainda não paga segura a vaga: outra pessoa vê "reservado em compras em andamento" até o Pix vencer ou o pagamento sair.
5. **Pix vencido**: no simulador use **Vencer** (ou espere 30 minutos): o comprador recebe um e-mail com o link para tentar de novo.
6. **Renovação**: aluno com acesso perto do fim vê **Renovar agora**; o prazo novo é somado ao que resta.
7. **Reembolso**: o aluno abre **Pagamentos**, pede reembolso (até 7 dias). Em **Vendas e renovações** aparece o pedido: **Aprovar** devolve o valor, cancela o acesso e revoga o certificado. **Recusar** avisa o aluno.
8. **Estorno**: no simulador, **Estornar** cancela o acesso.
9. **Mercado Pago de verdade (staging)**: siga o guia: cartão com cartões de teste e depois um Pix real de R$ 1,00 com reembolso.
10. **Cockpit financeiro (0.5.2)**: em **Cockpit financeiro** troque o período (este mês, 30 dias, 90 dias, ano ou período livre) e o curso. Confira receita bruta, devolvido, líquida, churn e efetividade com as vendas de teste. A fórmula está na própria tela ("Como os números são calculados").
11. **Tabelas**: todas as tabelas do painel e das telas do aluno agora usam fonte menor (13 px, cabeçalho 11 px).

## Como testar a Fase 3 (0.4.0)

Suba a pasta por cima da 0.3.0. O deploy instala o `pdfkit` sozinho e a migração 006 roda na subida.

1. **Criar a prova**: em **Cursos > (curso) > Avaliações e certificado**, crie o **Quiz** de um módulo e a **Prova final**. Adicione questões (múltipla escolha ou verdadeiro/falso). Em **Certificado**, preencha a carga horária e veja o exemplo em PDF.
2. **Medir o tempo assistido**: entre como aluno de teste, abra a última aula do curso e assista a mais da metade do vídeo. A **prova final** libera. Antes disso ela aparece bloqueada com o motivo. Na última aula aparece um **contador** (barra com percentual e marca nos 50%) e, na lista de módulos, a linha **Prova final** (bloqueada, liberada ou aprovada). Ao passar de 50% a tela avisa "Prova final liberada!" sem recarregar. Dica: preencha a **duração (min)** de cada aula; o servidor usa esse valor como referência e ignora durações forjadas. Quiz e prova final só mostram a correção (o que errou e a resposta certa) depois que o aluno atinge a nota mínima; antes disso aparece só a nota e o total de acertos. (Se o vídeo não puder ser medido, use **Tentativas > Liberar prova**.)
3. **Quiz bloqueia o avanço**: com quiz no módulo 1, conclua as aulas dele. O módulo 2 fica com cadeado até passar no quiz com 7,0 ou mais.
4. **Tentativas**: erre o quiz até acabarem as 3. Em **Avaliações > Tentativas**, libere **+1 tentativa extra**.
5. **Certificado**: passe na prova final e conclua 95% do curso. O certificado é emitido sozinho (menu **Certificados**) e dá para baixar o PDF. Passou na prova com menos de 95%? A tela diz quantas aulas faltam. Depois do certificado, o progresso só sobe: dá para marcar aulas que faltam, mas não desmarcar (o botão vira "Concluída"). Se o certificado for revogado, a edição volta ao normal.
6. **Verificação pública**: leia o QR do PDF ou use **Verificar certificado** no rodapé. Mostra só nome, curso, carga horária, data e código.
7. **Revogar**: em **Certificados** (admin), revogue com um motivo. A página pública passa a mostrar "Certificado cancelado". Cancelar a matrícula do aluno também revoga.

## Como testar a etapa de base (0.3.0)

Suba a pasta por cima da 0.2.2 (o ZIP é completo nos arquivos alterados e traz o `package-lock.json`: o deploy instala as duas dependências novas sozinho). A migração 005 roda na subida.

1. **Fonte**: abra qualquer tela. Os textos usam Quicksand (títulos) e Nunito (texto).
2. **Cortesias** (menu): escolha um curso, informe um e-mail e um nome. A pessoa recebe o e-mail "Você ganhou um curso" com login e senha provisória. Repita com o mesmo e-mail em outro curso: o e-mail não leva senha.
3. **Cancelar acesso**: na lista de cortesias, cancele uma. O aluno perde o acesso na hora. Reative e ele volta.
4. **Alunos** (menu): inative um aluno (ele não entra mais), reative, e tente excluir um aluno com matrícula (o sistema recusa). Um aluno criado por engano, sem vínculo, tem o botão Excluir.
5. **Módulos e aulas**: com um aluno que já concluiu uma aula, o botão Excluir some e fica só Inativar. A aula inativa some para o aluno e o progresso é recalculado.
6. **Cupons** (menu): crie um cupom com período e/ou quantidade e escolha os cursos. A tela do cupom mostra a imagem pequena: clique para abrir em janela, baixe o PNG, copie o link, ou envie por e-mail a um lead.
7. **QR Code**: leia a imagem com o celular. Abre o curso com o aviso "Cupom ... guardado". O desconto aparece como prévia e passa a valer no pagamento (Fase 4).
8. **Registro de atividades** (menu): veja tudo que você fez, filtre por data, e-mail e ação.

Lembrete da regra central: login e senha não liberam curso. O acesso nasce de uma matrícula (pagamento aprovado, cortesia ou liberação manual do administrador).

## Como testar a Fase 2

1. Entre como administrador e abra **Cursos > Novo curso**. Preencha título, descrição, preço e tipo de acesso e marque "Publicado na vitrine".
2. Em **Módulos e aulas**, crie um módulo e uma aula, cole o link de um vídeo do YouTube e envie um PDF.
3. Em **Matrículas**, informe o e-mail e o nome de um aluno de teste. A senha provisória chega por e-mail e aparece uma vez na tela.
4. Entre como esse aluno: o curso aparece em **Meus cursos**, com a aula, o player, o download e o progresso.

## Testes e QA

`TEST_DATABASE_URL=postgres://... npm run qa` gera o `QA-RELATORIO.md`.

### Notas da 0.7.0
- **Não volte para a 0.6.x depois de subir esta versão**: o código antigo não entende arquivos no volume nem produtos digitais. Só avance.
- Arquivos do volume sem registro no banco vão para `/data/trash` e são apagados após 7 dias (protege contra restauração de um backup antigo do banco).
- Envios grandes dependem da velocidade de upload: 350 MB em 20 min exigem ~2,5 Mbps. O volume não entra no backup do banco.

## Como testar a 0.8.0
1. **Produto sem arquivos**: crie um produto digital marcando "Publicado". Deve recusar. Envie um arquivo e publique de novo: funciona. Remova o último arquivo de um produto com compradores: aparece o aviso.
2. **Limite de downloads**: entre como aluno com acesso ao produto e baixe o mesmo arquivo 3 vezes. Na 4ª, aparece "Pedir novo download". Envie um motivo. Como admin, abra *Pedidos de download* (menu) e libere ou negue; o aluno recebe o aviso na campainha. O limite (3) muda em *Configurações*.
3. **Avaliação do produto**: antes de baixar, o aluno não vê a avaliação; depois do primeiro download, vê. Marque o aceite, escreva um texto e envie. Em *Fórum e avaliações*, clique em *Publicar depoimento*. Abra a página pública do produto (sem login): o depoimento aparece com nome abreviado.
4. **Média de estrelas**: com 3 avaliações, aparece "★ 4,7" na vitrine e na página. Com menos de 3, não aparece.
5. **Aviso de novidade**: em *Compradores* (ou *Arquivos*) do produto, e em *Matrículas* do curso, escreva uma frase e envie. Vai para a campainha; só vai por e-mail se marcar a caixa.
6. **Certificados**: a tela do aluno não lista produtos digitais.

## Como testar a 1.0.0
1. **Versão**: no rodapé e em *Dashboard* aparece 1.0.
2. **Checklist**: em *Lançamento*, todos os itens verdes. O reset deve estar **desligado** (`ALLOW_LAUNCH_RESET` removida).
3. **Preço real**: o produto publicado com o preço de venda (o item *Preço de lançamento* do checklist fica verde).
4. **Última conferência**: abra a página inicial em janela anônima, abra o produto e veja o botão de compra com o preço real. Não precisa comprar.

## Como testar a 0.9.0
1. **Textos**: abra a página inicial e as perguntas frequentes: agora falam em *produtos* (cursos e produtos digitais). Confira também o menu (*Produtos*, *Meus produtos*) e a Ajuda.
2. **Checklist**: em *Lançamento* (menu do administrador), veja o que está verde, amarelo ou vermelho. Os itens são verificados sozinhos.
3. **Reset desligado** (padrão): a tela explica como ligar e não permite apagar nada.
4. **Reset** (só quando for limpar os testes): no Railway, crie `ALLOW_LAUNCH_RESET=1` e espere o deploy. Em *Lançamento*, cole os e-mails das contas de teste e toque em *Ver prévia*. Confira as contagens (o aviso de pedidos aprovados lembra de reembolsar antes). Digite a frase pedida e a sua senha e confirme. Depois **remova a variável** `ALLOW_LAUNCH_RESET`.
5. **Conferência**: em *Alunos* as contas sumiram; em *Vendas* e no *Cockpit financeiro* os pedidos de teste sumiram; produtos, textos legais e configurações continuam; em *Registro de atividades* aparece só "launch_reset" com contagens.

## Como testar a 0.8.1
1. **Dashboard**: o cartão *Saúde do sistema* mostra banco, e-mail, pagamento, volume, tarefas automáticas e tempo de resposta (o tempo e as tarefas só aparecem depois de alguns acessos e da primeira hora). Abaixo, vendas do mês, pendências (cada uma leva à tela certa) e atalhos.
2. **Duplicar**: em *Cursos e produtos*, clique em *Duplicar* num produto com arquivos. O formulário vem preenchido e o endereço vazio. Salve com a caixa marcada: a cópia vem como rascunho com os mesmos arquivos. Repita com um curso: módulos, aulas e anexos vêm; provas não.
3. **Caixas de seleção**: abra *Configurações*, *Novo produto* (publicado / destacar), o Perfil e uma avaliação (aceite) e confira o alinhamento com o texto.
4. **Aniversário**: no Perfil do aluno, o campo diz só "Opcional.".
