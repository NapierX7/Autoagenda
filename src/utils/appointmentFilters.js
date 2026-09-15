import { getAppointmentStatusFilterValue } from './appointmentStatus';

function appointmentMatchesFilters(appointment, filters) {
  if (!appointment) {
    if (filters.vehiclePlate) return false;
    if (filters.sellerName) return false;
    if (filters.status === 'scheduled' || filters.status === 'pending' || filters.status === 'completed') return false;
    return true;
  }

  const appointmentStatus = getAppointmentStatusFilterValue(appointment);
  const statusMatch =
    filters.status === 'all'
      ? true
      : filters.status === 'available'
        ? false
        : filters.status === 'expired'
          ? false
          : appointmentStatus === filters.status;

  const plateMatch = filters.vehiclePlate
    ? (appointment.vehiclePlate || '').toLowerCase().includes(filters.vehiclePlate.toLowerCase())
    : true;

  const sellerMatch = filters.sellerName
    ? (appointment.sellerName || '').toLowerCase().includes(filters.sellerName.toLowerCase())
    : true;

  return statusMatch && plateMatch && sellerMatch;
}

export function filterBoard(board, filters) {
  return board.map((day) => ({
    ...day,
    slots: day.slots.filter((slot) => {
      const slotIsEmpty = !slot.appointment && !slot.appointments?.length;
      if (slotIsEmpty) {
        return appointmentMatchesFilters(null, filters);
      }
      return appointmentMatchesFilters(slot.appointment ?? slot.appointments?.[0] ?? null, filters);
    }),
  }));
}

export function countVisibleSlots(board) {
  return board.reduce((total, day) => total + day.slots.length, 0);
}
