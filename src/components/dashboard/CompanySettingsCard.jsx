import { useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { useCompanySettings } from '../../hooks/useCompanySettings';
import { updateCompanySettings } from '../../services/companySettingsService';
import { DEFAULT_TIME_SLOTS, normalizeScheduleConfig } from '../../utils/scheduleConfig';

const FULL_WEEK_DAYS = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
const TIME_OPTIONS = [
  '08:00', '08:30', '09:00', '09:30', '10:00', '10:30',
  '11:00', '11:30', '12:00', '12:30', '13:00', '13:30',
  '14:00', '14:30', '15:00', '15:30', '16:00', '16:30',
  '17:00', '17:30', '18:00',
];

function buildFormValues(settings) {
  const normalized = normalizeScheduleConfig(settings?.scheduleConfig);
  return {
    displayName: settings?.displayName ?? '',
    contactPhone: settings?.contactPhone ?? '',
    timezone: settings?.timezone ?? 'America/Sao_Paulo',
    businessDays: normalized.businessDays.slice(),
    timeSlots: normalized.timeSlots.slice(),
  };
}

export default function CompanySettingsCard({ settings, source }) {
  const auth = useAuth();
  const { showToast } = useToast();
  const { currentUser, isManager, refreshSettings } = useCompanySettings(auth.currentUser);
  const user = currentUser ?? auth?.currentUser;
  const canEdit = (isManager ?? auth?.isManager) || user?.role === 'admin';

  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [localError, setLocalError] = useState('');
  const [formValues, setFormValues] = useState(() => buildFormValues(settings));
  const [newTimeSlot, setNewTimeSlot] = useState('');

  const businessDaysSet = useMemo(
    () => new Set(formValues.businessDays),
    [formValues.businessDays],
  );
  const timeSlotsSet = useMemo(
    () => new Set(formValues.timeSlots),
    [formValues.timeSlots],
  );

  function toggleBusinessDay(dayLabel) {
    setFormValues((current) => {
      const has = current.businessDays.includes(dayLabel);
      const next = has
        ? current.businessDays.filter((d) => d !== dayLabel)
        : [...current.businessDays, dayLabel];
      return { ...current, businessDays: next };
    });
  }

  function addTimeSlot() {
    if (!newTimeSlot) return;
    if (!/^\d{2}:\d{2}$/.test(newTimeSlot)) {
      setLocalError('Formato de horário inválido. Use HH:MM (ex: 09:00).');
      return;
    }
    if (timeSlotsSet.has(newTimeSlot)) {
      setLocalError('Este horário já está na lista.');
      return;
    }
    setLocalError('');
    const next = [...formValues.timeSlots, newTimeSlot].sort();
    setFormValues((current) => ({ ...current, timeSlots: next }));
    setNewTimeSlot('');
  }

  function removeTimeSlot(time) {
    setFormValues((current) => ({
      ...current,
      timeSlots: current.timeSlots.filter((t) => t !== time),
    }));
  }

  function handleFieldChange(event) {
    const { name, value } = event.target;
    setFormValues((current) => ({ ...current, [name]: value }));
  }

  function enterEditMode() {
    setFormValues(buildFormValues(settings));
    setLocalError('');
    setIsEditing(true);
  }

  function cancelEdit() {
    setFormValues(buildFormValues(settings));
    setLocalError('');
    setIsEditing(false);
  }

  async function handleSave(event) {
    event.preventDefault();
    setIsSaving(true);
    setLocalError('');

    try {
      const result = await updateCompanySettings(user?.companyId, {
        displayName: formValues.displayName,
        contactPhone: formValues.contactPhone,
        timezone: formValues.timezone,
        scheduleConfig: {
          businessDays: formValues.businessDays,
          timeSlots: formValues.timeSlots,
        },
      });

      if (result.success) {
        showToast({
          title: 'Configurações salvas',
          message: result.message ?? 'Agenda atualizada com os novos dias e horários.',
          tone: 'success',
        });
        setIsEditing(false);
        if (typeof refreshSettings === 'function') {
          await refreshSettings();
        }
      } else {
        throw new Error(result.message ?? 'Falha ao salvar configurações.');
      }
    } catch (e) {
      setLocalError(e.message ?? 'Não foi possível salvar.');
      showToast({
        title: 'Falha ao salvar',
        message: e.message ?? 'Não foi possível salvar as configurações.',
        tone: 'error',
      });
    } finally {
      setIsSaving(false);
    }
  }

  if (!isEditing) {
    return (
      <section className="info-panel">
        <div className="inline-actions">
          <div>
            <span className="section-tag">Configuração operacional</span>
            <h2>{settings.displayName}</h2>
            <p>
              Esses dados definem a base da agenda da empresa e facilitam futuras personalizações sem refazer a operação.
            </p>
          </div>
          {canEdit && (
            <button
              type="button"
              className="primary-button"
              onClick={enterEditMode}
              title="Personalizar dias e horários de laudo cautelar"
            >
              ⚙️ Personalizar
            </button>
          )}
        </div>

        <div className="company-settings-grid">
          <article className="summary-card">
            <span>Fuso horário</span>
            <strong>{settings.timezone.replace('_', ' ')}</strong>
          </article>
          <article className="summary-card">
            <span>Dias da agenda</span>
            <strong>{settings.scheduleConfig.businessDays.length}</strong>
            <small>{settings.scheduleConfig.businessDays.join(', ')}</small>
          </article>
          <article className="summary-card">
            <span>Slots por dia</span>
            <strong>{settings.scheduleConfig.timeSlots.length}</strong>
            <small>{settings.scheduleConfig.timeSlots.join(' - ')}</small>
          </article>
        </div>

        <div className="inline-actions">
          <p>
            {source === 'supabase'
              ? 'As configurações abaixo já estão sendo carregadas da empresa logada.'
              : 'Ainda estamos em modo padrão, mas a estrutura de configuração já está pronta para uso real.'}
          </p>
          {settings.contactPhone && <span className="company-contact">Contato: {settings.contactPhone}</span>}
        </div>
      </section>
    );
  }

  return (
    <section className="info-panel">
      <div className="inline-actions">
        <div>
          <span className="section-tag">Configuração operacional</span>
          <h2>Personalizar agenda da loja</h2>
          <p>
            Aqui você escolhe quais dias a loja trabalha com laudo cautelar e quais horários cada dia terá. A agenda
            operacional se atualiza imediatamente após salvar.
          </p>
        </div>
        {source === 'mock' && (
          <span className="section-tag">Modo demo</span>
        )}
      </div>

      {localError && (
        <div className="auth-message error">
          <strong>Erro.</strong>
          <span>{localError}</span>
        </div>
      )}

      <form className="modal-form" onSubmit={handleSave}>
        <div className="company-settings-form-grid">
          <label>
            Nome da loja
            <input
              name="displayName"
              value={formValues.displayName}
              onChange={handleFieldChange}
              placeholder="Ex: Auto Prime Veículos"
              required
              disabled={isSaving}
            />
          </label>

          <label>
            Telefone / WhatsApp
            <input
              name="contactPhone"
              value={formValues.contactPhone}
              onChange={handleFieldChange}
              placeholder="(61) 99999-9999"
              disabled={isSaving}
            />
          </label>

          <label className="modal-grid-full">
            Dias de funcionamento com laudo
            <small className="helper-text-inline">
              Marque os dias que a loja faz laudo cautelar. O sistema monta a agenda semanal automaticamente.
            </small>
            <div className="days-checkbox-grid">
              {FULL_WEEK_DAYS.map((day) => {
                const checked = businessDaysSet.has(day);
                return (
                  <label
                    key={day}
                    className={`day-checkbox ${checked ? 'checked' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleBusinessDay(day)}
                      disabled={isSaving}
                    />
                    <span>{day}</span>
                  </label>
                );
              })}
            </div>
          </label>

          <label className="modal-grid-full">
            Horários de laudo por dia
            <small className="helper-text-inline">
              Horários mais comuns já estão abaixo. Você pode remover ou adicionar novos. Para manhã/tarde com
              intervalo, só deixar o horário de almoço fora da lista.
            </small>
            <div className="time-slots-edit-list">
              {formValues.timeSlots.length === 0 && (
                <p className="helper-text-inline">Nenhum horário cadastrado. Adicione pelo menos um abaixo.</p>
              )}
              {formValues.timeSlots.map((time) => (
                <div key={time} className="time-chip">
                  <strong>{time}</strong>
                  <button
                    type="button"
                    className="icon-button tiny"
                    onClick={() => removeTimeSlot(time)}
                    disabled={isSaving}
                    aria-label={`Remover horário ${time}`}
                    title="Remover horário"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <div className="time-slot-add-row">
              <select
                value={newTimeSlot}
                onChange={(e) => setNewTimeSlot(e.target.value)}
                disabled={isSaving}
              >
                <option value="">-- Escolher horário --</option>
                {TIME_OPTIONS.filter((t) => !timeSlotsSet.has(t)).map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <button
                type="button"
                className="ghost-button"
                onClick={addTimeSlot}
                disabled={isSaving || !newTimeSlot}
              >
                + Adicionar horário
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  setFormValues((current) => ({ ...current, timeSlots: DEFAULT_TIME_SLOTS.slice() }));
                }}
                disabled={isSaving}
              >
                Reset padrão
              </button>
            </div>
          </label>
        </div>

        <footer className="modal-actions">
          <div />
          <div className="modal-primary-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={cancelEdit}
              disabled={isSaving}
            >
              Cancelar
            </button>
            <button type="submit" className="primary-button" disabled={isSaving}>
              {isSaving ? 'Salvando...' : '💾 Salvar configurações'}
            </button>
          </div>
        </footer>
      </form>
    </section>
  );
}
