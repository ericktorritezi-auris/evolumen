/* 1.8.0: simulador de comissão (admin). Só calcula na tela; não envia nem grava nada. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  if (!$('sim-v')) return;
  var bad = false;
  var num = function (v) {
    var s = String(v || '').trim();
    if (!s) return 0;
    if (!/^\d[\d.,]*$/.test(s)) { bad = true; return 0; } // negativo, letras ou lixo
    if (s.indexOf(',') > -1 || /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    var x = parseFloat(s); if (!isFinite(x)) { bad = true; return 0; }
    return x;
  };
  var brl = function (c) { return (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); };
  function calc() {
    bad = false; var msg = '';
    var vRaw = num($('sim-v').value), d = num($('sim-d').value), a = num($('sim-a').value);
    if (bad) msg = 'Use só números positivos, por exemplo 249,90.';
    else if (d > 100 || a > 100) msg = 'Percentual acima de 100% não faz sentido; a conta usa 100%.';
    else if (d >= 100) msg = 'Cupom de 100% é cortesia: não gera comissão.';
    else if (d !== Math.floor(d)) msg = 'Os cupons da plataforma têm desconto em número inteiro (1 a 99%).';
    d = Math.min(d, 100); a = Math.min(a, 100);
    // Mesma regra das vendas reais, em centavos: comissão = round(valor pago × % do afiliado).
    var cents = Math.round(vRaw * 100);
    var paid = Math.round(cents * (10000 - Math.round(d * 100)) / 10000);
    var com = d >= 100 ? 0 : Math.round(paid * Math.round(a * 100) / 10000);
    var plat = paid - com;
    $('sim-paid').textContent = brl(paid); $('sim-com').textContent = brl(com); $('sim-plat').textContent = brl(plat);
    $('sim-pct').textContent = paid ? (plat / paid * 100).toFixed(1).replace('.', ',') + '% do valor pago' : '';
    $('sim-msg').hidden = !msg; $('sim-msg').textContent = msg;
    ['sim-v', 'sim-d', 'sim-a'].forEach(function (id) { if (msg) $(id).setAttribute('aria-invalid', 'true'); else $(id).removeAttribute('aria-invalid'); });
  }
  ['sim-v', 'sim-d', 'sim-a'].forEach(function (id) { $(id).addEventListener('input', calc); });
  calc();
})();
