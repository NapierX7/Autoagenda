import { addDays, addWeeks, format, startOfWeek } from 'date-fns';

export const DEFAULT_TIME_SLOTS = ['09:00', '10:00', '11:00', '12:00', '14:00', '15:00', '16:00'];
export const DEFAULT_BUSINESS_DAY_LABELS = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta'];
const BUSINESS_DAY_LABELS = {
  Segunda: 'Segunda',
  Terca: 'Terça',
  'Terça': 'Terça',
  Quarta: 'Quarta',
  Quinta: 'Quinta',
  Sexta: 'Sexta',
  Sabado: 'Sábado',
  'Sábado': 'Sábado',
  Domingo: 'Domingo',
};
const BUSINESS_DAY_OFFSETS = {
  Segunda: 0,
  'Terça': 1,
  Quarta: 2,
  Quinta: 3,
  Sexta: 4,
  'Sábado': 5,
  Domingo: 6,
};

export function getDefaultScheduleConfig() {
  return {
    businessDays: DEFAULT_BUSINESS_DAY_LABELS,
    timeSlots: DEFAULT_TIME_SLOTS,
  };
}

export function normalizeScheduleConfig(scheduleConfig) {
  const normalizedBusinessDays = Array.isArray(scheduleConfig?.businessDays)
    ? [...new Set(scheduleConfig.businessDays
      .map((label) => BUSINESS_DAY_LABELS[label])
      .filter(Boolean))]
      .sort((left, right) => BUSINESS_DAY_OFFSETS[left] - BUSINESS_DAY_OFFSETS[right])
    : [];

  return {
    businessDays: normalizedBusinessDays.length > 0
      ? normalizedBusinessDays
      : DEFAULT_BUSINESS_DAY_LABELS,
    timeSlots: Array.isArray(scheduleConfig?.timeSlots) && scheduleConfig.timeSlots.length > 0
      ? scheduleConfig.timeSlots
      : DEFAULT_TIME_SLOTS,
  };
}

export function buildCurrentWeek(referenceDate = new Date(), businessDays = DEFAULT_BUSINESS_DAY_LABELS) {
  return buildScheduleWeek(referenceDate, businessDays);
}

export function buildScheduleWeek(referenceDate = new Date(), businessDays = DEFAULT_BUSINESS_DAY_LABELS, weekOffset = 0) {
  const operationalReferenceDate = getOperationalReferenceDate(referenceDate);
  const monday = addWeeks(startOfWeek(operationalReferenceDate, { weekStartsOn: 1 }), weekOffset);

  return businessDays.map((label) => {
    const date = addDays(monday, BUSINESS_DAY_OFFSETS[label] ?? 0);

    return {
      id: format(date, 'yyyy-MM-dd'),
      label,
      shortLabel: label.slice(0, 3),
      fullDate: format(date, 'dd/MM'),
      date,
    };
  });
}

export function isNextWeekUnlocked(referenceDate = new Date()) {
  const day = referenceDate.getDay();
  return day === 5;
}

function getOperationalReferenceDate(referenceDate) {
  const day = referenceDate.getDay();
  if (day === 6) {
    return addDays(referenceDate, 2);
  }
  if (day === 0) {
    return addDays(referenceDate, 1);
  }
  return referenceDate;
}

export function formatWeekRangeLabel(weekDays) {
  if (!Array.isArray(weekDays) || weekDays.length === 0) {
    return '';
  }

  const firstDay = weekDays[0];
  const lastDay = weekDays[weekDays.length - 1];

  return `${firstDay.fullDate} até ${lastDay.fullDate}`;
}

export function getWeekContextLabel(weekOffset = 0) {
  return weekOffset === 0 ? 'Semana atual' : 'Próxima semana';
}

export function getWeekScopeDescription(weekOffset = 0) {
  return weekOffset === 0
    ? 'Os slots acompanham automaticamente as datas da semana em curso.'
    : 'Agenda da próxima semana liberada para novos agendamentos.';
}

export function buildLegacyWeek(referenceDate = new Date(), businessDays = DEFAULT_BUSINESS_DAY_LABELS) {
  const monday = startOfWeek(referenceDate, { weekStartsOn: 1 });

  return businessDays.map((label, index) => {
    const date = addDays(monday, index);

    return {
      id: format(date, 'yyyy-MM-dd'),
      label,
      shortLabel: label.slice(0, 3),
      fullDate: format(date, 'dd/MM'),
      date,
    };
  });
}
