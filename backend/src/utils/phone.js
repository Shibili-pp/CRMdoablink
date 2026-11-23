function coercePhoneText(input) {
  if (input == null) return '';
  if (typeof input === 'number' && Number.isFinite(input)) {
    return String(Math.trunc(input));
  }
  let text = String(input).trim();
  // Excel often stores long phones as 9.95559E+11
  if (/^\d+(\.\d+)?e[+\-]?\d+$/i.test(text)) {
    const value = Number(text);
    if (Number.isFinite(value)) text = String(Math.round(value));
  }
  return text;
}

function normalizePhone(input, countryCode = '91') {
  if (input == null) return '';
  let digits = coercePhoneText(input).replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  const code = String(countryCode || '91').replace(/\D/g, '') || '91';
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 10) digits = `${code}${digits}`;
  return digits;
}

function isValidPhone(normalized) {
  return /^\d{11,15}$/.test(normalized || '');
}

function formatPhone(normalized) {
  if (!normalized) return '';
  if (normalized.startsWith('91') && normalized.length === 12) {
    const local = normalized.slice(2);
    return `+91 ${local.slice(0, 5)} ${local.slice(5)}`;
  }
  return `+${normalized}`;
}

module.exports = { coercePhoneText, normalizePhone, isValidPhone, formatPhone };
