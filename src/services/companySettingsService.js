import { hasSupabaseCredentials, supabase } from '../lib/supabase';
import { getDefaultScheduleConfig, normalizeScheduleConfig } from '../utils/scheduleConfig';

const demoCompanySettings = {
  companyId: 'company-demo',
  displayName: 'Auto Prime Veículos',
  timezone: 'America/Sao_Paulo',
  contactPhone: '(61) 99999-0000',
  scheduleConfig: getDefaultScheduleConfig(),
};

function mapCompanySettings(record, companyId) {
  return {
    companyId,
    displayName: record?.display_name ?? 'Empresa sem nome configurada',
    timezone: record?.timezone ?? 'America/Sao_Paulo',
    contactPhone: record?.contact_phone ?? '',
    scheduleConfig: {
      businessDays: record?.schedule_config?.businessDays,
      timeSlots: record?.schedule_config?.timeSlots,
    },
  };
}

export async function getCompanySettings(companyId) {
  if (!hasSupabaseCredentials || !supabase || !companyId) {
    return {
      ...demoCompanySettings,
      companyId: companyId ?? demoCompanySettings.companyId,
      source: 'mock',
    };
  }

  const { data, error } = await supabase
    .from('company_settings')
    .select(`
      company_id,
      display_name,
      timezone,
      contact_phone,
      schedule_config
    `)
    .eq('company_id', companyId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return {
    ...mapCompanySettings(data, companyId),
    source: 'supabase',
  };
}

export async function updateCompanySettings(companyId, payload) {
  if (!companyId) {
    throw new Error('Empresa não identificada para salvar configurações.');
  }

  if (!payload.displayName || payload.displayName.trim().length < 2) {
    throw new Error('Informe o nome da loja.');
  }

  const normalizedSchedule = normalizeScheduleConfig(payload.scheduleConfig);
  if (normalizedSchedule.businessDays.length === 0) {
    throw new Error('Selecione pelo menos um dia da semana para a agenda.');
  }
  if (normalizedSchedule.timeSlots.length === 0) {
    throw new Error('Cadastre pelo menos um horário de laudo por dia.');
  }

  const dbPayload = {
    display_name: payload.displayName.trim(),
    timezone: payload.timezone?.trim() || 'America/Sao_Paulo',
    contact_phone: payload.contactPhone?.trim() || null,
    schedule_config: {
      businessDays: normalizedSchedule.businessDays,
      timeSlots: normalizedSchedule.timeSlots,
    },
  };

  if (!hasSupabaseCredentials || !supabase) {
    return {
      success: true,
      source: 'mock',
      settings: {
        companyId,
        ...dbPayload,
        displayName: dbPayload.display_name,
        timezone: dbPayload.timezone,
        contactPhone: dbPayload.contact_phone,
        scheduleConfig: dbPayload.schedule_config,
      },
      message: 'Configurações atualizadas no modo demonstração.',
    };
  }

  const { error: upsertError } = await supabase
    .from('company_settings')
    .upsert(
      { company_id: companyId, ...dbPayload },
      { onConflict: 'company_id' },
    );

  if (upsertError) {
    if (upsertError.code === '42501') {
      throw new Error('Você não tem permissão para alterar as configurações da empresa.');
    }
    throw new Error(upsertError.message ?? 'Não foi possível salvar as configurações.');
  }

  return {
    success: true,
    source: 'supabase',
    message: 'Configurações salvas! A agenda já usa os novos dias e horários.',
  };
}
