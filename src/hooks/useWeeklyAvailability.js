import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  approveCancellationRequest,
  approveVoucher,
  cancelAppointment,
  createAppointment,
  deleteAppointment,
  finalizeAppointment,
  getAppointmentsByWeek,
  mapAppointmentRecord,
  requestCancellationApproval,
  rescheduleAppointment,
  updateAppointment,
} from '../services/appointmentsService';
import { hasSupabaseCredentials, supabase } from '../lib/supabase';
import { mockAppointments } from '../utils/mockAppointments';
import {
  getBoardSlotStatus,
  isCancellationPending,
  isExpiredAvailableSlot,
} from '../utils/appointmentStatus';
import {
  buildScheduleWeek,
  formatWeekRangeLabel,
  getWeekContextLabel,
  isNextWeekUnlocked,
  normalizeScheduleConfig,
} from '../utils/scheduleConfig';

const REALTIME_CHANNEL_NAME = 'appointments-week-board';
const POLLING_FALLBACK_MS = 3 * 1000;
const STALE_FETCH_THROTTLE_MS = 1200;
const SAME_ERROR_SUPPRESS_MS = 90 * 1000;
const MUTATION_TIMEOUT_MS = 30 * 1000;

function withMutationTimeout(promise, timeoutMs = MUTATION_TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      const timer = window.setTimeout(() => {
        window.clearTimeout(timer);
        reject(new Error('A operação demorou mais de 30 segundos para responder. Verifique sua internet e tente novamente.'));
      }, timeoutMs);
    }),
  ]);
}

function normalizeAppointmentInWeekRange(rawItem) {
  if (!rawItem) return null;
  const needsMap = typeof rawItem.appointmentDate !== 'string' || typeof rawItem.customerName !== 'string';
  const mapped = needsMap ? mapAppointmentRecord(rawItem) : rawItem;
  if (!mapped) return null;
  if (typeof mapped.time !== 'string' && typeof mapped.appointmentTime === 'string') {
    mapped.time = String(mapped.appointmentTime).slice(0, 5);
  }
  if (!mapped.time && typeof mapped.appointment_time === 'string') {
    mapped.time = String(mapped.appointment_time).slice(0, 5);
  }
  return mapped;
}

