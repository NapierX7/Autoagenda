export function isCancellationPending(appointment) {
  return Boolean(
    appointment
    && appointment.status === 'scheduled'
    && appointment.cancellationRequestedAt,
  );
}

export function getAppointmentWorkflowStatus(appointment) {
  if (!appointment) {
    return 'available';
  }

  if (appointment.status === 'cancelled') {
    return 'cancelled';
  }

  if (appointment.status === 'completed') {
    return 'completed';
  }

  if (isCancellationPending(appointment)) {
    return 'cancellation_pending';
  }

  return 'scheduled';
}

export function getBoardSlotStatus(appointment) {
  const workflowStatus = getAppointmentWorkflowStatus(appointment);

  if (workflowStatus === 'completed') {
    return 'finalized';
  }

  if (workflowStatus === 'cancellation_pending') {
    return 'pending';
  }

  if (workflowStatus === 'scheduled') {
    return 'occupied';
  }

  return 'available';
}

export function isExpiredAvailableSlot(dayId, time, referenceDate = new Date()) {
  if (!dayId || !time) {
    return false;
  }

  const slotDateTime = new Date(`${dayId}T${time}:00`);

  if (Number.isNaN(slotDateTime.getTime())) {
    return false;
  }

  return slotDateTime.getTime() < referenceDate.getTime();
}

export function getAppointmentStatusLabel(appointment) {
  const workflowStatus = getAppointmentWorkflowStatus(appointment);

  if (workflowStatus === 'cancellation_pending') {
    return 'Cancelamento pendente';
  }

  if (workflowStatus === 'completed') {
    return 'Finalizado';
  }

  if (workflowStatus === 'cancelled') {
    return 'Cancelado';
  }

  return 'Ocupado';
}

export function getAppointmentStatusFilterValue(appointment) {
  const workflowStatus = getAppointmentWorkflowStatus(appointment);
  return workflowStatus === 'cancellation_pending' ? 'pending' : workflowStatus;
}

export function getCancellationApprovalState(appointment) {
  return {
    requested: isCancellationPending(appointment),
    adminApproved: Boolean(appointment?.cancellationAdminApprovedAt),
    evaluatorApproved: Boolean(appointment?.cancellationEvaluatorApprovedAt),
  };
}
