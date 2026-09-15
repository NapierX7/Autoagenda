import { supabase, hasSupabaseCredentials } from '../lib/supabase';

const LAUDOS_BUCKET = 'laudos';
const MAX_STORAGE_UPLOAD_BYTES = 50 * 1024 * 1024;
const FALLBACK_MAX_BASE64_BYTES = 20 * 1024 * 1024;

export const LAUDO_LIMITS = {
  MAX_STORAGE_UPLOAD_BYTES,
  FALLBACK_MAX_BASE64_BYTES,
  STORAGE_BUCKET: LAUDOS_BUCKET,
};

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

    if (typeof onProgress === 'function') {
      onProgress({ percent: 85, stage: 'generating-url', storagePath });
    }

    const publicUrl = getLaudoPublicUrl(data?.path || storagePath);

    if (typeof onProgress === 'function') {
      onProgress({ percent: 100, stage: 'done', storagePath, publicUrl });
    }

    return {
      storagePath: data?.path || storagePath,
      publicUrl,
      fileName: file.name,
      fileSize: file.size,
      source: 'storage',
    };
  } catch (uploadError) {
    if (uploadError && typeof uploadError.message === 'string') throw uploadError;
    throw new Error('Falha inesperada ao enviar o arquivo. Tente novamente.');
  }
}

export function getLaudoPublicUrl(storagePath) {
  if (!hasSupabaseCredentials || !supabase || !storagePath) return '';
  try {
    const { data } = supabase.storage.from(LAUDOS_BUCKET).getPublicUrl(storagePath);
    return data?.publicUrl || '';
  } catch {
    return '';
  }
}

export async function deleteLaudoFromStorage(storagePath) {
  if (!hasSupabaseCredentials || !supabase || !storagePath) return false;
  try {
    const { error } = await supabase.storage.from(LAUDOS_BUCKET).remove([storagePath]);
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
