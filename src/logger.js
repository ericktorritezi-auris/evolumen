'use strict';
// Log simples em JSON, uma linha por evento. Nunca registrar senhas, tokens ou códigos.
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
let level = LEVELS.info;
function setLevel(l) { level = LEVELS[l] ?? LEVELS.info; }
function emit(l, msg, meta) {
  if (LEVELS[l] > level) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level: l, msg, ...(meta || {}) });
  (l === 'error' ? process.stderr : process.stdout).write(line + '\n');
}
module.exports = {
  setLevel,
  error: (m, x) => emit('error', m, x),
  warn: (m, x) => emit('warn', m, x),
  info: (m, x) => emit('info', m, x),
  debug: (m, x) => emit('debug', m, x),
};
