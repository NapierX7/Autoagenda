import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  formatCpf,
  formatPhone,
  formatZipCode,
  isValidBrazilianPlate,
  normalizePhone,
  normalizePlate,
} from '../../utils/formatters';
import { isOccupancyOnlySelection } from '../../utils/appointmentIds';
import { fetchAddressByCep } from '../../services/cepService';
import { getActiveSellers } from '../../services/appointmentsService';
import { getCancellationApprovalState, isCancellationPending } from '../../utils/appointmentStatus';
import RescheduleModal from './RescheduleModal';
import FinalizeModal from './FinalizeModal';

function buildInitialValues(slotDetails, isEncaixeMode = false) {
  return {
    appointmentDate: slotDetails.day.id,
    appointmentTime: slotDetails.slot.time,
    customerName: slotDetails.slot.appointment?.customerName ?? '',
    customerPhone: slotDetails.slot.appointment?.customerPhone ?? '',
    customerCpf: slotDetails.slot.appointment?.customerCpf ?? '',
    customerZipCode: slotDetails.slot.appointment?.customerZipCode ?? '',
    customerEmail: slotDetails.slot.appointment?.customerEmail ?? '',
    customerAddress: slotDetails.slot.appointment?.customerAddress ?? '',
    sellerName: slotDetails.slot.appointment?.sellerName ?? '',
    sellerEmail: slotDetails.slot.appointment?.sellerEmail ?? '',
    vehiclePlate: slotDetails.slot.appointment?.vehiclePlate ?? '',
    vehicleModel: slotDetails.slot.appointment?.vehicleModel ?? '',
    vehicleYear: slotDetails.slot.appointment?.vehicleYear ?? '',
    notes: slotDetails.slot.appointment?.notes ?? '',
    cancellationRequestReason: slotDetails.slot.appointment?.cancellationRequestReason ?? '',
    status: slotDetails.slot.appointment?.status ?? 'scheduled',
    isVoucher: slotDetails.slot.appointment?.isVoucher ?? false,
    isEncaixe: isEncaixeMode ? true : slotDetails.slot.appointment?.isEncaixe ?? false,
    sellerProfileId: slotDetails.slot.appointment?.sellerProfileId ?? '',
  };
}

function findSellerByEmailOrId(sellers, { email, id, name }) {
  if (!sellers || sellers.length === 0) return null;
  const normEmail = String(email || '').trim().toLowerCase();
  if (normEmail) {
    const byEmail = sellers.find((s) => String(s.email || '').trim().toLowerCase() === normEmail);
    if (byEmail) return byEmail;
  }
  if (id) {
    const byId = sellers.find((s) => String(s.id) === String(id));
    if (byId) return byId;
  }
  if (name) {
    const normName = String(name || '').trim().toLowerCase();
    const byName = sellers.find((s) => String(s.fullName || '').trim().toLowerCase() === normName);
    if (byName) return byName;
  }
  return null;
}

