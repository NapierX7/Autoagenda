const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isOccupancyAppointmentId(id) {
  return typeof id === 'string' && id.startsWith('occupancy:');
}

export function isRealAppointmentId(id) {
  return typeof id === 'string' && UUID_RE.test(id.trim());
}

/**
 * Selection shape from WeeklySchedulePreview: { day, slot: { appointment?, ... } }
 */
export function getSelectionAppointment(selection) {
  if (!selection || typeof selection !== 'object') return null;
  return selection.slot?.appointment ?? selection.appointment ?? null;
}

export function isOccupancyOnlySelection(selection) {
  const appointment = getSelectionAppointment(selection);
  if (!appointment) return false;
  return Boolean(appointment.isOccupancyOnly) || isOccupancyAppointmentId(appointment.id);
}

export function assertMutableAppointmentId(appointmentId, actionLabel = 'esta operação') {
  if (isOccupancyAppointmentId(appointmentId)) {
    throw new Error(
      `Horário ocupado por outro vendedor (somente leitura). Não é possível executar ${actionLabel} com id fictício de ocupação.`,
    );
  }
  if (appointmentId != null && appointmentId !== '' && !isRealAppointmentId(appointmentId)) {
    throw new Error(`Identificador de agendamento inválido para ${actionLabel}.`);
  }
  return appointmentId;
}
