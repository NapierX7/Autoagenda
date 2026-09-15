import { useEffect, useMemo, useState } from 'react';
import AppointmentModal from '../components/appointments/AppointmentModal';
import WeeklySchedulePreview from '../components/dashboard/WeeklySchedulePreview';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useCompanySettings } from '../hooks/useCompanySettings';
import { useWeeklyAvailability } from '../hooks/useWeeklyAvailability';
import { countVisibleSlots, filterBoard } from '../utils/appointmentFilters';
import { getWeekScopeDescription } from '../utils/scheduleConfig';

export default function AgendaPage() {
  const { currentUser, isManager, isEvaluator, signOut } = useAuth();
  const { showToast } = useToast();
  const { settings } = useCompanySettings(currentUser);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [isEncaixeMode, setIsEncaixeMode] = useState(false);
  const canMakeEncaixe = isManager || isEvaluator;
  const [weekOffset, setWeekOffset] = useState(0);
  const [filters, setFilters] = useState({
    status: 'all',
    vehiclePlate: '',
    sellerName: '',
  });
  const {
    board,
    canViewNextWeek,
    error,
    isLoading,
    isMutating,
    lastSyncedAt,
    realtimeStatus,
    realtimeEventsCount,
    refreshWeek,
    source,
    saveAppointment,
    requestAppointmentCancellation,
    approveAppointmentCancellation,
    cancelExistingAppointment,
    deleteExistingAppointment,
    finalizeExistingAppointment,
    approveVoucherForAppointment,
    rescheduleExistingAppointment,
    weekContextLabel,
    weekRangeLabel,
  } = useWeeklyAvailability(currentUser, settings.scheduleConfig, { weekOffset });

  const filteredBoard = useMemo(() => filterBoard(board, filters), [board, filters]);
  const visibleSlots = useMemo(() => countVisibleSlots(filteredBoard), [filteredBoard]);
  const hasActiveFilters = filters.status !== 'all' || filters.vehiclePlate || filters.sellerName;
  const canAccessFutureWeek = canViewNextWeek;

  useEffect(() => {
    if (!canAccessFutureWeek && weekOffset !== 0) {
      setWeekOffset(0);
    }
  }, [canAccessFutureWeek, weekOffset]);

  useEffect(() => {
    setSelectedSlot(null);
    setIsEncaixeMode(false);
  }, [weekOffset]);

  function handleEncaixeSelect(originalSlot) {
    const sameDayDifferentSlot = {
      day: originalSlot.day,
      slot: {
        time: originalSlot.slot.time,
        status: 'available',
        appointment: null,
      },
    };
    setIsEncaixeMode(true);
    setSelectedSlot(sameDayDifferentSlot);
  }

  function handleFilterChange(event) {
    const { name, value } = event.target;
    setFilters((current) => ({
      ...current,
      [name]: value,
    }));
  }

  function clearFilters() {
    setFilters({
      status: 'all',
      vehiclePlate: '',
      sellerName: '',
    });
  }

  function buildAvailabilityShareText() {
    return board
      .map((day) => {
        const lines = day.slots.map((slot) => {
          if (slot.status === 'available') {
            return `${slot.time} ✅ Disponível`;
          }

          if (slot.status === 'expired') {
            return `${slot.time} ⛔ Indisponível`;
          }

          return `${slot.time} ❌ Ocupado`;
        });

        return [`${day.fullDate} - ${day.label}`, ...lines].join('\n');
      })
      .join('\n\n');
  }

  async function handleShareAvailability() {
    try {
      await navigator.clipboard.writeText(buildAvailabilityShareText());
      showToast({
        title: 'Disponibilidade copiada',
        message: 'A lista de horários foi copiada para você compartilhar com o cliente.',
        tone: 'success',
      });
    } catch (error) {
      showToast({
        title: 'Falha ao copiar',
        message: 'Não foi possível copiar a disponibilidade agora.',
        tone: 'error',
      });
    }
  }

  async function handleSave(payload) {
    const valuesWithEncaixe = payload.values ?? {};
    if (isEncaixeMode && !payload.appointmentId) {
      valuesWithEncaixe.isEncaixe = true;
    }
    const finalPayload = { ...payload, values: valuesWithEncaixe };

    const response = await saveAppointment(finalPayload);

    if (response.success) {
      showToast({
        title: payload.appointmentId ? 'Agendamento atualizado' : isEncaixeMode ? 'Encaixe criado' : 'Horário reservado',
        message: payload.appointmentId
          ? 'Os dados do laudo foram atualizados com sucesso.'
          : isEncaixeMode
            ? 'Encaixe inserido! Ele aparece junto com o agendamento original no mesmo horário.'
            : payload.values?.isVoucher
              ? 'Voucher criado. Lembre-se: a aprovação precisa ser feita pelo gerente através do login dele.'
              : 'O novo agendamento entrou na agenda da semana.',
        tone: 'success',
      });
    } else {
      showToast({
        title: 'Falha ao salvar',
        message: response.error ?? 'Não foi possível salvar o agendamento.',
        tone: 'error',
      });
    }

    return response;
  }

  async function handleCancelAppointment(appointmentId) {
    const response = await cancelExistingAppointment(appointmentId);

    if (response.success) {
      showToast({
        title: 'Horário liberado',
        message: 'O agendamento foi cancelado e o slot voltou a ficar disponível.',
        tone: 'warning',
      });
    } else {
      showToast({
        title: 'Falha ao cancelar',
        message: response.error ?? 'Não foi possível cancelar o agendamento.',
        tone: 'error',
      });
    }

    return response;
  }

  async function handleDeleteAppointment(appointmentId) {
    const response = await deleteExistingAppointment(appointmentId);

    if (response.success) {
      showToast({
        title: 'Agendamento excluído',
        message: 'O agendamento foi removido permanentemente.',
        tone: 'warning',
      });
    } else {
      showToast({
        title: 'Falha ao excluir',
        message: response.error ?? 'Não foi possível excluir o agendamento.',
        tone: 'error',
      });
    }

    return response;
  }

  async function handleRequestCancellation(appointmentId, reason) {
    const response = await requestAppointmentCancellation(appointmentId, reason);

    if (response.success) {
      showToast({
        title: 'Cancelamento solicitado',
        message: 'Solicitação enviada. Apenas uma aprovação é necessária (gerente ou avaliador). Avisar o responsável antes acelera o processo.',
        tone: 'warning',
      });
    } else {
      showToast({
        title: 'Falha ao solicitar',
        message: response.error ?? 'Não foi possível registrar a solicitação de cancelamento.',
        tone: 'error',
      });
    }

    return response;
  }

  async function handleApproveCancellation(appointmentId) {
    const response = await approveAppointmentCancellation(appointmentId);

    if (response.success) {
      showToast({
        title: 'Aprovação registrada',
        message: currentUser.role === 'admin' || currentUser.role === 'evaluator'
          ? 'Sua aprovação já conclui o cancelamento do agendamento.'
          : 'A aprovação foi registrada com sucesso.',
        tone: 'success',
      });
    } else {
      showToast({
        title: 'Falha ao aprovar',
        message: response.error ?? 'Não foi possível aprovar o cancelamento.',
        tone: 'error',
      });
    }

    return response;
  }

  async function handleFinalizeAppointment(appointmentId, finalizePayload) {
    const response = await finalizeExistingAppointment(appointmentId, finalizePayload);

    if (response.success) {
      const resultLabel = finalizePayload.result === 'approved' ? 'Aprovado' : 'Reprovado';
      showToast({
        title: `Laudo ${resultLabel.toLowerCase()}`,
        message: `O laudo foi finalizado como ${resultLabel.toLowerCase()} e está disponível para consulta.`,
        tone: 'success',
      });
    } else {
      showToast({
        title: 'Falha ao finalizar',
        message: response.error ?? 'Não foi possível finalizar o agendamento.',
        tone: 'error',
      });
    }

    return response;
  }

  async function handleApproveVoucher(appointmentId) {
    const response = await approveVoucherForAppointment(appointmentId);

    if (response.success) {
      showToast({
        title: 'Voucher aprovado',
        message: 'O uso do voucher foi aprovado para este agendamento.',
        tone: 'success',
      });
    } else {
      showToast({
        title: 'Falha ao aprovar',
        message: response.error ?? 'Não foi possível aprovar o voucher.',
        tone: 'error',
      });
    }

    return response;
  }

  async function handleRescheduleAppointment(appointmentId, payload) {
    const response = await rescheduleExistingAppointment(appointmentId, payload);

    if (response.success) {
      showToast({
        title: 'Reagendamento confirmado',
        message: `O agendamento foi movido para ${payload.newDate} às ${payload.newTime}.`,
        tone: 'success',
      });
    } else {
      showToast({
        title: 'Falha ao reagendar',
        message: response.error ?? 'Não foi possível reagendar o agendamento.',
        tone: 'error',
      });
    }

    return response;
  }

  return (
    <div className="page-stack">
      <section className="info-panel">
        <span className="section-tag">📅 Agenda operacional</span>
        <h2>Agende, edite ou finalize laudos.</h2>
        <p>Grade unificada em tempo real para toda a equipe.</p>
      </section>

      <section className="info-panel compact">
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
          <span className={`section-tag ${source === 'supabase' ? 'success-tag' : 'warning-tag'}`}>
            {source === 'supabase' ? '✅ Conectado' : '🧪 Modo demo'}
          </span>
          {source === 'supabase' && realtimeStatus && (
            <span
              className={`section-tag sync-status-tag sync-${realtimeStatus}`}
              title={`Status da conexão em tempo real: ${realtimeStatus}. Eventos recebidos nesta sessão: ${realtimeEventsCount ?? 0}.`}
            >
              <span className="sync-pulse" aria-hidden />
              {realtimeStatus === 'live' && `⚡ Ao vivo${realtimeEventsCount ? ` • ${realtimeEventsCount} evento${realtimeEventsCount === 1 ? '' : 's'}` : ''}`}
              {realtimeStatus === 'connecting' && '🔌 Conectando…'}
              {realtimeStatus === 'reconnecting' && '♻️ Reconectando…'}
              {realtimeStatus === 'error' && '⚠️ Offline (polling ativo)'}
              {realtimeStatus === 'disabled' && '⏸️ Realtime desligado'}
            </span>
          )}
          {lastSyncedAt instanceof Date && (
            <span className="section-tag sync-time-tag">
              🛰️ Sincronizado às {lastSyncedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
        </div>
        <div className="inline-actions">
          <p>
            {source === 'supabase'
              ? 'Exibindo agendamentos reais da sua empresa.'
              : 'Dados simulados ativos — conexão real pendente.'}
          </p>
          <button type="button" className="ghost-button" onClick={() => refreshWeek({ force: true })}>
            🔄 Atualizar
          </button>
        </div>
      </section>

      <section className="info-panel compact">
        <div className="section-heading">
          <div>
            <span className="section-tag">{weekContextLabel}</span>
            <h3>
              {weekRangeLabel
                ? `${weekRangeLabel} • ${getWeekScopeDescription(weekOffset)}`
                : getWeekScopeDescription(weekOffset)}
            </h3>
          </div>
        </div>
        <div className="inline-actions">
          <div className="week-switcher">
            <button
              type="button"
              className={`ghost-button ${weekOffset === 0 ? 'is-active' : ''}`}
              onClick={() => setWeekOffset(0)}
            >
              📍 Semana atual
            </button>
            {canAccessFutureWeek && (
              <button
                type="button"
                className={`ghost-button ${weekOffset === 1 ? 'is-active' : ''}`}
                onClick={() => setWeekOffset(1)}
              >
                ➡️ Próxima semana
              </button>
            )}
            <button type="button" className="ghost-button success" onClick={handleShareAvailability}>
              📋 Copiar disponibilidade
            </button>
          </div>
        </div>
        {!canAccessFutureWeek && (
          <p className="helper-text">
            ⏳ Próxima semana liberada automaticamente às sextas-feiras.
          </p>
        )}
      </section>

      <section className="info-panel compact">
        <span className="section-tag">🔍 Filtros rápidos</span>
        <div className="inline-actions">
          <p>
            {hasActiveFilters
              ? <strong>{visibleSlots}</strong>
              : 'Status, placa ou nome do vendedor.'}
            {hasActiveFilters ? ' horários visíveis.' : ''}
          </p>
          {hasActiveFilters && (
            <button type="button" className="ghost-button danger" onClick={clearFilters}>✕ Limpar</button>
          )}
        </div>
        <div className="filters-grid">
          <label>
            Status
            <select name="status" value={filters.status} onChange={handleFilterChange}>
              <option value="all">Todos</option>
              <option value="available">Disponíveis</option>
              <option value="expired">Indisponíveis</option>
              <option value="scheduled">Ocupados</option>
              <option value="pending">Cancelamento pendente</option>
              <option value="completed">Finalizados</option>
            </select>
          </label>

          <label>
            Placa
            <input name="vehiclePlate" value={filters.vehiclePlate} onChange={handleFilterChange} placeholder="ABC1D23" />
          </label>

          <label>
            Vendedor
            <input name="sellerName" value={filters.sellerName} onChange={handleFilterChange} placeholder="Nome do vendedor" />
          </label>
        </div>
      </section>

      {error && (
        <section className="info-panel compact error-panel">
          <span className="section-tag">⚠️ Erro</span>
          <p>{error}</p>
          <div className="inline-actions" style={{ marginTop: '12px' }}>
            <button
              type="button"
              className="ghost-button danger"
              onClick={async () => {
                try { await signOut(); } catch (_err) { /* ignora */ }
                window.location.reload();
              }}
            >
              🚪 Sair agora (limpa sessão)
            </button>
            <button type="button" className="ghost-button" onClick={refreshWeek}>
              🔄 Tentar novamente
            </button>
          </div>
          {source === 'mock' && (
            <p className="helper-text" style={{ marginTop: '8px' }}>
              ℹ️ Exibindo <strong>dados simulados</strong> temporariamente para não interromper o uso.
              Após corrigir a permissão e relogar, os agendamentos reais aparecem automaticamente.
            </p>
          )}
        </section>
      )}

      {isLoading ? (
        <section className="info-panel compact">
          <div className="section-heading">
            <div>
              <span className="section-tag">⏳ Carregando agenda</span>
              <h3>Sincronizando horários e agendamentos…</h3>
            </div>
          </div>
          <div className="skeleton-grid" style={{ marginTop: '16px' }}>
            {Array.from({ length: 5 }).map((_, idx) => (
              <div key={idx} className="skeleton-card">
                <div className="skeleton skeleton-line w-30" />
                <div className="skeleton skeleton-line w-60" />
                <div className="skeleton skeleton-line w-80" />
                <div className="skeleton skeleton-line w-50" />
              </div>
            ))}
          </div>
        </section>
      ) : (
        <>
          {visibleSlots === 0 ? (
            <section className="info-panel compact empty-state">
              <div className="empty-state-visual" aria-hidden>🔍</div>
              <span className="section-tag">Sem resultados</span>
              <h3>Nenhum horário encontrado para os filtros.</h3>
              <p>Ajuste os campos de busca para voltar a visualizar a grade.</p>
            </section>
          ) : (
            <WeeklySchedulePreview
              board={filteredBoard}
              title={`Agenda operacional • ${weekContextLabel.toLowerCase()}`}
              isManager={canMakeEncaixe}
              onSlotSelect={(slot) => {
                setIsEncaixeMode(false);
                setSelectedSlot(slot);
              }}
              onEncaixeSelect={handleEncaixeSelect}
            />
          )}
        </>
      )}

      <AppointmentModal
        isOpen={Boolean(selectedSlot)}
        slotDetails={selectedSlot}
        currentUser={currentUser}
        isSubmitting={isMutating}
        isEncaixeMode={isEncaixeMode}
        onClose={() => {
          setSelectedSlot(null);
          setIsEncaixeMode(false);
        }}
        onSave={handleSave}
        onRequestCancellation={handleRequestCancellation}
        onApproveCancellation={handleApproveCancellation}
        onCancelAppointment={handleCancelAppointment}
        onDeleteAppointment={handleDeleteAppointment}
        onFinalizeAppointment={handleFinalizeAppointment}
        onApproveVoucher={handleApproveVoucher}
        onRescheduleAppointment={handleRescheduleAppointment}
        onForceRefresh={(opts) => refreshWeek(opts)}
      />
    </div>
  );
}
