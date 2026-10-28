'use strict';
const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

function normalizeEmail(v) {
  const e = String(v || '').trim().toLowerCase();
  if (e.length > 254 || !/^[^\s@<>()[\],;:"\\]+@[^\s@<>()[\],;:"\\]+\.[a-z]{2,}$/i.test(e)) return null;
  return e;
}

// Mínimo de 8 caracteres, com letras e números. Limite de 72 bytes por causa do bcrypt.
function checkPassword(p) {
  const s = String(p || '');
  if (s.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.';
  if (Buffer.byteLength(s) > 72) return 'A senha pode ter no máximo 72 caracteres.';
  if (!/[A-Za-zÀ-ÿ]/.test(s) || !/\d/.test(s)) return 'A senha precisa ter letras e números.';
  return null;
}

const digits = (v) => String(v || '').replace(/\D/g, '');

function validCpf(v) {
  const c = digits(v);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  for (const n of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += Number(c[i]) * (n + 1 - i);
    if (((sum * 10) % 11) % 10 !== Number(c[n])) return false;
  }
  return true;
}

function profileFields(body, { allowCpf = false } = {}) {
  const errors = {};
  const name = String(body.name || '').trim().replace(/\s+/g, ' ');
  if (name.length < 3 || name.length > 120) errors.name = 'Informe seu nome completo.';
  const phone = digits(body.phone);
  if (phone && (phone.length < 10 || phone.length > 11)) errors.phone = 'Telefone com DDD, 10 ou 11 números.';
  const cep = digits(body.cep);
  if (cep && cep.length !== 8) errors.cep = 'CEP com 8 números.';
  const state = String(body.state || '').trim().toUpperCase();
  if (state && !UFS.includes(state)) errors.state = 'UF inválida.';
  let cpf;
  if (allowCpf) {
    cpf = digits(body.cpf) || null;
    if (cpf && !validCpf(cpf)) errors.cpf = 'CPF inválido. Confira os 11 números.';
  }
  const bd = String(body.birth_date || '').trim();
  let birth = null;
  if (bd) {
    const t = Date.parse(bd + 'T12:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bd) || Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== bd || bd < '1900-01-01' || t > Date.now()) errors.birth_date = 'Informe uma data de nascimento válida.';
    else birth = bd;
  }
  const clip = (v, n) => String(v || '').trim().slice(0, n);
  return {
    errors,
    values: {
      ...(allowCpf ? { cpf } : {}), name, phone: phone || null, birth_date: birth, cep: cep || null, state: state || null,
      street: clip(body.street, 160) || null, street_number: clip(body.street_number, 20) || null,
      complement: clip(body.complement, 80) || null, district: clip(body.district, 80) || null, city: clip(body.city, 80) || null,
    },
  };
}

module.exports = { validCpf, normalizeEmail, checkPassword, profileFields, digits, UFS };
