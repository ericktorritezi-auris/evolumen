# Guia do Mercado Pago, passo a passo

Para quem nunca configurou o Mercado Pago. Os nomes de telas abaixo foram conferidos na documentação oficial em 20/10/2026. Se o painel mudar de lugar algum botão, procure pelo nome em negrito.

**Tempo estimado:** 40 minutos. **Custo:** nenhum para configurar. O Mercado Pago só cobra a tarifa sobre vendas reais.

## O que você vai guardar (e onde)

| O que | Onde se pega | Onde se coloca | Nome da variável no Railway |
|---|---|---|---|
| **Access Token** de teste | Suas integrações > (aplicação) > Credenciais de teste | Railway, ambiente **staging** | `MP_ACCESS_TOKEN` |
| **Chave secreta** do webhook | Suas integrações > (aplicação) > Webhooks > Configurar notificações | Railway, **staging** e **produção** | `MP_WEBHOOK_SECRET` |
| **Access Token** de produção | Suas integrações > (aplicação) > Credenciais de produção | Railway, ambiente **produção** | `MP_ACCESS_TOKEN` |

A **Public Key** não é usada. Não precisa copiar.

> **Segurança:** o Access Token e a chave secreta são como a senha do seu dinheiro. Nunca envie por e-mail, WhatsApp, nem coloque no GitHub. Eles só entram no Railway, em Variables.

---

## Parte 1. Ter uma conta Mercado Pago pronta

1. Entre em https://www.mercadopago.com.br com a conta que vai **receber** o dinheiro das vendas (a da empresa ou a sua, a que você quer que receba).
2. Confirme que a conta está com a identidade verificada e com a chave Pix cadastrada ou conta bancária para saque. O Mercado Pago pede isso quando você ativa a produção.

## Parte 2. Criar a aplicação

1. Abra https://www.mercadopago.com.br/developers e clique em **Entrar** (canto superior direito).
2. Clique em **Criar aplicação**. Se já houver aplicações, vá em **Suas integrações > Ver todas > Criar aplicação**.
3. O Mercado Pago pede uma verificação de identidade (código por e-mail ou app). Conclua.
4. **Nome:** `EvoLumen Academy` (até 50 letras e números).
5. **Tipo de pagamento:** escolha **Pagamentos online** e clique em **Continuar**.
6. **Tipo de loja:** escolha a opção de loja **desenvolvida por conta própria**. A URL é opcional: pode colocar `https://evolumen.ericktorritezi.com.br`. **Continuar**.
7. **Solução:** escolha **Checkouts** e depois **Checkout Pro**.
8. Revise, aceite os termos e clique em **Confirmar**.

Pronto: a aplicação existe. O Pix é criado pelo nosso sistema direto na API do Mercado Pago, e o cartão usa a página segura do Checkout Pro. As duas coisas funcionam com esta mesma aplicação.

## Parte 3. Credenciais de teste (para o staging)

1. Em **Suas integrações**, clique na aplicação **EvoLumen Academy**.
2. Vá em **Dados da integração > Testes > Credenciais de teste**.
3. Copie o **Access Token** (começa com `APP_USR-`). Guarde num bloco de notas por enquanto.

## Parte 4. Webhook (o aviso automático de pagamento)

O webhook é o jeito de o Mercado Pago avisar o sistema "o pagamento foi aprovado". Sem ele o aluno só é liberado quando voltar para o site.

1. Na aplicação, no menu da esquerda, abra **Webhooks > Configurar notificações**.
2. Na aba **Modo produtivo**, informe a URL:
   - Para o staging, use o endereço do staging: `https://SEU-ENDERECO-DE-STAGING/webhooks/mercadopago`
   - Para a produção (mais tarde): `https://evolumen.ericktorritezi.com.br/webhooks/mercadopago`
3. Marque o evento **Pagamentos**.
4. Clique em **Salvar configuração**. O Mercado Pago gera a **chave secreta**. Revele e copie.
5. Essa chave vai para `MP_WEBHOOK_SECRET`.

Observações importantes:
- A mesma aplicação tem **uma** chave secreta. Se você usar a mesma aplicação nos dois ambientes, a mesma chave serve para os dois.
- Se a tela aceitar apenas uma URL por vez, configure a do staging agora e troque pela de produção na hora de ir ao ar. (Alternativa mais organizada: criar uma segunda aplicação só para produção. Peça e eu explico.)
- O botão **Simular** (na mesma tela) envia um aviso de teste para a URL. Use "Enviar teste" para ver se o sistema responde. Como o teste manda um número de pagamento que não existe, o sistema ignora, e isso é o certo.
- **Pagamentos feitos com credenciais de teste não disparam webhook.** Por isso, no cartão de teste o sistema também confere o pagamento quando o aluno volta do Mercado Pago para a tela do pedido. Você vai ver a aprovação mesmo sem webhook.

## Parte 5. Variáveis no Railway

Railway > projeto **EvoLumen** > serviço do app > aba **Variables**. Faça no staging primeiro.

**Staging**

| Variável | Valor |
|---|---|
| `MP_ACCESS_TOKEN` | o Access Token de teste (Parte 3) |
| `MP_WEBHOOK_SECRET` | a chave secreta (Parte 4) |
| `PAYMENT_PROVIDER` | `mercadopago` (para testar o Mercado Pago de verdade) ou deixe sem criar para usar o **simulador** |

Depois de salvar, o Railway reinicia sozinho.

