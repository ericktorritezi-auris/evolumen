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

function profileFields(body) {
  const errors = {};
  const name = String(body.name || '').trim().replace(/\s+/g, ' ');
  if (name.length < 3 || name.length > 120) errors.name = 'Informe seu nome completo.';
  const phone = digits(body.phone);
  if (phone && (phone.length < 10 || phone.length > 11)) errors.phone = 'Telefone com DDD, 10 ou 11 números.';
  const cep = digits(body.cep);
  if (cep && cep.length !== 8) errors.cep = 'CEP com 8 números.';
  const state = String(body.state || '').trim().toUpperCase();
  if (state && !UFS.includes(state)) errors.state = 'UF inválida.';
  const clip = (v, n) => String(v || '').trim().slice(0, n);
  return {
    errors,
    values: {
      name, phone: phone || null, cep: cep || null, state: state || null,
      street: clip(body.street, 160) || null, street_number: clip(body.street_number, 20) || null,
      complement: clip(body.complement, 80) || null, district: clip(body.district, 80) || null, city: clip(body.city, 80) || null,
    },
  };
}

module.exports = { normalizeEmail, checkPassword, profileFields, digits, UFS };
