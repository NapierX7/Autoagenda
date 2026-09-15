import { useEffect, useRef, useState } from 'react';
import {
  fileToBase64,
  formatBytes,
  LAUDO_LIMITS,
  uploadLaudoToStorage,
} from '../../services/laudosStorageService';

export default function FinalizeModal({
  appointment,
  onClose,
  onConfirm,
  isSubmitting,
  companyId,
}) {
  const [result, setResult] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [laudoFileUrl, setLaudoFileUrl] = useState('');
  const [laudoFileName, setLaudoFileName] = useState('');
  const [localError, setLocalError] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadStage, setUploadStage] = useState('');
  const [uploadSource, setUploadSource] = useState('url');
  const fileInputRef = useRef(null);
  const abortSignalRef = useRef(false);

  useEffect(() => {
    if (appointment?.laudoFileUrl) {
      setLaudoFileUrl(appointment.laudoFileUrl);
    }
    if (appointment?.laudoFileName) {
      setLaudoFileName(appointment.laudoFileName);
    }
  }, [appointment?.id, appointment?.laudoFileUrl, appointment?.laudoFileName]);

  if (!appointment) return null;

  function clearFile() {
    setLaudoFileUrl('');
    setLaudoFileName('');
    setUploadProgress(0);
    setUploading(false);
    setUploadStage('');
    setUploadSource('url');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  async function handleFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setLocalError('');
    abortSignalRef.current = false;

    if (file.size > LAUDO_LIMITS.MAX_STORAGE_UPLOAD_BYTES) {
      setLocalError(
        `Arquivo muito grande: ${formatBytes(file.size)}. Limite máximo: ${formatBytes(LAUDO_LIMITS.MAX_STORAGE_UPLOAD_BYTES)}. Reduza o tamanho ou hospede no Drive.`,
      );
      clearFile();
      return;
    }

    setLaudoFileName(file.name);
    setUploading(true);
    setUploadProgress(1);
    setUploadStage('Preparando arquivo…');

    const base64FallbackMaxSize = LAUDO_LIMITS.FALLBACK_MAX_BASE64_BYTES;

    try {
      if (companyId) {
        try {
          const uploaded = await uploadLaudoToStorage(
            file,
            { companyId, appointmentId: appointment.id },
            ({ percent, stage }) => {
              if (abortSignalRef.current) return;
              setUploadProgress(Math.min(95, percent));
              if (stage === 'uploading') setUploadStage('Enviando para o Storage…');
              if (stage === 'generating-url') setUploadStage('Gerando link público…');
            },
          );
          if (abortSignalRef.current) return;
          setLaudoFileUrl(uploaded.publicUrl);
          setLaudoFileName(uploaded.fileName || file.name);
          setUploadSource('storage');
          setUploadProgress(100);
          setUploadStage('Pronto ✅');
          return;
        } catch (storageError) {
          const storageMessage =
            storageError && typeof storageError.message === 'string' ? storageError.message : '';
          const bucketNotFound =
            storageMessage.includes('Bucket') && storageMessage.includes('laudos');
          if (file.size > base64FallbackMaxSize) {
            if (bucketNotFound) {
              throw new Error(
                `Bucket "laudos" não está configurado no Supabase Storage e o arquivo é grande (${formatBytes(file.size)}). ` +
                  `Crie o bucket (recomendado) ou use um arquivo com até ${formatBytes(base64FallbackMaxSize)} para o modo compatível.`,
              );
            }
            throw new Error(
              storageMessage ||
                `Falha ao enviar para o Storage e arquivo muito grande para fallback (${formatBytes(file.size)} > ${formatBytes(base64FallbackMaxSize)}).`,
            );
          }
          setUploadStage('Modo compatível (Base64)…');
          setUploadProgress(40);
        }
      }

      const base64 = await fileToBase64(file, base64FallbackMaxSize);
      if (abortSignalRef.current) return;
      setLaudoFileUrl(base64);
      setUploadSource('base64');
      setUploadProgress(100);
      setUploadStage('Pronto ✅ (modo compatível)');
    } catch (err) {
      if (abortSignalRef.current) return;
      clearFile();
      setLocalError(err?.message || 'Não foi possível anexar o arquivo.');
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setLocalError('');

    if (uploading) {
      setLocalError('Aguarde o upload do arquivo terminar antes de confirmar.');
      return;
    }

    if (!result) {
      setLocalError('Selecione se o laudo foi aprovado ou reprovado.');
      return;
    }

    if (result === 'rejected' && rejectionReason.trim().length < 3) {
      setLocalError('Informe o motivo da reprovação.');
      return;
    }

    await onConfirm({
      result,
      rejectionReason: result === 'rejected' ? rejectionReason.trim() : '',
      laudoFileUrl: laudoFileUrl || appointment.laudoFileUrl,
      laudoFileName: laudoFileName || appointment.laudoFileName,
      laudoUploadSource: uploadSource,
    });
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="modal-panel small-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="finalize-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <span className="section-tag">✅ Finalizar laudo</span>
            <h2 id="finalize-modal-title">Resultado do laudo cautelar</h2>
            <p>
              👤 {appointment.customerName} · 🚗 {appointment.vehiclePlate}
            </p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Fechar modal">
            ✕
          </button>
        </header>

        {localError && (
          <div className="auth-message error">
            <strong>⚠️ Erro ao finalizar.</strong>
            <span>{localError}</span>
          </div>
        )}

        <div className="auth-message info">
          <strong>💡 Tamanho de arquivo & Storage</strong>
          <span>
            <strong>✅ Com Supabase Storage (recomendado):</strong> até <strong>50MB</strong>.
            Arquivo é enviado para o bucket e só um link é salvo no banco.<br /><br />
            <strong>⚠️ Sem Storage (modo compatível):</strong> até <strong>20MB</strong>,
            convertido para Base64 (+33% tamanho salvo diretamente na tabela).<br /><br />
            <strong>🔗 Alternativa sempre válida:</strong> cole a URL do Google Drive / Dropbox abaixo.
          </span>
        </div>

        <form className="modal-form" onSubmit={handleSubmit}>
          <div className="result-buttons-grid">
            <button
              type="button"
              className={`result-button approved ${result === 'approved' ? 'is-selected' : ''}`}
              onClick={() => setResult('approved')}
              disabled={isSubmitting}
            >
              <span className="result-emoji" aria-hidden>🟢</span>
              <strong>Aprovado</strong>
              <small>Veículo aprovado no laudo cautelar</small>
            </button>
            <button
              type="button"
              className={`result-button rejected ${result === 'rejected' ? 'is-selected' : ''}`}
              onClick={() => setResult('rejected')}
              disabled={isSubmitting}
            >
              <span className="result-emoji" aria-hidden>🔴</span>
              <strong>Reprovado</strong>
              <small>Veículo reprovado no laudo cautelar</small>
            </button>
          </div>

          {result === 'rejected' && (
            <label className="modal-grid-full">
              Motivo da reprovação
              <textarea
                rows="4"
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Descreva o motivo da reprovação do veículo (ex: problemas no motor, documentação pendente, etc)."
                required
                disabled={isSubmitting}
              />
            </label>
          )}

          <label className="modal-grid-full">
            Arquivo do laudo cautelar (PDF ou imagem)
            <div className="file-upload-row">
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,image/*"
                onChange={handleFileChange}
                className="file-input-hidden"
              />
              <button
                type="button"
                className="ghost-button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isSubmitting || uploading}
              >
                {laudoFileName ? `Trocar: ${laudoFileName}` : 'Selecionar arquivo'}
              </button>
              {laudoFileName && (
                <button
                  type="button"
                  className="ghost-button danger"
                  onClick={clearFile}
                  disabled={isSubmitting || uploading}
                >
                  Remover
                </button>
              )}
              <small className="helper-text-inline">
                PDF, PNG ou JPG. <strong>Até 50MB com Storage · 20MB modo compatível</strong>.
              </small>
            </div>

            {laudoFileName && uploadProgress > 0 && (
              <div className="upload-progress-wrapper">
                <div className="upload-progress-bar" role="progressbar" aria-valuenow={uploadProgress} aria-valuemin={0} aria-valuemax={100}>
                  <div className="upload-progress-fill" style={{ width: `${uploadProgress}%` }} />
                </div>
                <div className="upload-progress-meta">
                  <span className="upload-progress-percent">{uploadProgress}%</span>
                  {uploadStage && <span className="upload-progress-stage">{uploadStage}</span>}
                  {uploadSource !== 'url' && (
                    <span className={`upload-source-badge source-${uploadSource}`}>
                      {uploadSource === 'storage' ? '⭐ Storage' : '⚠️ Base64'}
                    </span>
                  )}
                </div>
              </div>
            )}

            {appointment.laudoFileUrl && !laudoFileUrl && (
              <small className="helper-text-inline">
                Já existe um arquivo anexado neste agendamento.
              </small>
            )}
          </label>

          <label className="modal-grid-full">
            Ou cole a URL do arquivo laudo (ex: link do Drive / storage)
            <input
              type="url"
              value={laudoFileUrl.startsWith('data:') ? '' : laudoFileUrl}
              onChange={(e) => {
                setLaudoFileUrl(e.target.value);
                if (e.target.value) {
                  setUploadSource('url');
                  setUploadProgress(100);
                }
                if (!laudoFileName) {
                  try {
                    const url = new URL(e.target.value);
                    const name = url.pathname.split('/').pop() || 'laudo.pdf';
                    setLaudoFileName(decodeURIComponent(name));
                  } catch {
                    /* ignore */
                  }
                }
              }}
              placeholder="https://exemplo.com/laudo.pdf"
              disabled={isSubmitting}
            />
          </label>

          <footer className="modal-actions">
            <div className="modal-secondary-actions" />
            <div className="modal-primary-actions">
              <button type="button" className="ghost-button" onClick={onClose} disabled={isSubmitting}>
                Voltar
              </button>
              <button type="submit" className="primary-button" disabled={isSubmitting || !result}>
                {isSubmitting ? '⏳ Finalizando…' : '✅ Confirmar finalização'}
              </button>
            </div>
          </footer>
        </form>
      </section>
    </div>
  );
}