**Produção** (só quando o staging estiver aprovado)

| Variável | Valor |
|---|---|
| `MP_ACCESS_TOKEN` | Access Token de **produção** (Parte 8) |
| `MP_WEBHOOK_SECRET` | a chave secreta |

**Nunca** crie `PAYMENT_PROVIDER=simulated` na produção. O sistema recusa subir se isso acontecer (de propósito, para ninguém "aprovar" venda de mentira).

Se a produção subir **sem** `MP_ACCESS_TOKEN`, o site funciona normalmente e o botão de matrícula mostra "em breve". Nada quebra.

## Parte 6. Antes de testar: publicar os textos legais

O checkout só abre se os **Termos de uso** e a **Política de privacidade** estiverem publicados.

1. Entre como administrador > **Textos legais**.
2. Em cada um, clique em **Editar**, cole o texto aprovado e **Salvar rascunho**.
3. **Publicar esta versão**. Depois de publicado, o texto não pode mais ser alterado: para mudar, cria-se uma nova versão (isso é uma proteção jurídica).
4. O sistema vai pedir seu aceite dos textos novos. Aceite para continuar.

## Parte 7. Primeiro teste, de ponta a ponta

**Teste A. Sem Mercado Pago (simulador).** No staging **sem** `PAYMENT_PROVIDER`/token, o simulador funciona. Compre um curso e, no menu **Vendas e renovações > Abrir o simulador**, aprove. Confira o e-mail do aluno novo, o acesso, a renovação e o reembolso. É o ensaio geral.

**Teste B. Cartão com o Mercado Pago de verdade (credenciais de teste).**
1. Crie um **usuário de teste comprador** em Suas integrações > **Contas de teste** (o painel guia). Ele serve para entrar no Mercado Pago como cliente.
2. Em janela anônima do navegador, abra o curso no staging e clique em **Matricular-se**, preencha os dados e escolha **Cartão**.
3. Na página do Mercado Pago, pague com o cartão de teste:
   - Cartão Mastercard: `5480 8328 0103 3311` (ou Visa `4235 6477 2802 5682`)
   - Validade `11/30`, código de segurança `123`
   - Nome do titular: `APRO` (aprova). Documento (CPF): `12345678909`
   - Outros nomes testam outros resultados: `FUND` (sem saldo), `SECU` (código inválido), `OTHE` (erro), `CONT` (pendente).
4. Ao voltar para o site, o pedido aparece como **aprovado**, o aluno recebe o e-mail com a senha provisória e o acesso ao curso aparece.

**Teste C. Pix real, com valor mínimo.** O Pix de teste do Mercado Pago só fica "pendente" e nunca confirma, então a única forma de provar que o Pix funciona é um pagamento real pequeno.
1. Troque, **só no staging**, o `MP_ACCESS_TOKEN` pelo Access Token de **produção** (Parte 8).
2. Crie um curso de teste com preço `R$ 1,00` e publique.
3. Compre pelo celular, pague o Pix com a sua conta pessoal. O pedido vira **aprovado** em segundos (aqui o webhook é usado).
4. Peça **reembolso** como aluno (menu **Pagamentos**) e aprove como administrador em **Vendas e renovações**. O dinheiro volta e o acesso é cancelado.
5. Volte o `MP_ACCESS_TOKEN` do staging para o de teste, ou deixe o de produção e apague o curso de teste depois.

## Parte 8. Ativar as credenciais de produção

1. **Suas integrações > (aplicação) > Dados da integração > Credenciais > Produção** (ou **Credenciais de produção** no menu da esquerda).
2. Clique em **Ativar credenciais**.
3. **Indústria:** escolha *Educação*. **Site:** `https://evolumen.ericktorritezi.com.br`.
4. Aceite os termos, resolva o reCAPTCHA e clique em **Ativar credenciais de produção**.
5. Copie o **Access Token de produção**. Ele vai para `MP_ACCESS_TOKEN` na **produção**.

O site já usa HTTPS, que é exigido para receber pagamentos reais.

## Lista final para ir ao ar (versão 1.0)

- [ ] Textos legais publicados em produção.
- [ ] `MP_ACCESS_TOKEN` (produção) e `MP_WEBHOOK_SECRET` criados no Railway da produção.
- [ ] URL do webhook na produção: `https://evolumen.ericktorritezi.com.br/webhooks/mercadopago`, evento **Pagamentos**.
- [ ] Teste real com R$ 1,00 (Pix) e reembolso feitos.
- [ ] `PAYMENT_PROVIDER` **não** existe na produção.

## Se algo der errado

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Botão diz "Matrículas em breve" na produção | falta `MP_ACCESS_TOKEN` | criar a variável |
| O Railway não sobe e o log fala em `MP_WEBHOOK_SECRET` | token sem chave secreta | criar `MP_WEBHOOK_SECRET` |
| Pagamento aprovado no Mercado Pago, mas o aluno não foi liberado | webhook não chegou | conferir URL e evento no painel. Enquanto o aluno está na tela do pedido, o sistema também consulta o Mercado Pago sozinho; em **Vendas e renovações** o pedido mostra o estado |
| Webhook responde 401 | chave secreta errada | copiar de novo em Webhooks > Configurar notificações |
| Reembolso falha com "O Mercado Pago não conseguiu devolver" | saldo insuficiente na conta Mercado Pago ou pagamento antigo | devolver pelo painel do Mercado Pago e avisar o suporte |
