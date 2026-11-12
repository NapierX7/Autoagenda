const PUBLIC_OR_SIGN_RE =
  /\/storage\/v1\/object\/(?:public|sign)\/laudos\/([^?]+)(?:\?|$)/i;

/**
 * Extrai path durável do Storage a partir de path puro ou URL antiga public/sign.
 * Não retorna URL assinada — só o caminho permanente.
 */
export function toLaudoStoragePath(ref) {
  if (typeof ref !== 'string') return null;
  const trimmed = ref.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('data:')) return null;

  const fromUrl = trimmed.match(PUBLIC_OR_SIGN_RE);
  if (fromUrl?.[1]) {
    try {
      return decodeURIComponent(fromUrl[1]);
    } catch {
      return fromUrl[1];
    }
  }

  if (/^https?:\/\//i.test(trimmed)) {
    // URL externa (Drive etc.) — não é path de Storage
    return null;
  }

  // Path puro: companyId/appointmentId/file.pdf
  const path = trimmed.replace(/^laudos\//i, '').replace(/^\//, '');
  return path.includes('/') ? path : null;
}

export function isExternalLaudoUrl(ref) {
  return typeof ref === 'string' && /^https?:\/\//i.test(ref.trim()) && !PUBLIC_OR_SIGN_RE.test(ref);
}

export function isInlineLaudoDataUrl(ref) {
  return typeof ref === 'string' && ref.trim().startsWith('data:');
}

/** Valor que deve ir para appointments.laudo_file_url (path | https externa | data: curta). */
export function toPersistedLaudoRef(ref) {
  if (typeof ref !== 'string') return null;
  const trimmed = ref.trim();
  if (!trimmed) return null;
  if (isInlineLaudoDataUrl(trimmed)) return trimmed;
  const storagePath = toLaudoStoragePath(trimmed);
  if (storagePath) return storagePath;
  if (isExternalLaudoUrl(trimmed)) return trimmed;
  return null;
}

export function isStorageLaudoRef(ref) {
  return Boolean(toLaudoStoragePath(ref));
}
