export function keepDigits(value = '') {
  return value.replace(/\D/g, '');
}

export function normalizePlate(value = '') {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7);
}

const PLACA_ANTIGA_REGEX = /^[A-Z]{3}[0-9]{4}$/;
const PLACA_MERCOSUL_REGEX = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/;

export function isValidBrazilianPlate(value = '') {
  const normalized = normalizePlate(value);
  if (normalized.length !== 7) return false;
  return PLACA_ANTIGA_REGEX.test(normalized) || PLACA_MERCOSUL_REGEX.test(normalized);
}

export function formatBrazilianPlate(value = '') {
  const normalized = normalizePlate(value);
  if (normalized.length <= 3) return normalized;
  if (normalized.length <= 7) return `${normalized.slice(0, 3)}-${normalized.slice(3)}`;
  return normalized;
}

export function normalizePhone(value = '') {
  return keepDigits(value).slice(0, 11);
}

export function formatPhone(value = '') {
  const digits = normalizePhone(value);

  if (digits.length <= 2) return digits;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  return digits;
}

export function normalizeCpf(value = '') {
  return keepDigits(value).slice(0, 11);
}

export function formatCpf(value = '') {
  const digits = normalizeCpf(value);

  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

export function normalizeZipCode(value = '') {
  return keepDigits(value).slice(0, 8);
}

export function formatZipCode(value = '') {
  const digits = normalizeZipCode(value);

  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}