export default function AppointmentModal({
  isOpen,
  slotDetails,
  currentUser,
  isSubmitting,
  isEncaixeMode = false,
  onClose,
  onSave,
  onRequestCancellation,
  onApproveCancellation,
  onCancelAppointment,
  onFinalizeAppointment,
  onApproveVoucher,
  onRescheduleAppointment,
  onDeleteAppointment,
  onForceRefresh,
}) {
  const [formValues, setFormValues] = useState(null);
  const [localError, setLocalError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isLoadingCep, setIsLoadingCep] = useState(false);
  const [showRescheduleModal, setShowRescheduleModal] = useState(false);
  const [showFinalizeModal, setShowFinalizeModal] = useState(false);
  const [sellers, setSellers] = useState([]);
  const [isLoadingSellers, setIsLoadingSellers] = useState(false);
  const [sellerSelectValue, setSellerSelectValue] = useState('');
  const [isClosingForcefully, setIsClosingForcefully] = useState(false);
  const feedbackFooterRef = useRef(null);
  const lastInitKeyRef = useRef(null);
  const closeTriggeredRef = useRef(false);

  function closeWithSuccess(message) {
    closeTriggeredRef.current = true;
    setLocalError('');
    const safeMessage = String(message ?? 'Sucesso').trim() || 'Operação concluída com sucesso!';
    setSuccessMessage(safeMessage);

    const doClose = () => {
      try { setShowFinalizeModal(false); } catch (_e) {}
      try { setShowRescheduleModal(false); } catch (_e) {}
      try { setIsClosingForcefully(true); } catch (_e) {}
      try { onClose?.(); } catch (_e) {}
    };

    if (typeof queueMicrotask === 'function') {
      try { queueMicrotask(doClose); } catch (_e) {}
    }
    window.setTimeout(doClose, 0);
    window.setTimeout(doClose, 16);
    window.setTimeout(doClose, 70);
    window.setTimeout(doClose, 350);
    window.setTimeout(doClose, 700);
    window.setTimeout(doClose, 1800);
    window.setTimeout(doClose, 3500);
  }

  useEffect(() => {
    if (!slotDetails) {
      if (!isOpen) {
        setIsClosingForcefully(false);
        closeTriggeredRef.current = false;
      }
      return;
    }

    const initKey = `${slotDetails.day?.id ?? ''}_${slotDetails.slot?.time ?? ''}_${isEncaixeMode ? 'encaixe' : 'normal'}_${slotDetails.slot.appointment?.id ?? 'new'}`;

    if (closeTriggeredRef.current) {
      return;
    }

    if (!isOpen) {
      lastInitKeyRef.current = null;
      closeTriggeredRef.current = false;
      setIsClosingForcefully(false);
      return;
    }

    if (initKey === lastInitKeyRef.current) {
      return;
    }

    lastInitKeyRef.current = initKey;
    closeTriggeredRef.current = false;

    setFormValues(buildInitialValues(slotDetails, isEncaixeMode));
    setLocalError('');
    setSuccessMessage('');
    setIsClosingForcefully(false);
    setIsLoadingCep(false);
    setShowRescheduleModal(false);
    setShowFinalizeModal(false);

    const role = String(currentUser?.role ?? '').toLowerCase();
    const isSeller = role === 'seller';
    const existingEmail = slotDetails.slot.appointment?.sellerEmail;
    const existingName = slotDetails.slot.appointment?.sellerName;
    const existingSellerProfileId = slotDetails.slot.appointment?.sellerProfileId;

    (async () => {
      setIsLoadingSellers(true);
      try {
        const result = await getActiveSellers();
        const list = result.items || [];
        setSellers(list);

        let selected = null;

        if (isSeller) {
          selected = findSellerByEmailOrId(list, {
            email: currentUser.email,
            id: currentUser.id,
            name: currentUser.fullName,
          });
        } else {
          selected = findSellerByEmailOrId(list, {
            email: existingEmail,
            id: existingSellerProfileId,
            name: existingName,
          });
          if (!selected && list.length === 1) {
            selected = list[0];
          }
        }

        if (selected) {
          setSellerSelectValue(selected.id);
          setFormValues((prev) => ({
            ...(prev || buildInitialValues(slotDetails, isEncaixeMode)),
            sellerName: selected.fullName || '',
            sellerEmail: selected.email || '',
            sellerProfileId: selected.id || '',
          }));
        } else {
          setSellerSelectValue('');
        }
      } catch (err) {
        const msg = err?.message ?? 'Não foi possível carregar a lista de vendedores.';
        setLocalError(msg);
      } finally {
        setIsLoadingSellers(false);
      }
    })();

    return () => {};
  }, [isOpen, slotDetails, isEncaixeMode, currentUser]);

  const isEditing = useMemo(
    () => Boolean(slotDetails?.slot.appointment),
    [slotDetails],
  );
  const cancellationState = useMemo(
    () => getCancellationApprovalState(slotDetails?.slot.appointment),
    [slotDetails],
  );
  const cancellationPending = isCancellationPending(slotDetails?.slot.appointment);
  const isSellerRole = currentUser?.role === 'seller';
  const isAdmin = currentUser?.role === 'admin';
  const isEvaluator = currentUser?.role === 'evaluator';
  const isManager = isAdmin;

  const hasVisibleFeedback = Boolean(successMessage || localError);
  useEffect(() => {
    if (!hasVisibleFeedback || !feedbackFooterRef.current) {
      return;
    }
    try {
      feedbackFooterRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest',
      });
      if (typeof window !== 'undefined' && typeof window.navigator?.vibrate === 'function') {
        try { window.navigator.vibrate(successMessage ? 25 : 45); } catch (_e) {}
      }
      const hint = feedbackFooterRef.current.querySelector('.visible-hint');
      if (hint && typeof hint.classList === 'object') {
        try {
          hint.classList.remove('visible-hint');
          // força reflow
          void hint.offsetWidth;
          hint.classList.add('visible-hint');
        } catch (_e) {}
      }
    } catch (_err) {}
  }, [successMessage, localError, hasVisibleFeedback]);
  const canFinalize = isManager || isEvaluator;
  const canDelete = isManager;
  const canApproveVoucher = isManager;
  const appointment = slotDetails?.slot.appointment;
  const isVoucherPending = appointment?.isVoucher && !appointment?.voucherApprovedAt;
  const isVoucherApproved = appointment?.isVoucher && appointment?.voucherApprovedAt;
  const isVoucherMode = formValues?.isVoucher ?? false;

  if (!isOpen || !slotDetails) {
    return null;
  }

  if (isOccupancyOnlySelection(slotDetails)) {
    return (
      <div className="modal-backdrop" role="presentation" onClick={onClose}>
        <section
          className="modal-panel small-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="occupancy-only-title"
          onClick={(event) => event.stopPropagation()}
        >
          <header className="modal-header">
            <div>
              <span className="section-tag">Horário ocupado</span>
              <h2 id="occupancy-only-title">Detalhes restritos</h2>
              <p>Este cartão só indica disponibilidade. Não é um agendamento editável.</p>
            </div>
            <button type="button" className="icon-button" onClick={onClose} aria-label="Fechar modal">
              ✕
            </button>
          </header>
          <footer className="modal-actions">
            <button type="button" className="ghost-button" onClick={onClose}>
              Fechar
            </button>
          </footer>
        </section>
      </div>
    );
  }

  if (!formValues) {
    return (
      <div className="modal-backdrop" role="presentation" onClick={onClose}>
        <section
          className="modal-panel"
          role="dialog"
          aria-modal="true"
          aria-busy="true"
          onClick={(event) => event.stopPropagation()}
        >
          <header className="modal-header">
            <div>
              <span className="section-tag skeleton skeleton-line w-40" style={{ minHeight: 22, width: 160 }} />
              <h2 id="appointment-modal-loading-title" style={{ margin: 0 }}>
                <span className="skeleton skeleton-line w-80" style={{ minHeight: 28, width: '78%' }} />
              </h2>
              <p style={{ marginTop: 10 }}>
                <span className="skeleton skeleton-line w-60" style={{ minHeight: 14, width: '55%' }} />
              </p>
            </div>
            <button type="button" className="icon-button" onClick={onClose} aria-label="Fechar modal">
              ✕
            </button>
          </header>
          <div className="modal-form" style={{ gap: '1.1rem', display: 'grid' }}>
            <div className="skeleton skeleton-card"><span className="skeleton skeleton-line w-30" /><span className="skeleton skeleton-line w-90" /></div>
            <div className="skeleton skeleton-card"><span className="skeleton skeleton-line w-30" /><span className="skeleton skeleton-line w-90" /></div>
            <div className="skeleton skeleton-card"><span className="skeleton skeleton-line w-30" /><span className="skeleton skeleton-line w-90" /></div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '1rem' }}>
              <div className="skeleton skeleton-card"><span className="skeleton skeleton-line w-30" /><span className="skeleton skeleton-line w-80" /></div>
              <div className="skeleton skeleton-card"><span className="skeleton skeleton-line w-30" /><span className="skeleton skeleton-line w-80" /></div>
            </div>
            <footer className="modal-actions">
              <div className="modal-secondary-actions">
                <span className="skeleton skeleton-line" style={{ minHeight: 40, width: 160, borderRadius: 10 }} />
              </div>
              <div className="modal-primary-actions">
                <span className="skeleton skeleton-line" style={{ minHeight: 40, width: 120, borderRadius: 10 }} />
                <span className="skeleton skeleton-line" style={{ minHeight: 40, width: 200, borderRadius: 10 }} />
              </div>
            </footer>
          </div>
        </section>
      </div>
    );
  }

  function handleChange(event) {
    const { name, value, type, checked } = event.target;

    let nextValue = type === 'checkbox' ? checked : value;

    if (name === 'vehiclePlate' && type !== 'checkbox') {
      nextValue = normalizePlate(value);
    }

    if (name === 'customerPhone' && type !== 'checkbox') {
      nextValue = formatPhone(value);
    }

    if (name === 'customerCpf' && type !== 'checkbox') {
      nextValue = formatCpf(value);
    }

    if (name === 'customerZipCode' && type !== 'checkbox') {
      nextValue = formatZipCode(value);
    }

    if (name === 'sellerSelect') {
      const chosen = sellers.find((s) => String(s.id) === String(nextValue));
      if (chosen) {
        setSellerSelectValue(nextValue);
        setFormValues((current) => ({
          ...current,
          sellerName: chosen.fullName || '',
          sellerEmail: chosen.email || '',
          sellerProfileId: chosen.id || '',
        }));
        return;
      }
      setSellerSelectValue(nextValue);
      return;
    }

    setFormValues((current) => ({
      ...current,
      [name]: nextValue,
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setLocalError('');

    if (isLoadingSellers) {
      setLocalError('Aguarde: carregando a lista de vendedores ativos.');
      return;
    }

    if (!formValues.sellerEmail || String(formValues.sellerEmail).trim().length < 3) {
      setLocalError('Selecione um vendedor antes de salvar. Esta informação é obrigatória para que a agenda apareça corretamente no login dele.');
      return;
    }

    if (!formValues.sellerName || formValues.sellerName.trim().length < 2) {
      setLocalError('Vendedor selecionado não possui nome cadastrado. Escolha outro vendedor da lista ou peça ao gerente para cadastrar um nome válido no perfil.');
      return;
    }

    if (!isValidBrazilianPlate(formValues.vehiclePlate)) {
      setLocalError(
        'Placa inválida para o padrão brasileiro. Use o formato antigo (AAA1111) ou Mercosul (ABC0A00, 3 letras + 1 dígito + 1 letra/dígito + 2 dígitos). Exemplos: HTX4532 ou QLZ1A23.',
      );
      return;
    }

    if (!formValues.vehicleYear || Number(formValues.vehicleYear) < 1900 || Number(formValues.vehicleYear) > 2100) {
      setLocalError('Informe um ano válido para o veículo (1900 a 2100).');
      return;
    }

    if (!isVoucherMode) {
      if (!formValues.customerName || formValues.customerName.trim().length < 2) {
        setLocalError('Informe o nome do cliente (obrigatório).');
        return;
      }

      if (normalizePhone(formValues.customerPhone).length < 10) {
        setLocalError('Informe um telefone válido do cliente (DDD + número, pelo menos 10 dígitos).');
        return;
      }

      if (!formValues.vehicleModel || formValues.vehicleModel.trim().length < 2) {
        setLocalError('Informe o modelo do veículo (obrigatório).');
        return;
      }
    }

    let response = { success: false, error: 'Erro interno no envio.' };

    try {
      const sellerPayload = {
        sellerEmail: String(formValues.sellerEmail || '').trim().toLowerCase(),
        sellerName: String(formValues.sellerName || '').trim(),
        sellerProfileId: formValues.sellerProfileId || null,
      };

      const rawResponse = await onSave({
        appointmentId: slotDetails.slot.appointment?.id ?? null,
        values: {
          ...formValues,
          ...sellerPayload,
        },
      });

      if (rawResponse && typeof rawResponse === 'object') {
        response = rawResponse;
      } else {
        response = { success: true, error: '' };
      }
    } catch (err) {
      const msg =
        (err && (err.message || String(err))) ||
        'Não foi possível salvar neste momento. Verifique sua conexão e tente novamente.';
      response = { success: false, error: msg };
    } finally {
      if (!response.success) {
        const errMsg = response.error ?? 'Não foi possível salvar.';
        setLocalError(errMsg);

        const isSlotConflict =
          typeof errMsg === 'string' &&
          (errMsg.includes('Este horário acabou de ser ocupado') ||
            errMsg.toLowerCase().includes('duplicate key') ||
            errMsg.toLowerCase().includes('horário ocupado') ||
            errMsg.includes('409') ||
            errMsg.includes('conflito'));

        if (isSlotConflict) {
          try { onForceRefresh?.({ force: true }); } catch (_e) {}
        }
      } else {
        closeWithSuccess(isEditing ? 'Dados atualizados com sucesso!' : isEncaixeMode ? 'Encaixe criado! Fechando…' : 'Agendado com sucesso! Fechando…');
      }
    }
  }

  async function handleCepBlur() {
    if (!formValues?.customerZipCode) {
      return;
    }

    try {
      setIsLoadingCep(true);
      const address = await fetchAddressByCep(formValues.customerZipCode);

      setFormValues((current) => ({
        ...current,
        customerAddress: address.fullAddress || current.customerAddress,
      }));
    } catch (error) {
      setLocalError(error.message ?? 'Não foi possível buscar o endereço pelo CEP.');
    } finally {
      setIsLoadingCep(false);
    }
  }

  async function handleCancelAppointment() {
    const appointmentId = slotDetails.slot.appointment.id;
    setLocalError('');

    const confirmed = window.confirm('Deseja realmente cancelar este agendamento e liberar o horário?');
    if (!confirmed) return;

    let response = { success: false, error: 'Erro interno no cancelamento.' };

    try {
      response = await onCancelAppointment(appointmentId);
      if (!response || typeof response !== 'object') response = { success: true };
    } catch (err) {
      response = { success: false, error: (err?.message ?? String(err)) || 'Não foi possível cancelar.' };
    } finally {
      if (!response.success) {
        setLocalError(response.error ?? 'Não foi possível cancelar.');
        return;
      }

      const wantsHardDelete = window.confirm(
        '✅ Cancelamento realizado com sucesso! O horário já foi liberado.\n\nDeseja também EXCLUIR este agendamento permanentemente do histórico?\n\n(Apagar do banco sem deixar registros - ação IRREVERSÍVEL)'
      );

      if (wantsHardDelete) {
        try {
          const deleteResponse = await onDeleteAppointment(appointmentId);
          if (!deleteResponse?.success) {
            setLocalError(deleteResponse?.error ?? 'Cancelado, mas não foi possível excluir do histórico.');
            closeWithSuccess('Cancelamento realizado! Exclusão do histórico: não efetuada.');
            return;
          }
          closeWithSuccess('Cancelado e removido do histórico! Fechando…');
          return;
        } catch (err) {
          setLocalError((err?.message ?? String(err)) || 'Cancelado, mas não foi possível excluir do histórico.');
          closeWithSuccess('Cancelamento realizado! Exclusão do histórico: não efetuada.');
          return;
        }
      }

      closeWithSuccess('Cancelamento efetuado com sucesso! Horário liberado. Fechando…');
    }
  }

  async function handleRequestCancellation() {
    setLocalError('');
    const reason = String(formValues?.cancellationRequestReason ?? '').trim();
    if (reason.length < 3) {
      setLocalError('Informe o motivo do cancelamento antes de prosseguir (pelo menos 3 caracteres).');
      return;
    }

    const confirmed = window.confirm('Deseja solicitar o cancelamento deste agendamento?');
    if (!confirmed) return;

    let response = { success: false, error: 'Erro interno na solicitação.' };
    try {
      response = await onRequestCancellation(
        slotDetails.slot.appointment.id,
        reason,
      );
      if (!response || typeof response !== 'object') response = { success: true };
    } catch (err) {
      response = { success: false, error: (err?.message ?? String(err)) || 'Não foi possível solicitar o cancelamento.' };
    } finally {
      if (!response.success) {
        setLocalError(response.error ?? 'Não foi possível solicitar o cancelamento.');
        return;
      }
      closeWithSuccess('Solicitação enviada! Aguarde a aprovação. Fechando…');
    }
  }

  async function handleApproveCancellation() {
    setLocalError('');
    let response = { success: false, error: 'Erro interno na aprovação.' };
    try {
      response = await onApproveCancellation(slotDetails.slot.appointment.id);
      if (!response || typeof response !== 'object') response = { success: true };
    } catch (err) {
      response = { success: false, error: (err?.message ?? String(err)) || 'Não foi possível aprovar o cancelamento.' };
    } finally {
      if (!response.success) {
        setLocalError(response.error ?? 'Não foi possível aprovar o cancelamento.');
        return;
      }
      closeWithSuccess('Aprovação registrada! Cancelamento concluído. Fechando…');
    }
  }

  async function handleFinalize(payload) {
    setLocalError('');
    let response = { success: false, error: 'Erro interno na finalização.' };
    try {
      response = await onFinalizeAppointment(slotDetails.slot.appointment.id, payload);
      if (!response || typeof response !== 'object') response = { success: true };
    } catch (err) {
      response = { success: false, error: (err?.message ?? String(err)) || 'Não foi possível finalizar.' };
    } finally {
      if (!response.success) {
        setLocalError(response.error ?? 'Não foi possível finalizar.');
        return;
      }
      const resultLabel = payload?.result === 'approved' ? 'Laudo aprovado' : 'Laudo reprovado';
      closeWithSuccess(`${resultLabel}! Finalizado com sucesso. Fechando…`);
    }
  }

  async function handleApproveVoucher() {
    setLocalError('');
    let response = { success: false, error: 'Erro interno na aprovação do voucher.' };
    try {
      response = await onApproveVoucher(slotDetails.slot.appointment.id);
      if (!response || typeof response !== 'object') response = { success: true };
    } catch (err) {
      response = { success: false, error: (err?.message ?? String(err)) || 'Não foi possível aprovar o voucher.' };
    } finally {
      if (!response.success) {
        setLocalError(response.error ?? 'Não foi possível aprovar o voucher.');
        return;
      }
      closeWithSuccess('Voucher aprovado com sucesso! Fechando…');
    }
  }

  async function handleReschedule(payload) {
    setLocalError('');
    let response = { success: false, error: 'Erro interno no reagendamento.' };
    try {
      response = await onRescheduleAppointment(slotDetails.slot.appointment.id, payload);
      if (!response || typeof response !== 'object') response = { success: true };
    } catch (err) {
      response = { success: false, error: (err?.message ?? String(err)) || 'Não foi possível reagendar.' };
    } finally {
      if (!response.success) {
        setLocalError(response.error ?? 'Não foi possível reagendar.');
        return;
      }
      closeWithSuccess(`Reagendado para ${payload?.newDate ?? ''} às ${payload?.newTime ?? ''}! Fechando…`);
    }
  }

  async function handleDelete() {
    setLocalError('');
    if (!window.confirm('Deseja realmente excluir este agendamento permanentemente?')) {
      return;
    }

    let response = { success: false, error: 'Erro interno na exclusão.' };
    try {
      response = await onDeleteAppointment(slotDetails.slot.appointment.id);
      if (!response || typeof response !== 'object') response = { success: true };
    } catch (err) {
      response = { success: false, error: (err?.message ?? String(err)) || 'Não foi possível excluir.' };
    } finally {
      if (!response.success) {
        setLocalError(response.error ?? 'Não foi possível excluir.');
        return;
      }
      closeWithSuccess('Agendamento excluído permanentemente. Fechando…');
    }
  }

  function getRoleLabel() {
    if (isManager) return 'Gerente';
    if (isEvaluator) return 'Avaliador';
    return 'Vendedor';
  }

  return (
    <>
      {isClosingForcefully ? null : !isOpen ? null : (!slotDetails) ? null : (
      <div className="modal-backdrop" role="presentation" onClick={onClose}>
        <section
          className="modal-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="appointment-modal-title"
          onClick={(event) => event.stopPropagation()}
        >
          <header className="modal-header">
            <div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="section-tag">
                  {isEditing ? '✏️ Editar agendamento' : isEncaixeMode ? '🔀 Modo encaixe' : '➕ Novo agendamento'}
                </span>
                {isEditing && appointment?.status === 'scheduled' && (
                  <span className="section-tag warning-tag">📌 Agendado</span>
                )}
                {isEditing && appointment?.status === 'completed' && (
                  <span className="section-tag success-tag">✅ Finalizado</span>
                )}
                {isEditing && appointment?.status === 'cancelled' && (
                  <span className="section-tag danger-tag">🚫 Cancelado</span>
                )}
                {appointment?.isVoucher && (
                  <span className="section-tag warning-tag">🎟️ Voucher</span>
                )}
              </div>
              <h2 id="appointment-modal-title">
                📅 {slotDetails.day.label} · {slotDetails.day.fullDate} · ⏰ {slotDetails.slot.time}
              </h2>
              <p>
                {isEditing
                  ? 'Atualize dados, finalize o laudo ou libere o horário.'
                  : isEncaixeMode
                    ? 'Carro extra autorizado pelo gerente — pode ocupar o mesmo slot.'
                    : 'Preencha os dados para reservar.'}
              </p>
            </div>
            <button type="button" className="icon-button" onClick={onClose} aria-label="Fechar modal">
              ✕
            </button>
          </header>

          {isEncaixeMode && !isEditing && (
            <div className="auth-message encaixe">
              <strong>🔀 Modo encaixe ativado.</strong>
              <span>
                Este é um encaixe de última hora autorizado pelo gerente. O sistema já permite este horário ser ocupado
                em duplicidade com o(s) agendamento(s) original(is). Ao salvar, este carro aparece no mesmo slot.
              </span>
            </div>
          )}

          {isEditing && isVoucherPending && canApproveVoucher && (
            <div className="auth-message warning">
              <strong>Voucher aguardando aprovação.</strong>
              <span>Este agendamento utiliza voucher. Aprovação do gerente é necessária para confirmar o uso.</span>
            </div>
          )}

          {isEditing && isVoucherMode && !isVoucherApproved && isSellerRole && (
            <div className="auth-message warning">
              <strong>Voucher criado.</strong>
              <span>
                Autorização pendente. Por favor, avise o gerente para que ele aprove o uso do voucher através do login dele.
              </span>
            </div>
          )}

          {cancellationPending && (
            <div className="auth-message warning">
              <strong>Cancelamento em aprovação.</strong>
              <span>
                {cancellationState.adminApproved || cancellationState.evaluatorApproved
                  ? 'A aprovação já foi registrada e o cancelamento está concluído.'
                  : `Aguardando aprovação de gerente ou avaliador. Apenas uma aprovação é necessária.`}
              </span>
            </div>
          )}

          {!isEditing && (
            <div className="voucher-toggle-section">
              <label className="voucher-toggle-label" htmlFor="isVoucher">
                <div>
                  <strong>Voucher</strong>
                  <small>
                    Quando ativado, os campos obrigatórios são: nome do vendedor, placa e ano do veículo. Requer aprovação do gerente.
                  </small>
                </div>
                <button
                  type="button"
                  id="isVoucher"
                  name="isVoucher"
                  className={`toggle-switch ${isVoucherMode ? 'is-on' : 'is-off'}`}
                  onClick={() => handleChange({
                    target: { name: 'isVoucher', type: 'checkbox', checked: !isVoucherMode },
                  })}
                  role="switch"
                  aria-checked={isVoucherMode}
                >
                  <span className="toggle-knob" />
                </button>
              </label>
            </div>
          )}

          {isEditing && appointment?.isEncaixe && (
            <div className="auth-message encaixe">
              <strong>🔀 Este é um encaixe.</strong>
              <span>Agendamento inserido pelo gerente em horário que já possuía outro carro. Criado por: {appointment.encaixeCreatedBy ?? 'gerência'}.</span>
            </div>
          )}

          {isEditing && appointment?.rescheduledCount > 0 && (
            <div className="auth-message info">
              <strong>Reagendado {appointment.rescheduledCount} vez(es).</strong>
              {appointment.originalAppointmentDate && (
                <span>
                  Data original: {appointment.originalAppointmentDate}
                  {appointment.originalAppointmentTime ? ` às ${appointment.originalAppointmentTime}` : ''}
                </span>
              )}
            </div>
          )}

          {isEditing && appointment?.laudoFileUrl && (
            <div className="auth-message info">
              <strong>Arquivo do laudo.</strong>
              <span>
                <a
                  href={appointment.laudoFileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ghost-link inline-link"
                >
                  {appointment.laudoFileName || 'Abrir arquivo do laudo'}
                </a>
              </span>
            </div>
          )}

          {!formValues ? (
            <div className="info-panel compact" style={{ marginTop: '24px' }}>
              <div className="skeleton-grid" style={{ gridTemplateColumns: '1fr 1fr', rowGap: '14px', columnGap: '18px' }}>
                {Array.from({ length: 8 }).map((_, idx) => (
                  <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div className="skeleton skeleton-line w-40" />
                    <div className="skeleton skeleton-input" style={{ height: '42px', borderRadius: '10px' }} />
                  </div>
                ))}
              </div>
            </div>
          ) : (
          <form className="modal-form" onSubmit={handleSubmit}>
            <div className="modal-grid">
              {!isVoucherMode && (
                <label>
                  Nome do cliente
                  <input
                    name="customerName"
                    value={formValues.customerName}
                    onChange={handleChange}
                    required
                  />
                </label>
              )}

              {!isVoucherMode && (
                <label>
                  Telefone
                  <input
                    name="customerPhone"
                    value={formValues.customerPhone}
                    onChange={handleChange}
                    placeholder="(61) 99999-9999"
                    required
                  />
                </label>
              )}

              <label>
                Vendedor
                <select
                  name="sellerSelect"
                  value={sellerSelectValue}
                  onChange={handleChange}
                  disabled={isSellerRole || isLoadingSellers}
                  required
                >
                  <option value="">
                    {isLoadingSellers
                      ? 'Carregando lista de vendedores...'
                      : sellers.length === 0
                        ? 'Nenhum vendedor ativo encontrado para a loja'
                        : isSellerRole
                          ? 'Selecionado automaticamente (você é o vendedor)'
                          : 'Selecione o vendedor responsável'}
                  </option>
                  {(sellers || []).map((seller) => (
                    <option key={seller.id} value={seller.id}>
                      {String(seller.fullName || '').trim()} - {String(seller.email || '').trim()}
                    </option>
                  ))}
                </select>
                {isSellerRole && (
                  <small className="helper-text-inline">
                    Como vendedor, seus agendamentos são sempre vinculados automaticamente ao seu login.
                  </small>
                )}
                {!isSellerRole && (
                  <small className="helper-text-inline">
                    Escolha um vendedor APROVADO da loja. Esta informação garante que o horário aparece no login do vendedor correto.
                  </small>
                )}
                {formValues.sellerEmail && (
                  <small className="helper-text-inline" style={{ color: '#15803d' }}>
                    ⚙️ Email do vendedor: <strong>{String(formValues.sellerEmail).trim()}</strong>
                  </small>
                )}
              </label>

              <label className="plate-label">
                Placa
                <input
                  name="vehiclePlate"
                  className="plate-input"
                  value={formValues.vehiclePlate}
                  onChange={handleChange}
                  placeholder="ABC1D23"
                  maxLength={7}
                  required
                />
                <small className="helper-text-inline">Padrão Brasil: antigo (AAA1111) ou Mercosul (ABC0A00).</small>
              </label>

              {!isVoucherMode && (
                <label>
                  Modelo do veículo
                  <input
                    name="vehicleModel"
                    value={formValues.vehicleModel}
                    onChange={handleChange}
                    required
                  />
                </label>
              )}

              <label>
                Ano
                <input
                  name="vehicleYear"
                  type="number"
                  min="1900"
                  max="2100"
                  value={formValues.vehicleYear}
                  onChange={handleChange}
                  required
                />
              </label>

              {!isVoucherMode && (
                <label>
                  CPF
                  <input name="customerCpf" value={formValues.customerCpf} onChange={handleChange} />
                </label>
              )}

              {!isVoucherMode && (
                <label>
                  CEP
                  <input
                    name="customerZipCode"
                    value={formValues.customerZipCode}
                    onChange={handleChange}
                    onBlur={handleCepBlur}
                    placeholder="00000-000"
                  />
                </label>
              )}

              {!isVoucherMode && (
                <label>
                  E-mail
                  <input name="customerEmail" type="email" value={formValues.customerEmail} onChange={handleChange} />
                </label>
              )}

              {!isVoucherMode && (
                <label className="modal-grid-full">
                  Endereço completo
                  <input name="customerAddress" value={formValues.customerAddress} onChange={handleChange} />
                  {isLoadingCep && <small>Buscando endereço pelo CEP...</small>}
                </label>
              )}

              <label className="modal-grid-full">
                Observações
                <textarea name="notes" rows="4" value={formValues.notes} onChange={handleChange} />
              </label>

              {isEditing && slotDetails.slot.appointment?.status === 'scheduled' && !cancellationPending && (
                <label className="modal-grid-full">
                  Motivo do cancelamento
                  <textarea
                    name="cancellationRequestReason"
                    rows="3"
                    value={formValues.cancellationRequestReason}
                    onChange={handleChange}
                    placeholder={
                      isSellerRole
                        ? 'Explique o motivo. Lembre-se: avise o gerente ou avaliador antes para que eles aprovem rapidamente. Apenas uma aprovação é necessária.'
                        : 'Informe o motivo do cancelamento.'
                    }
                  />
                  {isSellerRole && (
                    <small className="helper-text-inline">
                      ⚠️ Antes de solicitar, avise pessoalmente o gerente ou avaliador para que a aprovação seja rápida.
                    </small>
                  )}
                </label>
              )}
            </div>

            <footer className="modal-actions">
              <div className="modal-secondary-actions">
                {isEditing && slotDetails.slot.appointment?.status === 'scheduled' && canFinalize && (
                  <>
                    <button type="button" className="ghost-button warning" onClick={() => setShowFinalizeModal(true)} disabled={isSubmitting}>
                      ✅ Finalizar laudo
                    </button>
                    <button type="button" className="ghost-button" onClick={() => setShowRescheduleModal(true)} disabled={isSubmitting}>
                      🔄 Reagendar
                    </button>
                  </>
                )}
                {isEditing && slotDetails.slot.appointment?.status === 'scheduled' && isSellerRole && !cancellationPending && (
                  <button type="button" className="ghost-button" onClick={() => setShowRescheduleModal(true)} disabled={isSubmitting}>
                    🔄 Reagendar
                  </button>
                )}
                {isEditing && isVoucherPending && canApproveVoucher && (
                  <button type="button" className="ghost-button success" onClick={handleApproveVoucher} disabled={isSubmitting}>
                    ✔️ Aprovar voucher
                  </button>
                )}
                {isEditing && slotDetails.slot.appointment?.status === 'scheduled' && !cancellationPending && !isSellerRole && (
                  <button type="button" className="ghost-button danger" onClick={handleCancelAppointment} disabled={isSubmitting}>
                    🚫 Cancelar horário
                  </button>
                )}
                {isEditing && slotDetails.slot.appointment?.status === 'scheduled' && isSellerRole && !cancellationPending && (
                  <button type="button" className="ghost-button warning" onClick={handleRequestCancellation} disabled={isSubmitting}>
                    📤 Solicitar cancelamento
                  </button>
                )}
                {isEditing && cancellationPending && ((isManager && !cancellationState.adminApproved) || (isEvaluator && !cancellationState.evaluatorApproved)) && (
                  <button type="button" className="ghost-button warning" onClick={handleApproveCancellation} disabled={isSubmitting}>
                    ✔️ Aprovar cancelamento ({getRoleLabel()})
                  </button>
                )}
                {isEditing && canDelete && (
                  <button type="button" className="ghost-button danger" onClick={handleDelete} disabled={isSubmitting}>
                    🗑️ Excluir
                  </button>
                )}
              </div>

              <div className="modal-primary-actions">
                <button type="button" className="ghost-button" onClick={onClose} disabled={isSubmitting}>
                  Fechar
                </button>
                {!isEditing || (slotDetails.slot.appointment?.status === 'scheduled') ? (
                  <button type="submit" className="primary-button" disabled={isSubmitting}>
                    {isSubmitting
                      ? '⏳ Salvando…'
                      : isEditing
                        ? '💾 Salvar alterações'
                        : isEncaixeMode
                          ? '🔀 Criar encaixe'
                          : '✅ Agendar'}
                  </button>
                ) : null}
              </div>
            </footer>

            <div className="feedback-sticky-footer" ref={feedbackFooterRef}>
              {successMessage && (
                <div className="auth-message success-inline visible-hint">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%' }}>
                    <span style={{ fontSize: '22px', lineHeight: 1, flexShrink: 0 }}>✅</span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1 }}>
                      <strong style={{ color: 'rgb(22,101,52)' }}>Operação concluída com sucesso.</strong>
                      <span style={{ color: 'rgb(22,101,52)', fontSize: '14px', fontWeight: 500 }}>
                        {successMessage}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {!successMessage && localError && (
                <div className="auth-message error visible-hint">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%' }}>
                    <div>
                      <strong>
                        {(typeof localError === 'string' &&
                          (localError.includes('Este horário acabou de ser ocupado') ||
                            localError.toLowerCase().includes('horário ocupado')))
                          ? '⏱️ Horário acabou de ser reservado.'
                          : 'Erro no agendamento.'}
                      </strong>
                      <span>{localError}</span>
                    </div>

                    {typeof localError === 'string' &&
                      (localError.includes('Este horário acabou de ser ocupado') ||
                        localError.toLowerCase().includes('horário ocupado')) && (
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '2px' }}>
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={async () => {
                              try {
                                setLocalError('Atualizando a agenda em tempo real…');
                                await onForceRefresh?.({ force: true });
                              } finally {
                                onClose();
                              }
                            }}
                          >
                            🔄 Atualizar agenda agora
                          </button>
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => {
                              setLocalError('');
                            }}
                          >
                            Tentar novamente neste slot
                          </button>
                        </div>
                      )}
                  </div>
                </div>
              )}
            </div>
          </form>
          )}
        </section>
      </div>
      )}

      {isOpen && showRescheduleModal && appointment && (
        <RescheduleModal
          appointment={appointment}
          onClose={() => setShowRescheduleModal(false)}
          onConfirm={handleReschedule}
          isSubmitting={isSubmitting}
        />
      )}

      {isOpen && showFinalizeModal && appointment && (
        <FinalizeModal
          appointment={appointment}
          onClose={() => setShowFinalizeModal(false)}
          onConfirm={handleFinalize}
          isSubmitting={isSubmitting}
          companyId={currentUser?.companyId}
        />
      )}
    </>
  );
}
