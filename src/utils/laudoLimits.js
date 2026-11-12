const MAX_STORAGE_UPLOAD_BYTES = 50 * 1024 * 1024;
/** Limite de caracteres da data URL aceito na finalização (gravação no banco). */
const MAX_INLINE_DATA_URL_CHARS = 200 * 1024;
/**
 * Equivalente binário aproximado do limite acima (Base64 ≈ 4/3 do binário + prefixo data:).
 * O modal NÃO deve preparar um arquivo maior do que a finalização aceita.
 */
const MAX_INLINE_FILE_BYTES = Math.floor((MAX_INLINE_DATA_URL_CHARS - 128) * 0.75);

export const LAUDO_LIMITS = {
  MAX_STORAGE_UPLOAD_BYTES,
  /** @deprecated use MAX_INLINE_FILE_BYTES — mantido como alias alinhado */
  FALLBACK_MAX_BASE64_BYTES: MAX_INLINE_FILE_BYTES,
  MAX_INLINE_FILE_BYTES,
  MAX_INLINE_DATA_URL_CHARS,
  STORAGE_BUCKET: 'laudos',
};

export function isOversizedInlineLaudoDataUrl(url) {
  return typeof url === 'string' && url.startsWith('data:') && url.length > MAX_INLINE_DATA_URL_CHARS;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let unitIndex = 0;
  let size = bytes;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 100 || unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}
