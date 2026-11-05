'use strict';
// Lead Parceiros: arrastar cards entre colunas (computador), recolher etapas (celular) e mover pelo seletor.
// Sem JavaScript tudo continua funcionando pelo botão "Mover" de cada card.
(function () {
  var board = document.getElementById('lp-board'); if (!board) return;
  var drop = document.getElementById('lp-drop');
  var mobile = function () { return window.matchMedia('(max-width:820px)').matches; };

  // seletor: ao escolher a etapa, envia na hora (o botão "Mover" fica só como alternativa sem JS)
  board.querySelectorAll('.lp-move').forEach(function (f) {
    var s = f.querySelector('select'), b = f.querySelector('button'); if (b) b.hidden = true;
    var keys = false; // seta do teclado não deve enviar a cada etapa: no teclado, Enter confirma
    s.addEventListener('keydown', function (e) { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') keys = true; if (e.key === 'Enter' && s.value) { e.preventDefault(); f.submit(); } });
    s.addEventListener('change', function () { if (s.value && !keys) f.submit(); keys = false; });
    s.addEventListener('blur', function () { keys = false; });
  });

  // celular: recolher/abrir etapa
  board.querySelectorAll('.lp-col__h').forEach(function (h) {
    h.addEventListener('click', function () { if (mobile()) h.setAttribute('aria-expanded', String(!h.parentNode.classList.toggle('is-closed'))); });
  });

  // computador: arrastar e soltar
  var dragging = null;
  board.addEventListener('dragstart', function (e) {
    if (e.target.closest && e.target.closest('select,input,summary,button,textarea')) { e.preventDefault(); return; }
    var c = e.target.closest ? e.target.closest('.lp-card') : null; if (!c) return;
    dragging = c.getAttribute('data-lead'); c.classList.add('is-drag');
    try { e.dataTransfer.setData('text/plain', dragging); e.dataTransfer.effectAllowed = 'move'; } catch (x) {}
  });
  board.addEventListener('dragend', function (e) { dragging = null; var c = e.target.closest ? e.target.closest('.lp-card') : null; if (c) c.classList.remove('is-drag'); board.querySelectorAll('.is-over').forEach(function (x) { x.classList.remove('is-over'); }); });
  board.querySelectorAll('.lp-col').forEach(function (col) {
    col.addEventListener('dragover', function (e) { if (dragging) { e.preventDefault(); col.classList.add('is-over'); } });
    col.addEventListener('dragleave', function (e) { if (!col.contains(e.relatedTarget)) col.classList.remove('is-over'); });
    col.addEventListener('drop', function (e) {
      e.preventDefault(); col.classList.remove('is-over');
      var id = dragging || (e.dataTransfer && e.dataTransfer.getData('text/plain')); if (!id || !/^\d+$/.test(id)) return;
      var card = board.querySelector('.lp-card[data-lead="' + id + '"]');
      if (card && card.closest('.lp-col') === col) return;
      drop.action = '/admin/lead-parceiros/' + id + '/mover'; drop.elements.stage.value = col.getAttribute('data-stage'); drop.submit();
    });
  });
})();
