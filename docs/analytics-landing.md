# EvoLumen Analytics nas landings (para a IA que cuida da landing)

## 1. Linha do script (uma vez, no modelo-mestre, antes de `</head>`)

```html
<script src="https://evolumen.ericktorritezi.com.br/static/js/ea.js" defer></script>
```

- Colocar no modelo-mestre: todas as landings (uma por cupom) passam a ser medidas.
- Não precisa de mais nada: sem chave, sem configuração por landing.
- O endereço da landing precisa estar em `ANALYTICS_ORIGINS` no Railway, com esquema e sem barra no final (ex.: `https://masterclass.ericktorritezi.com.br`). Se a variável existir, ela substitui o padrão: liste todos os endereços de landing, separados por vírgula.
- Se a landing usa política de segurança de conteúdo (CSP), liberar `script-src` e `connect-src` para `https://evolumen.ericktorritezi.com.br`.
- O link do botão de compra deve continuar levando `?cupom=CODIGO` ao checkout. A origem da visita pode ser marcada no link de divulgação com `?origem=instagram` (ou `whatsapp`, `facebook`, `youtube`, `email`).

## 2. Aviso na landing (rodapé da página)

Texto do rodapé:

> Medimos as visitas desta página com um sistema próprio, usando dois identificadores anônimos no seu navegador, sem cookies de terceiros e sem propaganda. Você pode recusar a qualquer momento. [Aviso de Privacidade e Cookies](https://evolumen.ericktorritezi.com.br/aviso-de-privacidade-e-cookies)

Recomendado: a landing mostra a mesma faixa da plataforma (texto: "Usamos dois identificadores anônimos para entender como o site é usado, sem cookies de terceiros nem propaganda. Você pode recusar a qualquer momento. Saiba mais", com os botões *Entendi* e *Não quero ser medido*). Se for só o link no rodapé, o rodapé precisa citar os identificadores, como no texto acima.

Para recusar, o botão da landing deve levar à página do Aviso (`https://evolumen.ericktorritezi.com.br/aviso-de-privacidade-e-cookies`), onde a pessoa recusa com um clique. A escolha vale para todas as páginas do domínio, porque o cookie `ea_off` é gravado em `.ericktorritezi.com.br` (`Secure; SameSite=Lax; path=/`, 13 meses). Se a landing implementar o próprio botão, deve gravar `ea_off=1` com esses mesmos atributos, apagar `ea_v` e `ea_s` e avisar o servidor com um POST `text/plain` para `/ea/c` com `{"x":1,"v":"<ea_v>"}`.

## 3. O que o script faz

Respeita "Não rastrear" e o controle global de privacidade; envia um aviso por página para `https://evolumen.ericktorritezi.com.br/ea/c`; guarda os cookies `ea_v` (visitante, 13 meses) e `ea_s` (visita, 30 minutos) no domínio-mãe, para a visita seguir da landing para o checkout.
