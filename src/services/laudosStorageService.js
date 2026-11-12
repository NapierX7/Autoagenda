import { supabase, hasSupabaseCredentials } from '../lib/supabase';
import {
  formatBytes,
  isOversizedInlineLaudoDataUrl,
  LAUDO_LIMITS,
} from '../utils/laudoLimits';
import {
  isExternalLaudoUrl,
  isInlineLaudoDataUrl,
  toLaudoStoragePath,
  toPersistedLaudoRef,
} from '../utils/laudoRefs';

export { formatBytes, isOversizedInlineLaudoDataUrl, LAUDO_LIMITS };
export {
  isExternalLaudoUrl,
  isInlineLaudoDataUrl,
  toLaudoStoragePath,
  toPersistedLaudoRef,
};

const LAUDOS_BUCKET = LAUDO_LIMITS.STORAGE_BUCKET;
const MAX_STORAGE_UPLOAD_BYTES = LAUDO_LIMITS.MAX_STORAGE_UPLOAD_BYTES;
const FALLBACK_MAX_BASE64_BYTES = LAUDO_LIMITS.MAX_INLINE_FILE_BYTES;
/** Tempo de vida do link assinado (não persiste no banco). */
export const LAUDO_SIGNED_URL_EXPIRES_IN = 60 * 60;

function sanitizePathPart(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .slice(0, 80);
}

function buildStoragePath({ companyId, appointmentId, fileName }) {
  const safeCompany = sanitizePathPart(companyId);
  const safeAppointment = sanitizePathPart(appointmentId || `appt_${Date.now()}`);
  const timestamp = Date.now();
  const safeFileName = sanitizePathPart(fileName || 'laudo.pdf');
  return `${safeCompany}/${safeAppointment}/${timestamp}_${safeFileName}`;
}

export async function isStorageBucketReady() {
  if (!hasSupabaseCredentials || !supabase) return false;
  try {
    const { data, error } = await supabase.storage.getBucket(LAUDOS_BUCKET);
    if (error || !data) return false;
    return true;
  } catch {
    return false;
  }
}

export async function uploadLaudoToStorage(
  file,
  { companyId, appointmentId } = {},
  onProgress = null,
) {
  if (!hasSupabaseCredentials || !supabase) {
    throw new Error('Credenciais do Supabase não configuradas.');
  }
  if (!file || !(file instanceof File)) {
    throw new Error('Arquivo inválido.');
  }
  if (file.size > MAX_STORAGE_UPLOAD_BYTES) {
    throw new Error(
      `Arquivo muito grande para o Storage (${formatBytes(file.size)}). Limite máximo: ${formatBytes(MAX_STORAGE_UPLOAD_BYTES)}.`,
    );
  }
  if (!companyId) {
    throw new Error('Company ID ausente. Impossível organizar o arquivo no Storage.');
  }

  const storagePath = buildStoragePath({ companyId, appointmentId, fileName: file.name });

  if (typeof onProgress === 'function') {
    onProgress({ percent: 2, stage: 'uploading', storagePath });
  }

  const uploadOptions = {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || 'application/octet-stream',
  };

  try {
    const { data, error } = await supabase.storage
      .from(LAUDOS_BUCKET)
      .upload(storagePath, file, uploadOptions);

    if (error) {
      if (
        typeof error.message === 'string' &&
        (error.message.includes('bucket') || error.message.includes('does not exist'))
      ) {
        throw new Error(
          'Bucket "laudos" não encontrado no Supabase Storage. Siga as instruções para criar o bucket antes de enviar arquivos.',
        );
      }
      throw new Error(error.message || 'Falha ao enviar arquivo para o Storage.');
    }

    const persistedPath = data?.path || storagePath;

    if (typeof onProgress === 'function') {
      onProgress({ percent: 100, stage: 'done', storagePath: persistedPath });
    }

    // Persistir somente o path; URL assinada é gerada sob demanda na visualização.
    return {
      storagePath: persistedPath,
      /** @deprecated Use storagePath — não gravar publicUrl no banco. */
      publicUrl: null,
      fileName: file.name,
      fileSize: file.size,
      source: 'storage',
    };
  } catch (uploadError) {
    if (uploadError && typeof uploadError.message === 'string') throw uploadError;
    throw new Error('Falha inesperada ao enviar o arquivo. Tente novamente.');
  }
}

/**
 * Gera URL assinada temporária. Nunca persistir o retorno no banco.
 */
export async function createSignedLaudoUrl(
  storagePathOrRef,
  expiresIn = LAUDO_SIGNED_URL_EXPIRES_IN,
) {
  if (!hasSupabaseCredentials || !supabase) {
    throw new Error('Credenciais do Supabase não configuradas.');
  }
  const path = toLaudoStoragePath(storagePathOrRef) || String(storagePathOrRef || '').trim();
  if (!path) {
    throw new Error('Caminho do laudo inválido.');
  }

  const { data, error } = await supabase.storage
    .from(LAUDOS_BUCKET)
    .createSignedUrl(path, expiresIn);

  if (error || !data?.signedUrl) {
    throw new Error(error?.message || 'Não foi possível gerar link assinado do laudo.');
  }
  return data.signedUrl;
}

/**
 * Resolve um ref persistido (path | https externa | data:) para URL abrível agora.
 * Para paths de Storage, gera signed URL sob demanda.
 */
export async function resolveLaudoAccessUrl(ref, { expiresIn = LAUDO_SIGNED_URL_EXPIRES_IN } = {}) {
  if (typeof ref !== 'string' || !ref.trim()) return null;
  const trimmed = ref.trim();
  if (isInlineLaudoDataUrl(trimmed)) return trimmed;
  if (isExternalLaudoUrl(trimmed)) return trimmed;
  const path = toLaudoStoragePath(trimmed);
  if (!path) return null;
  return createSignedLaudoUrl(path, expiresIn);
}

export async function openLaudoInNewTab(ref, { expiresIn = LAUDO_SIGNED_URL_EXPIRES_IN } = {}) {
  const url = await resolveLaudoAccessUrl(ref, { expiresIn });
  if (!url) {
    throw new Error('Referência de laudo inválida.');
  }
  if (typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
  return url;
}

/** @deprecated Prefer createSignedLaudoUrl — bucket privado não usa URL pública. */
export function getLaudoPublicUrl(_storagePath) {
  return '';
}

export async function deleteLaudoFromStorage(storagePath) {
  if (!hasSupabaseCredentials || !supabase || !storagePath) return false;
  const path = toLaudoStoragePath(storagePath) || storagePath;
  try {
    const { error } = await supabase.storage.from(LAUDOS_BUCKET).remove([path]);
    return !error;
  } catch {
    return false;
  }
}

export async function fileToBase64(file, maxBytes = FALLBACK_MAX_BASE64_BYTES) {
  if (!file || !(file instanceof File)) {
    throw new Error('Arquivo inválido.');
  }
  if (file.size > maxBytes) {
    throw new Error(
      `Arquivo muito grande para anexar diretamente (${formatBytes(file.size)}). ` +
        `Limite: ${formatBytes(maxBytes)}. Use a URL do Drive ou ative o Supabase Storage para arquivos maiores.`,
    );
  }

  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Falha ao ler o arquivo selecionado.'));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') resolve(result);
      else reject(new Error('Formato de arquivo inválido.'));
    };
    reader.readAsDataURL(file);
  });
}
