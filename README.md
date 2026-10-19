# EvoLumen Academy

Plataforma de cursos online de saúde emocional do professor Erick Torritezi.
Mais um produto Belle Planner.

## Versões entregues

| Versão | Fase | Data | O que mudou |
|---|---|---|---|
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

## Como subir

1. Envie o conteúdo do ZIP para a branch `staging` do GitHub.
2. O Railway faz o deploy; migrações e seeds rodam sozinhos ao iniciar.
3. Confira `/health` e entre com ADMIN_EMAIL e ADMIN_INITIAL_PASSWORD.

## Como testar a Fase 3 (0.4.0)

Suba a pasta por cima da 0.3.0. O deploy instala o `pdfkit` sozinho e a migração 006 roda na subida.

1. **Criar a prova**: em **Cursos > (curso) > Avaliações e certificado**, crie o **Quiz** de um módulo e a **Prova final**. Adicione questões (múltipla escolha ou verdadeiro/falso). Em **Certificado**, preencha a carga horária e veja o exemplo em PDF.
2. **Medir o tempo assistido**: entre como aluno de teste, abra a última aula do curso e assista a mais da metade do vídeo. A **prova final** libera. Antes disso ela aparece bloqueada com o motivo. Dica: preencha a **duração (min)** de cada aula; o servidor usa esse valor como referência e ignora durações forjadas. A prova final mostra só a nota e o total de acertos (sem gabarito por questão); os quizzes mostram a correção completa. (Se o vídeo não puder ser medido, use **Tentativas > Liberar prova**.)
3. **Quiz bloqueia o avanço**: com quiz no módulo 1, conclua as aulas dele. O módulo 2 fica com cadeado até passar no quiz com 7,0 ou mais.
4. **Tentativas**: erre o quiz até acabarem as 3. Em **Avaliações > Tentativas**, libere **+1 tentativa extra**.
5. **Certificado**: passe na prova final e conclua 95% do curso. O certificado é emitido sozinho (menu **Certificados**) e dá para baixar o PDF. Passou na prova com menos de 95%? A tela diz quantas aulas faltam.
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
