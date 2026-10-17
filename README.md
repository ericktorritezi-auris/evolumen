# EvoLumen Academy

Plataforma de cursos online de saúde emocional do professor Erick Torritezi.
Mais um produto Belle Planner.

## Versões entregues

| Versão | Fase | Data | O que mudou |
|---|---|---|---|
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

## Testes e QA

`TEST_DATABASE_URL=postgres://... npm run qa` gera o `QA-RELATORIO.md`.
