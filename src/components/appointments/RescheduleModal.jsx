import { useEffect, useMemo, useState } from 'react';
import {
  addDays,
  format,
  isAfter,
  isBefore,
  isSameDay,
  parseISO,
  startOfDay,
} from 'date-fns';
import { normalizeScheduleConfig } from '../../utils/scheduleConfig';
import {
  getAppointmentsByWeek,
  isPastAppointment,
} from '../../services/appointmentsService';

const DEFAULT_CONFIG = {
  businessDays: ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta'],
  timeSlots: ['09:00', '10:00', '11:00', '12:00', '14:00', '15:00', '16:00'],
};

function buildBusinessDays(startDate, businessDays, daysAhead = 28) {
  const dayNameMap = {
    0: 'Domingo',
    1: 'Segunda',
    2: 'Terça',
    3: 'Quarta',
    4: 'Quinta',
    5: 'Sexta',
    6: 'Sábado',
  };

  const result = [];
  let current = startOfDay(new Date(startDate));

  for (let i = 0; i <= daysAhead; i++) {
    const dayName = dayNameMap[current.getDay()];
    if (businessDays.includes(dayName)) {
      const iso = format(current, 'yyyy-MM-dd');
      result.push({
        id: iso,
        date: new Date(current),
        label: dayName,
        fullDate: format(current, 'dd/MM/yyyy'),
      });
    }
    current = addDays(current, 1);
  }

  return result;
}