export function useWeeklyAvailability(currentUser, scheduleConfig, options = {}) {
  const weekOffset = options.weekOffset ?? 0;
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const normalizedScheduleConfig = useMemo(
    () => normalizeScheduleConfig(scheduleConfig),
    [scheduleConfig],
  );
  const weekDays = useMemo(
    () => buildScheduleWeek(currentDate, normalizedScheduleConfig.businessDays, weekOffset),
    [currentDate, normalizedScheduleConfig.businessDays, weekOffset],
  );
  const [history, setHistory] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState('');
  const [source, setSource] = useState('mock');
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [realtimeStatus, setRealtimeStatus] = useState('connecting');
  const [realtimeEventsCount, setRealtimeEventsCount] = useState(0);

  const lastFetchAtRef = useRef(0);
  const lastRefreshFromRealtimeRef = useRef(0);
  const pollingIntervalRef = useRef(null);
  const realtimeChannelRef = useRef(null);
  const realtimeGenerationRef = useRef(0);
  const lastSeenErrorRef = useRef('');
  const lastSeenErrorAtRef = useRef(0);
  const weekDaysRef = useRef(weekDays);
  const loadAppointmentsRef = useRef(null);

  useEffect(() => {
    weekDaysRef.current = weekDays;
  }, [weekDays]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setCurrentDate(new Date());
    }, 60 * 1000);

    return () => window.clearInterval(intervalId);
  }, []);

  const loadAppointments = useCallback(async ({ silent = false, dedupeError = false, force = false } = {}) => {
    const now = Date.now();
    if (!force && !silent) {
      // nada, sempre executa primeiro load e mutações.
    }
    if (!force && now - lastFetchAtRef.current < 300) {
      return;
    }
    lastFetchAtRef.current = now;

    if (!silent) setIsLoading(true);
    const previousError = lastSeenErrorRef.current;
    const activeWeekDays = weekDaysRef.current;

    try {
      const response = await getAppointmentsByWeek(activeWeekDays);
      const items = Array.isArray(response.items) ? response.items.map(item => ({
        ...item,
        time: item.time ?? String(item.appointmentTime ?? '').slice(0, 5) ?? '',
      })) : [];
      setHistory(items);
      setSource(response.source);
      setLastSyncedAt(new Date());
      lastSeenErrorRef.current = '';
      lastSeenErrorAtRef.current = 0;
      if (!silent && previousError) {
        setError('');
      }
    } catch (serviceError) {
      const rawMessage = serviceError.message ?? 'Não foi possível carregar os agendamentos da semana.';
      const isPermissionError = (
        rawMessage.includes('Permissão temporariamente indisponível') ||
        rawMessage.includes('permissão') ||
        rawMessage.includes('42501') ||
        rawMessage.toLowerCase().includes('permission')
      );
      const nowMs = Date.now();
      const sameAsLast = (
        lastSeenErrorRef.current === rawMessage &&
        (nowMs - lastSeenErrorAtRef.current) < SAME_ERROR_SUPPRESS_MS
      );
      if (!dedupeError || !sameAsLast) {
        lastSeenErrorRef.current = rawMessage;
        lastSeenErrorAtRef.current = nowMs;
        if (!silent) {
          if (isPermissionError) {
            setHistory(mockAppointments);
            setSource('mock');
          } else {
            setHistory([]);
          }
          setError(rawMessage);
        } else if (isPermissionError && history.length === 0) {
          setHistory(mockAppointments);
          setSource('mock');
        }
      }
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [history.length]);

  useEffect(() => {
    loadAppointmentsRef.current = loadAppointments;
  }, [loadAppointments]);

  useEffect(() => {
    loadAppointments();
  }, [loadAppointments]);

  const insertOrReplaceItemLocally = useCallback((rawItem) => {
    const normalized = normalizeAppointmentInWeekRange(rawItem);
    if (!normalized) return false;
    const itemWithTime = {
      ...normalized,
      time: normalized.time ?? String(normalized.appointmentTime ?? '').slice(0, 5) ?? '',
    };
    const appointmentDate = itemWithTime.appointmentDate;
    const activeWeekDays = weekDaysRef.current;
    if (!appointmentDate || !Array.isArray(activeWeekDays) || activeWeekDays.length === 0) {
      return false;
    }
    const inWeek = activeWeekDays.some(day => day.id === appointmentDate);
    if (!inWeek) return false;

    setHistory((current) => {
      const existsIndex = current.findIndex((item) => item.id === itemWithTime.id);
      if (existsIndex >= 0) {
        const next = current.slice();
        next[existsIndex] = { ...current[existsIndex], ...itemWithTime };
        return next;
      }
      return [...current, itemWithTime];
    });
    return true;
  }, []);

  const removeItemLocally = useCallback((appointmentId) => {
    if (!appointmentId) return false;
    setHistory((current) => {
      const filtered = current.filter((item) => item.id !== appointmentId);
      if (filtered.length === current.length) return current;
      return filtered;
    });
    return true;
  }, []);

  useEffect(() => {
    const companyId = currentUser?.companyId ?? null;
    const userId = currentUser?.id ?? null;
    if (!hasSupabaseCredentials || !supabase || !userId) {
      setRealtimeStatus('disabled');
      return undefined;
    }

    const generation = ++realtimeGenerationRef.current;
    setRealtimeStatus('connecting');

    function refreshIfStale() {
      const now = Date.now();
      if (now - lastRefreshFromRealtimeRef.current < STALE_FETCH_THROTTLE_MS) {
        return;
      }
      lastRefreshFromRealtimeRef.current = now;
      loadAppointmentsRef.current?.({ silent: true, dedupeError: true });
    }

    pollingIntervalRef.current = window.setInterval(() => {
      refreshIfStale();
    }, POLLING_FALLBACK_MS);

    let channel;
    try {
      const filters = { event: '*', schema: 'public', table: 'appointments' };
      if (companyId && typeof companyId === 'string' && companyId.length > 0) {
        filters.filter = `company_id=eq.${companyId}`;
      }

      channel = supabase
        .channel(`${REALTIME_CHANNEL_NAME}#${generation}`, {
          config: {
            broadcast: { ack: false, self: true },
            presence: { key: '' },
            private: false,
          },
        })
        .on('postgres_changes', filters, (payload) => {
          if (realtimeGenerationRef.current !== generation) return;
          try {
            const eventType = String(payload?.eventType ?? '').toUpperCase();
            const record = payload?.new ?? payload?.record ?? null;
            const oldRecord = payload?.old ?? payload?.previous ?? null;

            if (eventType === 'INSERT' && record) {
              const applied = insertOrReplaceItemLocally(record);
              if (!applied) refreshIfStale();
              else setLastSyncedAt(new Date());
              setRealtimeEventsCount((c) => c + 1);
              return;
            }

            if (eventType === 'UPDATE' && record) {
              const applied = insertOrReplaceItemLocally(record);
              if (!applied) refreshIfStale();
              else setLastSyncedAt(new Date());
              setRealtimeEventsCount((c) => c + 1);
              return;
            }

            if (eventType === 'DELETE') {
              const idToRemove = oldRecord?.id ?? record?.id ?? payload?.id ?? null;
              const removed = removeItemLocally(idToRemove);
              if (!removed) refreshIfStale();
              else setLastSyncedAt(new Date());
              setRealtimeEventsCount((c) => c + 1);
              return;
            }
          } catch (applyErr) {
            console.warn('[Realtime appointments] apply otimista falhou, recaindo em fetch:', applyErr?.message ?? applyErr);
          }
          refreshIfStale();
        })
        .subscribe((status, err) => {
          if (realtimeGenerationRef.current !== generation) return;
          if (status === 'SUBSCRIBED') {
            setRealtimeStatus('live');
          } else if (status === 'CHANNEL_ERROR' || status === 'CLOSED' || status === 'TIMED_OUT') {
            setRealtimeStatus('reconnecting');
            if (err) {
              console.warn('[Realtime appointments] subscription falhou (polling fallback continua ativo):', err?.message ?? status);
            } else {
              console.warn('[Realtime appointments] subscription:', status);
            }
          } else if (status === 'JOINING') {
            setRealtimeStatus('connecting');
          }
        });
      realtimeChannelRef.current = channel;
    } catch (channelErr) {
      setRealtimeStatus('error');
      console.warn('[Realtime appointments] falha ao montar subscription (polling fallback continua ativo):', channelErr?.message ?? channelErr);
    }

    return () => {
      if (pollingIntervalRef.current) {
        window.clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      if (channel && typeof supabase.removeChannel === 'function') {
        supabase.removeChannel(channel).catch((removeErr) => {
          console.warn('[Realtime appointments] erro ao remover channel no cleanup:', removeErr?.message ?? removeErr);
        });
      }
      if (realtimeChannelRef.current === channel) {
        realtimeChannelRef.current = null;
      }
    };
  }, [currentUser?.companyId, currentUser?.id, insertOrReplaceItemLocally, removeItemLocally]);

  const submitAppointment = useCallback(async ({ appointmentId, values }) => {
    setIsMutating(true);
    setError('');

    const payload = {
      ...values,
      companyId: currentUser?.companyId,
      createdBy: currentUser?.id,
      sellerEmail: values.sellerEmail ?? currentUser?.email ?? null,
    };

    try {
      const result = await withMutationTimeout((async () => {
        if (appointmentId) {
          const r = await updateAppointment(appointmentId, payload);
          insertOrReplaceItemLocally(r);
          return r;
        }
        const r = await createAppointment(payload);
        insertOrReplaceItemLocally(r);
        return r;
      })());
      await withMutationTimeout(loadAppointments({ silent: true, dedupeError: true }), MUTATION_TIMEOUT_MS);
      return { success: true };
    } catch (serviceError) {
      const message = serviceError.message ?? 'Não foi possível salvar o agendamento.';
      setError(message);
      return { success: false, error: message };
    } finally {
      try { setIsMutating(false); } catch (_e) { /* noop */ }
    }
  }, [currentUser?.companyId, currentUser?.id, currentUser?.email, insertOrReplaceItemLocally, loadAppointments]);

  const markAsCancelled = useCallback(async (appointmentId) => {
    setIsMutating(true);
    setError('');

    try {
      const result = await withMutationTimeout(cancelAppointment(appointmentId, currentUser));
      insertOrReplaceItemLocally(result);
      await withMutationTimeout(loadAppointments({ silent: true, dedupeError: true }), MUTATION_TIMEOUT_MS);
      return { success: true };
    } catch (serviceError) {
      const message = serviceError.message ?? 'Não foi possível cancelar o agendamento.';
      setError(message);
      return { success: false, error: message };
    } finally {
      try { setIsMutating(false); } catch (_e) { /* noop */ }
    }
  }, [currentUser, insertOrReplaceItemLocally, loadAppointments]);

  const removeAppointment = useCallback(async (appointmentId) => {
    setIsMutating(true);
    setError('');

    try {
      await withMutationTimeout(deleteAppointment(appointmentId, currentUser));
      removeItemLocally(appointmentId);
      await withMutationTimeout(loadAppointments({ silent: true, dedupeError: true }), MUTATION_TIMEOUT_MS);
      return { success: true };
    } catch (serviceError) {
      const message = serviceError.message ?? 'Não foi possível excluir o agendamento.';
      setError(message);
      return { success: false, error: message };
    } finally {
      try { setIsMutating(false); } catch (_e) { /* noop */ }
    }
  }, [currentUser, insertOrReplaceItemLocally, loadAppointments, removeItemLocally]);

  const requestCancellation = useCallback(async (appointmentId, reason = '') => {
    setIsMutating(true);
    setError('');

    try {
      const result = await withMutationTimeout(requestCancellationApproval(appointmentId, currentUser, reason));
      insertOrReplaceItemLocally(result);
      await withMutationTimeout(loadAppointments({ silent: true, dedupeError: true }), MUTATION_TIMEOUT_MS);
      return { success: true };
    } catch (serviceError) {
      const message = serviceError.message ?? 'Não foi possível solicitar o cancelamento.';
      setError(message);
      return { success: false, error: message };
    } finally {
      try { setIsMutating(false); } catch (_e) { /* noop */ }
    }
  }, [currentUser, insertOrReplaceItemLocally, loadAppointments]);

  const approveCancellation = useCallback(async (appointmentId) => {
    setIsMutating(true);
    setError('');

    try {
      const result = await withMutationTimeout(approveCancellationRequest(appointmentId, currentUser));
      insertOrReplaceItemLocally(result);
      await withMutationTimeout(loadAppointments({ silent: true, dedupeError: true }), MUTATION_TIMEOUT_MS);
      return { success: true };
    } catch (serviceError) {
      const message = serviceError.message ?? 'Não foi possível aprovar o cancelamento.';
      setError(message);
      return { success: false, error: message };
    } finally {
      try { setIsMutating(false); } catch (_e) { /* noop */ }
    }
  }, [currentUser, insertOrReplaceItemLocally, loadAppointments]);

  const markAsFinalized = useCallback(async (appointmentId, finalizePayload) => {
    setIsMutating(true);
    setError('');

    try {
      const result = await withMutationTimeout(finalizeAppointment(appointmentId, currentUser, finalizePayload));
      insertOrReplaceItemLocally(result);
      await withMutationTimeout(loadAppointments({ silent: true, dedupeError: true }), MUTATION_TIMEOUT_MS);
      return { success: true };
    } catch (serviceError) {
      const message = serviceError.message ?? 'Não foi possível finalizar o agendamento.';
      setError(message);
      return { success: false, error: message };
    } finally {
      try { setIsMutating(false); } catch (_e) { /* noop */ }
    }
  }, [currentUser, insertOrReplaceItemLocally, loadAppointments]);

  const approveVoucherForAppointment = useCallback(async (appointmentId) => {
    setIsMutating(true);
    setError('');

    try {
      const result = await withMutationTimeout(approveVoucher(appointmentId, currentUser));
      insertOrReplaceItemLocally(result);
      await withMutationTimeout(loadAppointments({ silent: true, dedupeError: true }), MUTATION_TIMEOUT_MS);
      return { success: true };
    } catch (serviceError) {
      const message = serviceError.message ?? 'Não foi possível aprovar o voucher.';
      setError(message);
      return { success: false, error: message };
    } finally {
      try { setIsMutating(false); } catch (_e) { /* noop */ }
    }
  }, [currentUser, insertOrReplaceItemLocally, loadAppointments]);

  const rescheduleExistingAppointment = useCallback(async (appointmentId, payload) => {
    setIsMutating(true);
    setError('');

    try {
      const result = await withMutationTimeout(rescheduleAppointment(
        appointmentId,
        payload.newDate,
        payload.newTime,
        { notes: payload.notes },
      ));
      insertOrReplaceItemLocally(result);
      await withMutationTimeout(loadAppointments({ silent: true, dedupeError: true }), MUTATION_TIMEOUT_MS);
      return { success: true };
    } catch (serviceError) {
      const message = serviceError.message ?? 'Não foi possível reagendar o agendamento.';
      setError(message);
      return { success: false, error: message };
    } finally {
      try { setIsMutating(false); } catch (_e) { /* noop */ }
    }
  }, [insertOrReplaceItemLocally, loadAppointments]);

  const board = useMemo(() => weekDays.map((day) => ({
    ...day,
    slots: normalizedScheduleConfig.timeSlots.map((time) => {
      const appointments = history.filter((item) => {
        const sameDay = item.appointmentDate === day.id;
        return sameDay && item.time === time && item.status !== 'cancelled';
      });

      const primaryAppointment = appointments[0] ?? null;
      const hasMultiple = appointments.length > 1;

      const slotStatus = primaryAppointment
        ? (() => {
            const hasScheduled = appointments.some(a => getBoardSlotStatus(a) === 'occupied');
            const hasPending = appointments.some(a => getBoardSlotStatus(a) === 'pending');
            const hasFinalized = appointments.some(a => getBoardSlotStatus(a) === 'finalized');
            if (hasPending) return 'pending';
            if (hasScheduled) return 'occupied';
            if (hasFinalized) return 'finalized';
            return getBoardSlotStatus(primaryAppointment);
          })()
        : isExpiredAvailableSlot(day.id, time, currentDate)
          ? 'expired'
          : 'available';

      return {
        time,
        status: slotStatus,
        appointment: primaryAppointment,
        appointments,
        appointmentCount: appointments.length,
        hasMultiple,
      };
    }),
  })), [currentDate, history, normalizedScheduleConfig.timeSlots, weekDays]);

  const summary = useMemo(() => {
    const totalSlots = weekDays.length * normalizedScheduleConfig.timeSlots.length;
    const occupied = history.filter((item) => item.status === 'scheduled' && !isCancellationPending(item)).length;
    const pending = history.filter((item) => isCancellationPending(item)).length;
    const finalized = history.filter((item) => item.status === 'completed').length;
    const cancelled = history.filter((item) => item.status === 'cancelled').length;
    const expired = board.reduce(
      (total, day) => total + day.slots.filter((slot) => slot.status === 'expired').length,
      0,
    );
    const available = totalSlots - occupied - pending - finalized - expired;

    return { totalSlots, available, occupied, pending, finalized, cancelled, expired };
  }, [board, history, normalizedScheduleConfig.timeSlots.length, weekDays.length]);

  return {
    board,
    canViewNextWeek: isNextWeekUnlocked(currentDate),
    currentDate,
    error,
    history,
    isLoading,
    isMutating,
    lastSyncedAt,
    realtimeStatus,
    realtimeEventsCount,
    refreshWeek: loadAppointments,
    saveAppointment: submitAppointment,
    requestAppointmentCancellation: requestCancellation,
    approveAppointmentCancellation: approveCancellation,
    cancelExistingAppointment: markAsCancelled,
    deleteExistingAppointment: removeAppointment,
    finalizeExistingAppointment: markAsFinalized,
    approveVoucherForAppointment,
    rescheduleExistingAppointment,
    source,
    summary,
    weekContextLabel: getWeekContextLabel(weekOffset),
    weekDays,
    weekRangeLabel: formatWeekRangeLabel(weekDays),
  };
}