export default function RescheduleModal({ appointment, onClose, onConfirm, isSubmitting }) {
  const [selectedDayId, setSelectedDayId] = useState('');
  const [selectedTime, setSelectedTime] = useState('');
  const [appointmentsCache, setAppointmentsCache] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [localError, setLocalError] = useState('');
  const [notes, setNotes] = useState('');

  const config = useMemo(() => normalizeScheduleConfig(DEFAULT_CONFIG), []);

  const originalDate = useMemo(() => {
    if (!appointment?.appointmentDate) {
      return startOfDay(new Date());
    }
    return startOfDay(parseISO(appointment.appointmentDate));
  }, [appointment]);

  const eligibleDays = useMemo(() => {
    const all = buildBusinessDays(originalDate, config.businessDays, 42);
    const today = startOfDay(new Date());
    return all.filter((day) => isAfter(day.date, today) || isSameDay(day.date, today));
  }, [config.businessDays, originalDate]);

  useEffect(() => {
    let cancelled = false;

    async function loadSlots() {
      if (eligibleDays.length === 0) {
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        setLocalError('');

        const weeks = [];
        const firstWeekStart = eligibleDays[0].date;
        let current = new Date(firstWeekStart);
        while (eligibleDays.some((d) => d.date.getTime() >= current.getTime() && d.date.getTime() < addDays(current, 7).getTime())) {
          const week = [];
          for (let i = 0; i < 7; i++) {
            week.push({ date: new Date(current) });
            current = addDays(current, 1);
          }
          weeks.push(week);
        }

        const allItems = [];
        for (const week of weeks) {
          const response = await getAppointmentsByWeek(week);
          allItems.push(...response.items);
        }

        if (!cancelled) {
          setAppointmentsCache(allItems);
        }
      } catch (error) {
        if (!cancelled) {
          setLocalError(error.message ?? 'Não foi possível carregar os horários disponíveis.');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadSlots();

    return () => {
      cancelled = true;
    };
  }, [eligibleDays]);

  const availableSlotsByDay = useMemo(() => {
    const result = {};

    for (const day of eligibleDays) {
      const occupiedTimes = appointmentsCache
        .filter((item) => {
          if (item.id === appointment?.id) return false;
          if (item.status === 'cancelled') return false;
          return item.appointmentDate === day.id;
        })
        .map((item) => item.time);

      const slots = config.timeSlots.map((time) => {
        const occupied = occupiedTimes.includes(time);
        const expired = isPastAppointment(day.id, time);
        const available = !occupied && !expired;
        return {
          time,
          available,
          expired,
          occupied,
        };
      });

      result[day.id] = slots;
    }

    return result;
  }, [appointmentsCache, eligibleDays, config.timeSlots, appointment?.id]);

  useEffect(() => {
    if (eligibleDays.length > 0 && !selectedDayId) {
      setSelectedDayId(eligibleDays[0].id);
      setSelectedTime('');
    }
  }, [eligibleDays, selectedDayId]);

  if (!appointment) return null;

  const availableSlots = selectedDayId ? (availableSlotsByDay[selectedDayId] || []) : [];

  async function handleSubmit(event) {
    event.preventDefault();
    setLocalError('');

    if (!selectedDayId) {
      setLocalError('Selecione uma data para reagendar.');
      return;
    }

    if (!selectedTime) {
      setLocalError('Selecione um horário disponível.');
      return;
    }

    await onConfirm({
      newDate: selectedDayId,
      newTime: selectedTime,
      notes: notes || appointment.notes || undefined,
    });
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="modal-panel small-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reschedule-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <span className="section-tag">🔄 Reagendar</span>
            <h2 id="reschedule-modal-title">Escolha um novo horário</h2>
            <p>
              📌 Data original: <strong>{format(originalDate, 'dd/MM/yyyy')}</strong> · apenas datas iguais ou posteriores.
            </p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Fechar modal">
            ✕
          </button>
        </header>

        {localError && (
          <div className="auth-message error">
            <strong>Erro ao reagendar.</strong>
            <span>{localError}</span>
          </div>
        )}

        <form className="modal-form" onSubmit={handleSubmit}>
          <label>
            Data
            <select
              value={selectedDayId}
              onChange={(e) => {
                setSelectedDayId(e.target.value);
                setSelectedTime('');
              }}
              disabled={isLoading || isSubmitting}
            >
              {eligibleDays.map((day) => (
                <option key={day.id} value={day.id}>
                  {day.label} - {day.fullDate}
                </option>
              ))}
            </select>
          </label>

          {isLoading ? (
            <p className="helper-text">Carregando horários disponíveis...</p>
          ) : (
            <div className="time-slot-grid">
              {availableSlots.length === 0 && (
                <p className="helper-text">Nenhum horário disponível nesta data.</p>
              )}
              {availableSlots.map((slot) => {
                const statusClass = slot.expired
                  ? 'is-expired'
                  : (slot.available ? 'is-available' : 'is-occupied');
                const title = slot.expired
                  ? 'Horário já passou. Escolha um horário futuro.'
                  : slot.occupied
                    ? 'Horário já reservado.'
                    : 'Horário disponível.';
                return (
                  <button
                    key={slot.time}
                    type="button"
                    className={`time-slot-button ${statusClass} ${selectedTime === slot.time ? 'is-selected' : ''}`}
                    disabled={!slot.available || isSubmitting}
                    onClick={() => setSelectedTime(slot.time)}
                    title={title}
                  >
                    {slot.time}{slot.expired ? ' ⛔' : ''}
                  </button>
                );
              })}
            </div>
          )}

          <label className="modal-grid-full">
            Observação do reagendamento (opcional)
            <textarea
              rows="2"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Informe se necessário o motivo do reagendamento."
              disabled={isSubmitting}
            />
          </label>

          <footer className="modal-actions">
            <div className="modal-secondary-actions" />
            <div className="modal-primary-actions">
              <button type="button" className="ghost-button" onClick={onClose} disabled={isSubmitting}>
                Voltar
              </button>
              <button type="submit" className="primary-button" disabled={isLoading || isSubmitting || !selectedTime}>
                {isSubmitting ? 'Reagendando...' : 'Confirmar reagendamento'}
              </button>
            </div>
          </footer>
        </form>
      </section>
    </div>
  );
}
