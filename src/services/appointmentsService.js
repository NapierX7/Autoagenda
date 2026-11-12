import { format } from 'date-fns';
import { hasSupabaseCredentials, supabase } from '../lib/supabase';
import { assertMutableAppointmentId } from '../utils/appointmentIds';
import { mockAppointments } from '../utils/mockAppointments';

/** Base64/data URLs above this size must not go into appointments row updates. */
const MAX_INLINE_LAUDO_DATA_URL_CHARS = 200 * 1024;

function getFriendlyError(error) {
  if (!error) {
    return new Error('Não foi possível concluir a operação.');
  }

  if (error.code === '23505' || error.message?.toLowerCase().includes('duplicate key value')) {
    return new Error('Este horário acabou de ser ocupado por outro usuário. Atualize a agenda e escolha outro slot.');
  }

  if (error.code === '42501') {
    return new Error(
      '⚠️ Permissão temporariamente indisponível. Faça LOGOUT e entre NOVAMENTE (isso limpa a sessão antiga com permissões desatualizadas). Se persistir após relogar, avise o administrador técnico.'
    );
  }

  const text = String(error?.message ?? '').toLowerCase();
  if (text.includes('apenas gerentes ou avaliadores podem cancelar') ||
      text.includes('apenas gerentes ou avaliadores podem aprovar') ||
      text.includes('apenas') && text.includes('permissao')) {
    return new Error(error.message ?? 'Permissao insuficiente.');
  }

  return new Error(error.message ?? 'Não foi possível concluir a operação.');
}

const EDGE_FUNCTION_USER_ADMIN_ACTIONS = 'user-admin-actions';

function getLocalNow() {
  return new Date();
}

export function isPastAppointment(appointmentDate, appointmentTime, now = getLocalNow()) {
  if (!appointmentDate || !appointmentTime) return true;
  const iso = String(appointmentDate).slice(0, 10);
  const hhmm = String(appointmentTime).slice(0, 5);
  const candidate = new Date(`${iso}T${hhmm}:00`);
  if (Number.isNaN(candidate.getTime())) return true;
  return candidate.getTime() < now.getTime();
}

async function _getSessionBearerToken() {
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    const accessToken = data?.session?.access_token;
    return accessToken ? String(accessToken) : null;
  } catch (_err) {
    return null;
  }
}

async function callUserAdminActions(body, { useAnonAuth = false } = {}) {
  if (!hasSupabaseCredentials || !supabase) {
    throw new Error('Supabase nao configurado.');
  }

  // SUBSTITUI supabase.functions.invoke POR fetch() NATIVO.
  // Motivo: o SDK do supabase retorna a mensagem GENERICA
  // "Edge Function returned a non-2xx status code" para QUALQUER
  // erro (401, 403, 404, 500) e esconde o erro REAL do backend.
  // Usando fetch() diretamente nos temos acesso ao status code e
  // ao corpo JSON completo, entao podemos tratar e exibir o
  // erro CORRETO para o usuario final.
  const baseUrl = String(import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '');
  if (!baseUrl) {
    throw new Error('VITE_SUPABASE_URL nao configurada no frontend.');
  }
  const anonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? '');
  const bearerToken = useAnonAuth ? anonKey : ((await _getSessionBearerToken()) ?? anonKey);

  const endpoint = `${baseUrl}/functions/v1/${EDGE_FUNCTION_USER_ADMIN_ACTIONS}`;
  const rawBody = typeof body === 'string' ? body : JSON.stringify(body ?? {});

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'apikey': anonKey,
        'Authorization': `Bearer ${bearerToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: rawBody,
    });
  } catch (networkErr) {
    const msg = networkErr && networkErr.message ? networkErr.message : 'Sem conexao com a internet.';
    if (msg.toLowerCase().includes('cors') || msg.toLowerCase().includes('blocked') || msg.toLowerCase().includes('network')) {
      throw new Error('Nao foi possivel se comunicar com o servidor do Supabase. Verifique sua internet e tente novamente em 10 segundos.');
    }
    throw new Error(`Falha de comunicacao com edge function: ${msg}`);
  }

  const statusCode = response.status;
  let responseText = '';
  try { responseText = await response.text(); } catch (_r) { /* ignora */ }

  let data;
  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch (_parseErr) {
    data = { raw: responseText };
  }

  if (!response.ok) {
    let backendMsg = (data && data.error) ? data.error : (data && data.message ? data.message : null);
    if (!backendMsg && typeof data === 'string') backendMsg = data;
    if (!backendMsg && responseText) backendMsg = responseText.slice(0, 600);

    let friendly = backendMsg ?? `Falha na operacao. (HTTP ${statusCode})`;
    if (statusCode === 401) friendly = backendMsg || 'Sessao expirou ou voce nao tem permissao. Faca login novamente.';
    if (statusCode === 403) friendly = backendMsg || 'Voce nao tem permissao para executar esta acao. Contate um administrador.';
    if (statusCode === 404) friendly = backendMsg || 'A funcao do servidor nao foi encontrada. Verifique o deploy da edge function.';
    if (statusCode === 409) friendly = backendMsg || 'Conflito no servidor (ex: registro duplicado).';
    if (statusCode === 422) friendly = backendMsg || 'Dados enviados invalidos.';
    if (statusCode >= 500) friendly = (backendMsg || `Erro interno no servidor (HTTP ${statusCode}). Confira os logs da edge function no Supabase.`);
    if (typeof friendly === 'string' && friendly.toLowerCase().includes('edge function returned a non-2xx status code')) {
      friendly = backendMsg ?? `Operacao nao concluida (HTTP ${statusCode}).`;
    }
    const err = new Error(friendly);
    err.statusCode = statusCode;
    err.rawBody = responseText;
    throw err;
  }

  if (data?.error) {
    const err = new Error(data.error);
    err.statusCode = statusCode;
    throw err;
  }
  if (data && !data.success && typeof data === 'object' && ('message' in data || 'error' in data)) {
    const err = new Error(data.message ?? data.error ?? 'Operacao nao concluida.');
    err.statusCode = statusCode;
    throw err;
  }
  return data;
}

function mapAppointmentPayload(payload) {
  return {
    company_id: payload.companyId,
    created_by: payload.createdBy,
    appointment_date: payload.appointmentDate,
    appointment_time: payload.appointmentTime,
    customer_name: payload.customerName,
    customer_phone: payload.customerPhone,
    customer_cpf: payload.customerCpf || null,
    customer_zip_code: payload.customerZipCode || null,
    customer_email: payload.customerEmail || null,
    customer_address: payload.customerAddress || null,
    seller_name: payload.sellerName,
    vehicle_plate: payload.vehiclePlate,
    vehicle_model: payload.vehicleModel,
    vehicle_year: Number(payload.vehicleYear),
    notes: payload.notes || null,
    status: payload.status ?? 'scheduled',
    is_voucher: Boolean(payload.isVoucher),
    seller_email: payload.sellerEmail || null,
    is_encaixe: Boolean(payload.isEncaixe),
    encaixe_created_at: payload.isEncaixe ? new Date().toISOString() : null,
    encaixe_created_by: payload.isEncaixe ? (payload.encaixeCreatedBy ?? payload.createdBy ?? null) : null,
  };
}

export function mapAppointmentRecord(record) {
  return {
    id: record.id,
    time: String(record.appointment_time).slice(0, 5),
    status: record.status,
    customerName: record.customer_name,
    customerPhone: record.customer_phone,
    customerCpf: record.customer_cpf,
    customerZipCode: record.customer_zip_code,
    customerEmail: record.customer_email,
    customerAddress: record.customer_address,
    sellerName: record.seller_name,
    sellerEmail: record.seller_email,
    vehiclePlate: record.vehicle_plate,
    vehicleModel: record.vehicle_model,
    vehicleYear: String(record.vehicle_year),
    notes: record.notes,
    appointmentDate: record.appointment_date,
    cancellationRequestedAt: record.cancellation_requested_at,
    cancellationRequestedBy: record.cancellation_requested_by,
    cancellationRequestReason: record.cancellation_request_reason,
    cancellationAdminApprovedAt: record.cancellation_admin_approved_at,
    cancellationAdminApprovedBy: record.cancellation_admin_approved_by,
    cancellationEvaluatorApprovedAt: record.cancellation_evaluator_approved_at,
    cancellationEvaluatorApprovedBy: record.cancellation_evaluator_approved_by,
    isVoucher: Boolean(record.is_voucher),
    voucherApprovedAt: record.voucher_approved_at,
    voucherApprovedBy: record.voucher_approved_by,
    laudoResult: record.laudo_result,
    laudoRejectionReason: record.laudo_rejection_reason,
    laudoFileUrl: record.laudo_file_url,
    laudoFileName: record.laudo_file_name,
    laudoFinalizedAt: record.laudo_finalized_at,
    laudoFinalizedBy: record.laudo_finalized_by,
    originalAppointmentDate: record.original_appointment_date,
    originalAppointmentTime: record.original_appointment_time
      ? String(record.original_appointment_time).slice(0, 5)
      : null,
    rescheduledCount: record.rescheduled_count ?? 0,
    createdBy: record.created_by,
    isEncaixe: Boolean(record.is_encaixe),
    encaixeCreatedAt: record.encaixe_created_at,
    encaixeCreatedBy: record.encaixe_created_by,
  };
}

function mapOccupancyPlaceholder(row, index = 0) {
  const date = row.appointment_date;
  const time = String(row.appointment_time).slice(0, 5);
  const status = row.status === 'completed' ? 'completed' : 'scheduled';
  return {
    id: `occupancy:${date}:${time}:${index}`,
    time,
    status,
    customerName: 'Horário ocupado',
    customerPhone: '',
    customerCpf: null,
    customerZipCode: null,
    customerEmail: null,
    customerAddress: null,
    sellerName: '',
    sellerEmail: null,
    vehiclePlate: '',
    vehicleModel: '',
    vehicleYear: '',
    notes: null,
    appointmentDate: date,
    cancellationRequestedAt: null,
    cancellationRequestedBy: null,
    cancellationRequestReason: null,
    cancellationAdminApprovedAt: null,
    cancellationAdminApprovedBy: null,
    cancellationEvaluatorApprovedAt: null,
    cancellationEvaluatorApprovedBy: null,
    isVoucher: false,
    voucherApprovedAt: null,
    voucherApprovedBy: null,
    laudoResult: null,
    laudoRejectionReason: null,
    laudoFileUrl: null,
    laudoFileName: null,
    laudoFinalizedAt: null,
    laudoFinalizedBy: null,
    originalAppointmentDate: null,
    originalAppointmentTime: null,
    rescheduledCount: 0,
    createdBy: null,
    isEncaixe: Boolean(row.is_encaixe),
    encaixeCreatedAt: null,
    encaixeCreatedBy: null,
    isOccupancyOnly: true,
  };
}

export async function getAppointmentsByWeek(weekDays) {
  if (!hasSupabaseCredentials || !supabase) {
    return {
      items: mockAppointments,
      source: 'mock',
    };
  }

  const startDate = format(weekDays[0].date, 'yyyy-MM-dd');
  const endDate = format(weekDays[weekDays.length - 1].date, 'yyyy-MM-dd');

  const { data, error } = await supabase
    .from('appointments')
    .select(`
      id,
      appointment_date,
      appointment_time,
      customer_name,
      customer_phone,
      customer_cpf,
      customer_zip_code,
      customer_email,
      customer_address,
      seller_name,
      seller_email,
      vehicle_plate,
      vehicle_model,
      vehicle_year,
      notes,
      cancellation_requested_at,
      cancellation_requested_by,
      cancellation_request_reason,
      cancellation_admin_approved_at,
      cancellation_admin_approved_by,
      cancellation_evaluator_approved_at,
      cancellation_evaluator_approved_by,
      status,
      is_voucher,
      voucher_approved_at,
      voucher_approved_by,
      laudo_result,
      laudo_rejection_reason,
      laudo_file_url,
      laudo_file_name,
      laudo_finalized_at,
      laudo_finalized_by,
      original_appointment_date,
      original_appointment_time,
      rescheduled_count,
      created_by,
      is_encaixe,
      encaixe_created_at,
      encaixe_created_by
    `)
    .gte('appointment_date', startDate)
    .lte('appointment_date', endDate)
    .order('appointment_date', { ascending: true })
    .order('appointment_time', { ascending: true });

  if (error) {
    throw getFriendlyError(error);
  }

  const visibleItems = (data || []).map(mapAppointmentRecord);

  // Seller (e qualquer papel sob RLS restrito): completa a grade com ocupação sem PII.
  const { data: occupancy, error: occupancyError } = await supabase.rpc(
    'get_company_slot_occupancy',
    { p_start_date: startDate, p_end_date: endDate },
  );

  if (occupancyError) {
    // Staff com SELECT completo não depende da RPC; sellers precisam dela.
    // Se a RPC falhar, devolve só o que o RLS permitiu (sem inventar slots).
    return {
      items: visibleItems,
      source: 'supabase',
      occupancyError: occupancyError.message,
    };
  }

  const ownedKeys = new Set(
    visibleItems.map((item) => `${item.appointmentDate}|${item.time}|${item.status}`),
  );

  const placeholders = [];
  (occupancy || []).forEach((row, index) => {
    if (row.is_mine) return;
    const time = String(row.appointment_time).slice(0, 5);
    const status = row.status === 'completed' ? 'completed' : 'scheduled';
    const key = `${row.appointment_date}|${time}|${status}`;
    if (ownedKeys.has(key)) return;
    placeholders.push(mapOccupancyPlaceholder(row, index));
  });

  return {
    items: [...visibleItems, ...placeholders],
    source: 'supabase',
  };
}

export async function getAllAppointments(companyId) {
  if (!hasSupabaseCredentials || !supabase) {
    return {
      items: mockAppointments,
      source: 'mock',
    };
  }

  const { data, error } = await supabase
    .from('appointments')
    .select(`
      id,
      appointment_date,
      appointment_time,
      customer_name,
      customer_phone,
      customer_cpf,
      customer_zip_code,
      customer_email,
      customer_address,
      seller_name,
      seller_email,
      vehicle_plate,
      vehicle_model,
      vehicle_year,
      notes,
      cancellation_requested_at,
      cancellation_requested_by,
      cancellation_request_reason,
      cancellation_admin_approved_at,
      cancellation_admin_approved_by,
      cancellation_evaluator_approved_at,
      cancellation_evaluator_approved_by,
      status,
      is_voucher,
      voucher_approved_at,
      voucher_approved_by,
      laudo_result,
      laudo_rejection_reason,
      laudo_file_url,
      laudo_file_name,
      laudo_finalized_at,
      laudo_finalized_by,
      original_appointment_date,
      original_appointment_time,
      rescheduled_count,
      created_by,
      created_at,
      is_encaixe,
      encaixe_created_at,
      encaixe_created_by
    `)
    .order('created_at', { ascending: false });

  if (error) {
    throw getFriendlyError(error);
  }

  return {
    items: data.map(mapAppointmentRecord),
    source: 'supabase',
  };
}

export async function createAppointment(payload) {
  if (isPastAppointment(payload.appointmentDate, payload.appointmentTime)) {
    throw new Error('Nao e permitido agendar em horarios que ja passaram. Escolha outra data ou horario futuro.');
  }

  validateSellerInfo(payload, { allowNull: false });

  if (!hasSupabaseCredentials || !supabase) {
    const createdRecord = {
      id: `mock-${Date.now()}`,
      ...payload,
      appointmentDate: payload.appointmentDate,
      time: payload.appointmentTime,
      isVoucher: Boolean(payload.isVoucher),
      rescheduledCount: 0,
      createdBy: payload.createdBy,
    };

    mockAppointments.push(createdRecord);
    return createdRecord;
  }

  const dbPayload = mapAppointmentPayload(payload);

  if (dbPayload.is_voucher) {
    if (!dbPayload.customer_name) dbPayload.customer_name = 'Voucher';
    if (!dbPayload.customer_phone) dbPayload.customer_phone = '0000000000';
    if (!dbPayload.vehicle_plate) dbPayload.vehicle_plate = 'XXX0000';
    if (!dbPayload.vehicle_model) dbPayload.vehicle_model = 'Voucher';
    if (!dbPayload.vehicle_year) dbPayload.vehicle_year = 2000;
  }

  const { data, error } = await supabase
    .from('appointments')
    .insert(dbPayload)
    .select()
    .single();

  if (error) {
    throw getFriendlyError(error);
  }

  return mapAppointmentRecord(data);
}

export async function updateAppointment(appointmentId, payload) {
  assertMutableAppointmentId(appointmentId, 'atualizar agendamento');
  // Se estiver alterando a data/hora do agendamento, NAO permite jogar para horario passado.
  // (Permite manter a mesma data hora original, mesmo que ja esteja passado, p/ finalizar laudos etc.)
  if (payload && (payload.appointmentDate || payload.appointmentTime)) {
    const effectiveDate = payload.appointmentDate;
    const effectiveTime = payload.appointmentTime;
    if (effectiveDate && effectiveTime && isPastAppointment(effectiveDate, effectiveTime)) {
      throw new Error('Nao e permitido salvar este agendamento com data/hora que ja passaram.');
    }
  }

  validateSellerInfo(payload, { allowNull: false });

  if (!hasSupabaseCredentials || !supabase) {
    const index = mockAppointments.findIndex((item) => item.id === appointmentId);

    if (index >= 0) {
      mockAppointments[index] = {
        ...mockAppointments[index],
        ...payload,
        isVoucher: payload.isVoucher !== undefined ? Boolean(payload.isVoucher) : mockAppointments[index].isVoucher,
      };
      return mockAppointments[index];
    }

    throw new Error('Agendamento não encontrado.');
  }

  const dbPayload = mapAppointmentPayload(payload);
  delete dbPayload.company_id;
  delete dbPayload.created_by;

  if (dbPayload.is_voucher) {
    if (!dbPayload.customer_name) dbPayload.customer_name = 'Voucher';
    if (!dbPayload.customer_phone) dbPayload.customer_phone = '0000000000';
    if (!dbPayload.vehicle_plate) dbPayload.vehicle_plate = 'XXX0000';
    if (!dbPayload.vehicle_model) dbPayload.vehicle_model = 'Voucher';
    if (!dbPayload.vehicle_year) dbPayload.vehicle_year = 2000;
  }

  const { data, error } = await supabase
    .from('appointments')
    .update(dbPayload)
    .eq('id', appointmentId)
    .select()
    .single();

  if (error) {
    throw getFriendlyError(error);
  }

  return mapAppointmentRecord(data);
}

export async function rescheduleAppointment(appointmentId, newDate, newTime, payload) {
  assertMutableAppointmentId(appointmentId, 'reagendar');
  if (isPastAppointment(newDate, newTime)) {
    throw new Error('Nao e permitido reagendar para um horario que ja passou. Escolha outra data ou horario futuro.');
  }

  if (!hasSupabaseCredentials || !supabase) {
    const index = mockAppointments.findIndex((item) => item.id === appointmentId);

    if (index >= 0) {
      const current = mockAppointments[index];
      mockAppointments[index] = {
        ...current,
        ...payload,
        appointmentDate: newDate,
        time: newTime,
        originalAppointmentDate: current.originalAppointmentDate || current.appointmentDate,
        originalAppointmentTime: current.originalAppointmentTime || current.time,
        rescheduledCount: (current.rescheduledCount ?? 0) + 1,
      };
      return mockAppointments[index];
    }

    throw new Error('Agendamento não encontrado.');
  }

  const { data: currentRecord, error: fetchError } = await supabase
    .from('appointments')
    .select('id, appointment_date, appointment_time, original_appointment_date, original_appointment_time, rescheduled_count')
    .eq('id', appointmentId)
    .single();

  if (fetchError) {
    throw getFriendlyError(fetchError);
  }

  const updatePayload = {
    appointment_date: newDate,
    appointment_time: newTime,
    original_appointment_date: currentRecord.original_appointment_date ?? currentRecord.appointment_date,
    original_appointment_time: currentRecord.original_appointment_time ?? currentRecord.appointment_time,
    rescheduled_count: (currentRecord.rescheduled_count ?? 0) + 1,
  };

  if (payload?.notes !== undefined) {
    updatePayload.notes = payload.notes || null;
  }

  const { data, error } = await supabase
    .from('appointments')
    .update(updatePayload)
    .eq('id', appointmentId)
    .select()
    .single();

  if (error) {
    throw getFriendlyError(error);
  }

  return mapAppointmentRecord(data);
}

export async function cancelAppointment(appointmentId, actor = null) {
  assertMutableAppointmentId(appointmentId, 'cancelar');
  if (!hasSupabaseCredentials || !supabase) {
    const target = mockAppointments.find((item) => item.id === appointmentId);

    if (!target) {
      throw new Error('Agendamento não encontrado.');
    }

    const now = new Date().toISOString();
    target.status = 'cancelled';
    target.cancelledAt = target.cancelledAt ?? now;
    target.cancelledBy = target.cancelledBy ?? (actor?.id ?? null);

    if (actor?.role === 'admin' && !target.cancellationAdminApprovedAt) {
      target.cancellationAdminApprovedAt = now;
      target.cancellationAdminApprovedBy = actor.id;
    }
    if (actor?.role === 'evaluator' && !target.cancellationEvaluatorApprovedAt) {
      target.cancellationEvaluatorApprovedAt = now;
      target.cancellationEvaluatorApprovedBy = actor.id;
    }
    if (actor?.role === 'admin' && !target.cancellationEvaluatorApprovedAt) {
      target.cancellationEvaluatorApprovedAt = now;
      target.cancellationEvaluatorApprovedBy = actor.id;
    }
    if (actor?.role === 'evaluator' && !target.cancellationAdminApprovedAt) {
      target.cancellationAdminApprovedAt = now;
      target.cancellationAdminApprovedBy = actor.id;
    }

    return target;
  }

  const now = new Date().toISOString();
  const payload = {
    status: 'cancelled',
    cancelled_at: now,
    cancelled_by: actor?.id ?? null,
    cancellation_request_reason:
      actor?.role === 'admin'
        ? 'Cancelamento direto efetuado por gerente.'
        : actor?.role === 'evaluator'
          ? 'Cancelamento direto efetuado por avaliador.'
          : undefined,
  };
  if (actor?.role === 'admin') {
    payload.cancellation_admin_approved_at = now;
    payload.cancellation_admin_approved_by = actor.id;
  } else if (actor?.role === 'evaluator') {
    payload.cancellation_evaluator_approved_at = now;
    payload.cancellation_evaluator_approved_by = actor.id;
  }

  // FALLBACK: primeiro tenta RLS direto (policies UPDATE appointments_final permitem ao owner/seller/avaliador/admin).
  // Só chama a Edge como último recurso se a RLS bloquear.
  let updatedViaSdk = false;
  try {
    const { data, error } = await supabase
      .from('appointments')
      .update(payload)
      .eq('id', appointmentId)
      .select()
      .single();
    if (!error && data) {
      return mapAppointmentRecord(data);
    }
    if (error) {
      const code = String(error.code ?? '').toLowerCase();
      const msg = String(error.message ?? '').toLowerCase();
      const blockRls = code === '42501' || msg.includes('row-level security') || msg.includes('permission denied');
      if (!blockRls) {
        throw getFriendlyError(error);
      }
      // segue para edge function
    }
  } catch (sdkErr) {
    const friendly = getFriendlyError(sdkErr);
    const msg = String(friendly?.message ?? '').toLowerCase();
    if (!msg.includes('permissão') && !msg.includes('permission denied') && !msg.includes('42501')) {
      throw friendly;
    }
  }

  try {
    await callUserAdminActions({
      action: 'cancel-appointment',
      appointmentId,
      reason: actor?.role === 'admin'
        ? 'Cancelamento direto efetuado por gerente.'
        : actor?.role === 'evaluator'
          ? 'Cancelamento direto efetuado por avaliador.'
          : undefined,
    });
    updatedViaSdk = true;
  } catch (invokeErr) {
    const errMsg = String(invokeErr?.message ?? '').toLowerCase();
    const isUnknownAction = errMsg.includes('ação inválida') || errMsg.includes('aca(c̃)o inva(lida|lida)') || errMsg.includes('action inv') || invokeErr?.status === 400;
    if (!isUnknownAction) {
      throw getFriendlyError(invokeErr);
    }
  }

  const { data, error } = await supabase
    .from('appointments')
    .select()
    .eq('id', appointmentId)
    .single();
  if (error) {
    if (!updatedViaSdk) {
      // nem RLS nem Edge funcionaram - propaga erro
      throw getFriendlyError(error);
    }
    // ignore erro de fetch final
  }
  return data ? mapAppointmentRecord(data) : null;
}

export async function deleteAppointment(appointmentId, actor) {
  assertMutableAppointmentId(appointmentId, 'excluir');
  if (!actor?.role || actor.role !== 'admin') {
    throw new Error('A exclusão de agendamentos é permitida apenas para gerentes.');
  }

  if (!hasSupabaseCredentials || !supabase) {
    const index = mockAppointments.findIndex((item) => item.id === appointmentId);
    if (index >= 0) {
      mockAppointments.splice(index, 1);
      return true;
    }
    throw new Error('Agendamento não encontrado.');
  }

  const { error } = await supabase
    .from('appointments')
    .delete()
    .eq('id', appointmentId);

  if (error) {
    throw getFriendlyError(error);
  }

  return true;
}

export async function requestCancellationApproval(appointmentId, actor, reason = '') {
  assertMutableAppointmentId(appointmentId, 'solicitar cancelamento');
  if (!reason || reason.trim().length < 3) {
    throw new Error('Informe o motivo do cancelamento antes de prosseguir.');
  }

  if (!hasSupabaseCredentials || !supabase) {
    const target = mockAppointments.find((item) => item.id === appointmentId);

    if (!target) {
      throw new Error('Agendamento não encontrado.');
    }

    target.cancellationRequestedAt = new Date().toISOString();
    target.cancellationRequestedBy = actor.id;
    target.cancellationRequestReason = reason || null;
    target.cancellationAdminApprovedAt = null;
    target.cancellationAdminApprovedBy = null;
    target.cancellationEvaluatorApprovedAt = null;
    target.cancellationEvaluatorApprovedBy = null;
    return target;
  }

  const reqPayload = {
    cancellation_requested_at: new Date().toISOString(),
    cancellation_requested_by: actor?.id ?? null,
    cancellation_request_reason: reason || null,
    cancellation_admin_approved_at: null,
    cancellation_admin_approved_by: null,
    cancellation_evaluator_approved_at: null,
    cancellation_evaluator_approved_by: null,
  };

  try {
    const { data, error } = await supabase
      .from('appointments')
      .update(reqPayload)
      .eq('id', appointmentId)
      .select()
      .single();
    if (!error && data) {
      return mapAppointmentRecord(data);
    }
    if (error) {
      const code = String(error.code ?? '').toLowerCase();
      const msg = String(error.message ?? '').toLowerCase();
      const blockRls = code === '42501' || msg.includes('row-level security') || msg.includes('permission denied');
      if (!blockRls) {
        throw getFriendlyError(error);
      }
    }
  } catch (sdkErr) {
    const friendly = getFriendlyError(sdkErr);
    const msg = String(friendly?.message ?? '').toLowerCase();
    if (!msg.includes('permissão') && !msg.includes('permission denied') && !msg.includes('42501')) {
      throw friendly;
    }
  }

  try {
    await callUserAdminActions({
      action: 'request-cancellation',
      appointmentId,
      reason,
    });
  } catch (invokeErr) {
    const errMsg = String(invokeErr?.message ?? '').toLowerCase();
    const isUnknownAction = errMsg.includes('ação inválida') || errMsg.includes('aca(c̃)o inva(lida|lida)') || errMsg.includes('action inv') || invokeErr?.status === 400;
    if (!isUnknownAction) {
      throw getFriendlyError(invokeErr);
    }
  }

  const { data, error } = await supabase
    .from('appointments')
    .select()
    .eq('id', appointmentId)
    .single();
  if (error) throw getFriendlyError(error);
  return data ? mapAppointmentRecord(data) : null;
}

export async function approveCancellationRequest(appointmentId, actor) {
  assertMutableAppointmentId(appointmentId, 'aprovar cancelamento');
  if (!actor?.role || !['admin', 'evaluator'].includes(actor.role)) {
    throw new Error('A aprovação de cancelamento é permitida apenas para gerente ou avaliador.');
  }

  if (!hasSupabaseCredentials || !supabase) {
    const target = mockAppointments.find((item) => item.id === appointmentId);

    if (!target) {
      throw new Error('Agendamento não encontrado.');
    }

    if (!target.cancellationRequestedAt) {
      throw new Error('Este agendamento ainda não possui solicitação de cancelamento.');
    }

    const now = new Date().toISOString();
    if (actor.role === 'admin') {
      target.cancellationAdminApprovedAt = target.cancellationAdminApprovedAt ?? now;
      target.cancellationAdminApprovedBy = target.cancellationAdminApprovedBy ?? actor.id;
    }

    if (actor.role === 'evaluator') {
      target.cancellationEvaluatorApprovedAt = target.cancellationEvaluatorApprovedAt ?? now;
      target.cancellationEvaluatorApprovedBy = target.cancellationEvaluatorApprovedBy ?? actor.id;
    }

    if (target.cancellationAdminApprovedAt || target.cancellationEvaluatorApprovedAt) {
      target.status = 'cancelled';
      target.cancelledAt = target.cancelledAt ?? now;
      target.cancelledBy = target.cancelledBy ?? actor.id;
      target.cancellationReason = target.cancellationReason ?? target.cancellationRequestReason ?? 'Cancelamento aprovado.';
    }

    return target;
  }

  const now = new Date().toISOString();
  const baseUpdate = { status: 'cancelled', cancelled_at: now, cancelled_by: actor?.id ?? null };
  if (actor.role === 'admin') {
    baseUpdate.cancellation_admin_approved_at = now;
    baseUpdate.cancellation_admin_approved_by = actor.id;
  } else if (actor.role === 'evaluator') {
    baseUpdate.cancellation_evaluator_approved_at = now;
    baseUpdate.cancellation_evaluator_approved_by = actor.id;
  }

  try {
    const { data, error } = await supabase
      .from('appointments')
      .update(baseUpdate)
      .eq('id', appointmentId)
      .select()
      .single();
    if (!error && data) {
      return mapAppointmentRecord(data);
    }
    if (error) {
      const code = String(error.code ?? '').toLowerCase();
      const msg = String(error.message ?? '').toLowerCase();
      const blockRls = code === '42501' || msg.includes('row-level security') || msg.includes('permission denied');
      if (!blockRls) {
        throw getFriendlyError(error);
      }
    }
  } catch (sdkErr) {
    const friendly = getFriendlyError(sdkErr);
    const msg = String(friendly?.message ?? '').toLowerCase();
    if (!msg.includes('permissão') && !msg.includes('permission denied') && !msg.includes('42501')) {
      throw friendly;
    }
  }

  try {
    await callUserAdminActions({
      action: 'approve-cancellation',
      appointmentId,
    });
  } catch (invokeErr) {
    const errMsg = String(invokeErr?.message ?? '').toLowerCase();
    const isUnknownAction = errMsg.includes('ação inválida') || errMsg.includes('aca(c̃)o inva(lida|lida)') || errMsg.includes('action inv') || invokeErr?.status === 400;
    if (!isUnknownAction) {
      throw getFriendlyError(invokeErr);
    }
  }

  const { data, error } = await supabase
    .from('appointments')
    .select()
    .eq('id', appointmentId)
    .single();
  if (error) throw getFriendlyError(error);
  return data ? mapAppointmentRecord(data) : null;
}

export async function finalizeAppointment(appointmentId, actor, finalizePayload = {}) {
  assertMutableAppointmentId(appointmentId, 'finalizar laudo');
  const { result, rejectionReason, laudoFileUrl, laudoFileName } = finalizePayload;
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const logFinalize = (stage, extra = {}) => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    console.info('[finalizeAppointment]', {
      stage,
      appointmentId,
      elapsedMs: Math.round(now - startedAt),
      ...extra,
    });
  };

  if (!result || !['approved', 'rejected'].includes(result)) {
    throw new Error('Informe se o laudo foi aprovado ou reprovado.');
  }

  if (result === 'rejected' && (!rejectionReason || rejectionReason.trim().length < 3)) {
    throw new Error('Informe o motivo da reprovação antes de finalizar.');
  }

  if (!hasSupabaseCredentials || !supabase) {
    const target = mockAppointments.find((item) => item.id === appointmentId);

    if (!target) {
      throw new Error('Agendamento não encontrado.');
    }

    target.status = 'completed';
    target.laudoResult = result;
    target.laudoRejectionReason = result === 'rejected' ? rejectionReason : null;
    target.laudoFileUrl = laudoFileUrl || target.laudoFileUrl || null;
    target.laudoFileName = laudoFileName || target.laudoFileName || null;
    target.laudoFinalizedAt = new Date().toISOString();
    target.laudoFinalizedBy = actor?.id ?? null;
    return target;
  }

  const now = new Date().toISOString();
  const updatePayload = {
    status: 'completed',
    laudo_result: result,
    laudo_rejection_reason: result === 'rejected' ? rejectionReason : null,
    laudo_finalized_at: now,
    laudo_finalized_by: actor?.id ?? null,
  };

  const normalizedLaudoFileUrl = (() => {
    if (!laudoFileUrl) return null;
    if (typeof laudoFileUrl !== 'string') return null;
    const trimmed = laudoFileUrl.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('data:')) {
      return trimmed;
    }
    return null;
  })();

  if (normalizedLaudoFileUrl?.startsWith('data:') && normalizedLaudoFileUrl.length > MAX_INLINE_LAUDO_DATA_URL_CHARS) {
    logFinalize('reject_inline_data_url', { chars: normalizedLaudoFileUrl.length });
    throw new Error(
      'Anexo em Base64 grande demais para gravar no banco. Conclua o upload no Storage (ou use uma URL https) e finalize sem reenviar o arquivo embutido.',
    );
  }

  if (normalizedLaudoFileUrl) {
    updatePayload.laudo_file_url = normalizedLaudoFileUrl;
  }
  if (laudoFileName && typeof laudoFileName === 'string' && laudoFileName.trim()) {
    updatePayload.laudo_file_name = laudoFileName.trim();
  }

  const hasInlineDataUrl = Boolean(normalizedLaudoFileUrl?.startsWith('data:'));
  // data: URLs devem ir pela Edge só se forem pequenas; preferir não tentar SDK com payload pesado.
  const skipSdk = hasInlineDataUrl;

  // FALLBACK 3 CAMADAS (igual cancelamento):
  // (1) SDK direto via RLS, (2) se 42501/timeout cai Edge, (3) select final
  let sdkSuccess = false;
  if (!skipSdk) {
    logFinalize('sdk_update_start');
    try {
      const { data, error } = await supabase
        .from('appointments')
        .update(updatePayload)
        .eq('id', appointmentId)
        .select('id, status, laudo_result, laudo_finalized_at, laudo_file_url, laudo_file_name')
        .single();
      if (!error && data) {
        logFinalize('sdk_update_ok');
        return mapAppointmentRecord(data);
      }
      if (error) {
        const code = String(error.code ?? '').toLowerCase();
        const msg = String(error.message ?? '').toLowerCase();
        const blockRls = code === '42501' || msg.includes('row-level security') || msg.includes('permission denied');
        const isTimeout = msg.includes('timeout') || msg.includes('canceling statement');
        logFinalize('sdk_update_error', { code, msg: String(error.message ?? '').slice(0, 160), blockRls, isTimeout });
        if (!blockRls && !isTimeout) {
          throw getFriendlyError(error);
        }
        // RLS ou timeout: tenta Edge
      }
    } catch (sdkErr) {
      const friendly = getFriendlyError(sdkErr);
      const msg = String(friendly?.message ?? '').toLowerCase();
      const isTimeout = msg.includes('timeout') || msg.includes('canceling statement') || msg.includes('30 segundos');
      logFinalize('sdk_update_exception', { msg: String(friendly?.message ?? '').slice(0, 160), isTimeout });
      if (
        !msg.includes('permissão') &&
        !msg.includes('permission denied') &&
        !msg.includes('42501') &&
        !isTimeout
      ) {
        throw friendly;
      }
    }
  } else {
    logFinalize('sdk_skipped_inline_data_url');
  }

  try {
    logFinalize('edge_finalize_start', { hasFileUrl: Boolean(normalizedLaudoFileUrl) });
    await callUserAdminActions({
      action: 'finalize-appointment',
      appointmentId,
      result,
      rejectionReason: result === 'rejected' ? rejectionReason : undefined,
      laudoFileUrl: normalizedLaudoFileUrl ?? undefined,
      laudoFileName: laudoFileName && typeof laudoFileName === 'string' ? laudoFileName.trim() : undefined,
    });
    sdkSuccess = true;
    logFinalize('edge_finalize_ok');
  } catch (invokeErr) {
    const errMsg = String(invokeErr?.message ?? '').toLowerCase();
    const isUnknownAction = errMsg.includes('ação inválida') || errMsg.includes('aca(c̃)o inva(lida|lida)') || errMsg.includes('action inv') || invokeErr?.status === 400;
    logFinalize('edge_finalize_error', { msg: String(invokeErr?.message ?? '').slice(0, 160) });
    if (!isUnknownAction) {
      throw getFriendlyError(invokeErr);
    }
    // edge antiga sem action: ignora, tenta .select() final abaixo
  }

  const { data, error } = await supabase
    .from('appointments')
    .select('id, status, laudo_result, laudo_finalized_at, laudo_file_url, laudo_file_name, appointment_date, appointment_time, customer_name, customer_phone, customer_cpf, customer_zip_code, customer_email, customer_address, seller_name, seller_email, vehicle_plate, vehicle_model, vehicle_year, notes, company_id, created_by, is_voucher, is_encaixe, cancellation_requested_at, cancellation_requested_by, cancellation_request_reason')
    .eq('id', appointmentId)
    .single();
  if (error) {
    if (!sdkSuccess) throw getFriendlyError(error);
    // se edge deu certo: retorna null, mas a operação foi concluída
    return null;
  }
  return data ? mapAppointmentRecord(data) : null;
}

export async function approveVoucher(appointmentId, actor) {
  assertMutableAppointmentId(appointmentId, 'aprovar voucher');
  if (!actor?.role || actor.role !== 'admin') {
    throw new Error('A aprovação de voucher é permitida apenas para gerentes.');
  }

  if (!hasSupabaseCredentials || !supabase) {
    const target = mockAppointments.find((item) => item.id === appointmentId);

    if (!target) {
      throw new Error('Agendamento não encontrado.');
    }

    target.voucherApprovedAt = new Date().toISOString();
    target.voucherApprovedBy = actor.id;
    return target;
  }

  const now = new Date().toISOString();
  const updatePayload = {
    voucher_approved_at: now,
    voucher_approved_by: actor.id,
  };

  // FALLBACK 3 CAMADAS:
  let sdkSuccess = false;
  try {
    const { data, error } = await supabase
      .from('appointments')
      .update(updatePayload)
      .eq('id', appointmentId)
      .select()
      .single();
    if (!error && data) {
      return mapAppointmentRecord(data);
    }
    if (error) {
      const code = String(error.code ?? '').toLowerCase();
      const msg = String(error.message ?? '').toLowerCase();
      const blockRls = code === '42501' || msg.includes('row-level security') || msg.includes('permission denied');
      if (!blockRls) {
        throw getFriendlyError(error);
      }
    }
  } catch (sdkErr) {
    const friendly = getFriendlyError(sdkErr);
    const msg = String(friendly?.message ?? '').toLowerCase();
    if (!msg.includes('permissão') && !msg.includes('permission denied') && !msg.includes('42501')) {
      throw friendly;
    }
  }

  try {
    await callUserAdminActions({
      action: 'approve-voucher',
      appointmentId,
    });
    sdkSuccess = true;
  } catch (invokeErr) {
    const errMsg = String(invokeErr?.message ?? '').toLowerCase();
    const isUnknownAction = errMsg.includes('ação inválida') || errMsg.includes('aca(c̃)o inva(lida|lida)') || errMsg.includes('action inv') || invokeErr?.status === 400;
    if (!isUnknownAction) {
      throw getFriendlyError(invokeErr);
    }
  }

  const { data, error } = await supabase
    .from('appointments')
    .select()
    .eq('id', appointmentId)
    .single();
  if (error) {
    if (!sdkSuccess) throw getFriendlyError(error);
    return null;
  }
  return data ? mapAppointmentRecord(data) : null;
}

export async function getCompanyProfiles() {
  if (!hasSupabaseCredentials || !supabase) {
    return {
      items: [
        { id: 'company-owner-demo', fullName: 'Administrador Demo', email: 'admin@demo.com', role: 'admin', approvalStatus: 'approved', isActive: true, createdAt: new Date().toISOString(), requestedAt: new Date().toISOString() },
        { id: 'seller-demo-1', fullName: 'Vendedor Demo 1', email: 'vendedor1@demo.com', role: 'seller', approvalStatus: 'approved', isActive: true, createdAt: new Date().toISOString(), requestedAt: new Date().toISOString() },
        { id: 'seller-demo-2', fullName: 'Vendedor Demo 2', email: 'vendedor2@demo.com', role: 'seller', approvalStatus: 'approved', isActive: true, createdAt: new Date().toISOString(), requestedAt: new Date().toISOString() },
        { id: 'seller-pending-1', fullName: 'Carlos Novo Vendedor', email: 'carlos@exemplo.com', role: 'seller', approvalStatus: 'pending', isActive: true, createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(), requestedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString() },
      ],
      source: 'mock',
    };
  }

  const { data, error } = await supabase
    .rpc('get_profiles_of_my_company');

  if (error) {
    throw getFriendlyError(error);
  }

  return {
    items: (data || []).map((item) => ({
      id: item.id,
      fullName: item.full_name,
      email: item.email,
      role: item.role,
      approvalStatus: item.approval_status ?? 'approved',
      isActive: item.is_active !== false,
      createdAt: item.created_at,
      requestedAt: item.requested_at ?? item.created_at,
    })),
    source: 'supabase',
  };
}

export async function getActiveSellers() {
  if (!hasSupabaseCredentials || !supabase) {
    return {
      items: [
        { id: 'seller-demo-1', fullName: 'Vendedor Demo 1', email: 'vendedor1@demo.com' },
        { id: 'seller-demo-2', fullName: 'Vendedor Demo 2', email: 'vendedor2@demo.com' },
      ],
      source: 'mock',
    };
  }

  const { data, error } = await supabase.rpc('get_active_sellers_of_my_company');
  if (error) {
    throw getFriendlyError(error);
  }

  const sellers = (data || [])
    .map((item) => ({
      id: item.id,
      fullName: item.full_name,
      email: item.email,
      role: 'seller',
      approvalStatus: 'approved',
      isActive: true,
    }))
    .filter((p) => Boolean(p.email));

  sellers.sort((a, b) => String(a.fullName || '').localeCompare(String(b.fullName || ''), 'pt-BR'));
  return { items: sellers, source: 'supabase' };
}

function validateSellerInfo(payload, { allowNull = false } = {}) {
  if (allowNull && !payload.sellerEmail && !payload.sellerName) {
    return;
  }
  const email = String(payload.sellerEmail ?? '').trim().toLowerCase();
  const name = String(payload.sellerName ?? '').trim();
  if (!email || email.length < 5 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Selecione um vendedor valido para este agendamento (vendedor ativo e aprovado da loja). O campo vendedor nao pode ficar em branco.');
  }
  if (!name || name.length < 2) {
    throw new Error('Nome do vendedor muito curto. Selecione um vendedor da lista.');
  }
  payload.sellerEmail = email;
  payload.sellerName = name;
}

export async function createSellerUser(payload) {
  if (!hasSupabaseCredentials || !supabase) {
    return {
      success: true,
      message: 'Usuário criado no modo demonstração.',
    };
  }

  if (!payload.companyId) {
    throw new Error('Usuário logado não possui empresa vinculada.');
  }

  const targetRole = payload.role === 'evaluator' ? 'evaluator' : 'seller';

  // IMPORTANTE: USAMOS fetch() NATIVO AO INVES DE supabase.functions.invoke()
  // Motivo: SDK retorna mensagem generica "Edge Function returned a non-2xx
  // status code" e esconde o erro REAL do backend.
  const baseUrl = String(import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '');
  const anonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? '');
  const bearerToken = (await _getSessionBearerToken()) ?? anonKey;
  const endpoint = `${baseUrl}/functions/v1/create-seller`;
  const rawBody = JSON.stringify({
    email: payload.email,
    password: payload.password,
    fullName: payload.fullName,
    companyId: payload.companyId,
    role: targetRole,
  });

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'apikey': anonKey,
        'Authorization': `Bearer ${bearerToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: rawBody,
    });
  } catch (networkErr) {
    const msg = networkErr && networkErr.message ? networkErr.message : 'Sem conexao com a internet.';
    if (msg.toLowerCase().includes('cors') || msg.toLowerCase().includes('blocked') || msg.toLowerCase().includes('network')) {
      throw new Error('Nao foi possivel se comunicar com o servidor. Verifique sua internet e tente novamente em 10 segundos.');
    }
    throw new Error(`Falha de comunicacao: ${msg}`);
  }

  const statusCode = response.status;
  let responseText = '';
  try { responseText = await response.text(); } catch (_r) { /* ignora */ }

  let data;
  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch (_parseErr) {
    data = { raw: responseText };
  }

  if (!response.ok) {
    let backendMsg = (data && data.error) ? data.error : (data && data.message ? data.message : null);
    if (!backendMsg && typeof data === 'string') backendMsg = data;
    if (!backendMsg && responseText) backendMsg = responseText.slice(0, 600);

    let friendly = backendMsg ?? `Nao foi possivel criar a conta. (HTTP ${statusCode})`;
    if (statusCode === 401) friendly = backendMsg || 'Sessao expirou. Faca login novamente antes de criar usuarios.';
    if (statusCode === 403) friendly = backendMsg || 'Voce nao tem permissao para criar usuarios nesta loja.';
    if (statusCode === 404) friendly = backendMsg || 'A funcao create-seller nao esta deployada. Acesse Supabase -> Edge Functions e faca o deploy.';
    if (statusCode === 409) friendly = backendMsg || 'Este e-mail ja esta cadastrado. Verifique a lista de usuarios ou peca para ele recuperar a senha.';
    if (statusCode === 422) friendly = backendMsg || 'Dados do usuario invalidos. Verifique o e-mail e a senha (min 6 caracteres).';
    if (statusCode >= 500) friendly = (backendMsg || `Erro interno no servidor (HTTP ${statusCode}). Verifique os logs da funcao create-seller no Supabase Dashboard -> Edge Functions -> Logs.`);
    if (typeof friendly === 'string' && friendly.toLowerCase().includes('edge function returned a non-2xx status code')) {
      friendly = backendMsg ?? `Nao foi possivel criar a conta (HTTP ${statusCode}).`;
    }
    throw new Error(friendly);
  }

  if (data && data.error) {
    throw new Error(data.error);
  }

  if (data && !data.userId) {
    throw new Error(data.message ?? 'Não foi possível criar a conta do vendedor.');
  }

  if (data && !data.profileCreated) {
    try {
      await supabase
        .from('profiles')
        .upsert({
          id: data.userId,
          company_id: payload.companyId,
          full_name: payload.fullName,
          role: targetRole,
          approval_status: 'approved',
          is_active: true,
          email: payload.email,
        });
    } catch (e) {
      // Edge já criou o user, avisamos que o perfil ficou manual
    }
  }

  return {
    success: true,
    userId: data.userId,
    message: data.message ?? 'Conta do vendedor criada com sucesso.',
  };
}

export async function resetUserPassword(userId, newPassword) {
  if (!hasSupabaseCredentials || !supabase) {
    return {
      success: true,
      message: 'Senha redefinida no modo demonstração.',
    };
  }

  const data = await callUserAdminActions({
    action: 'reset-password',
    userId,
    newPassword,
  });

  return {
    success: true,
    message: data?.message ?? 'Senha redefinida com sucesso.',
  };
}

export async function changeCurrentUserPassword(currentPassword, newPassword) {
  if (!hasSupabaseCredentials || !supabase) {
    return {
      success: true,
      message: 'Senha alterada no modo demonstração.',
    };
  }

  const { error } = await supabase.auth.updateUser({
    password: newPassword,
  });

  if (error) {
    throw new Error(error.message ?? 'Não foi possível alterar a senha. Verifique sua senha atual.');
  }

  return {
    success: true,
    message: 'Senha alterada com sucesso.',
  };
}

export async function getPublicCompaniesList() {
  const demoCompanies = [
    { id: 'af8c268c-504c-48df-8d82-c50d605992ec', name: 'GWM', slug: 'gwm' },
    { id: '423aa88f-fbbb-4c9f-9cc6-d1adf14fc85b', name: 'Grupo Jorlan', slug: 'grupo-jorlan' },
  ];

  if (!hasSupabaseCredentials || !supabase) {
    return demoCompanies;
  }

  const { data, error } = await supabase
    .from('companies')
    .select('id, name, slug')
    .order('name', { ascending: true });

  if (error) {
    return demoCompanies;
  }

  return (data ?? []).length > 0 ? data : demoCompanies;
}

export async function selfRegisterSeller(payload) {
  if (!payload.fullName || payload.fullName.trim().length < 3) {
    throw new Error('Informe seu nome completo.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
    throw new Error('Informe um e-mail válido.');
  }
  if (!payload.password || payload.password.length < 6) {
    throw new Error('A senha precisa ter pelo menos 6 caracteres.');
  }
  if (!payload.companyId) {
    throw new Error('Selecione a loja onde você trabalha para que o gerente correto aprove seu acesso.');
  }

  if (!hasSupabaseCredentials || !supabase) {
    return {
      success: true,
      message: 'Cadastro solicitado no modo demonstração. Aguarde aprovação.',
    };
  }

  // IMPORTANTE: USAMOS fetch() NATIVO AO INVES DE supabase.functions.invoke()
  // Motivo: quando o usuario NAO ESTA LOGADO (tela de cadastro), o SDK do supabase
  // pode enviar header Authorization vazio, causando erro CORS preflight ou 401
  // e a mensagem generica "Edge Function returned a non-2xx status code".
  // Passando os headers APENAS com a ANON KEY (exatamente como fizemos no POST via
  // PowerShell, que retornou 200 OK), garantimos que sempre funciona.
  const edgeFunctionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/user-admin-actions`;
  const anonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? '');

  const rawBody = JSON.stringify({
    action: 'request-seller-access',
    email: payload.email,
    password: payload.password,
    fullName: payload.fullName,
    companyId: payload.companyId,
  });

  let response;
  try {
    response = await fetch(edgeFunctionUrl, {
      method: 'POST',
      headers: {
        'apikey': anonKey,
        'Authorization': `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: rawBody,
    });
  } catch (networkErr) {
    const msg = networkErr && networkErr.message ? networkErr.message : 'Sem conexao com a internet.';
    if (msg.toLowerCase().includes('cors') || msg.toLowerCase().includes('blocked') || msg.toLowerCase().includes('network')) {
      throw new Error('Nao foi possivel se comunicar com o servidor de cadastro. Verifique sua internet e tente novamente em 10 segundos.');
    }
    throw new Error(`Falha de comunicacao: ${msg}`);
  }

  const statusCode = response.status;
  let responseText = '';
  try {
    responseText = await response.text();
  } catch (_readErr) { /* ignora */ }

  let data;
  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch (_parseErr) {
    data = { raw: responseText };
  }

  if (!response.ok) {
    let backendMsg = (data && data.error) ? data.error : (data && data.message ? data.message : null);
    if (!backendMsg && typeof data === 'string') backendMsg = data;
    if (!backendMsg && responseText) backendMsg = responseText.slice(0, 500);

    let friendly = backendMsg ?? 'Nao foi possivel concluir o cadastro.';
    if (statusCode === 401) friendly = backendMsg || 'Erro de autenticacao na function. Verifique se Verify JWT esta desativado no Supabase -> Edge Functions -> user-admin-actions -> More -> Disable JWT verification.';
    if (statusCode === 404) friendly = backendMsg || 'A function user-admin-actions nao existe. Faca o deploy primeiro.';
    if (statusCode === 409) friendly = backendMsg || 'Esse e-mail ja esta cadastrado no sistema. Use a tela de login ou recupere sua senha.';
    if (statusCode === 500) friendly = (backendMsg || 'Erro interno no servidor de cadastro. Verifique os logs no Supabase Dashboard -> Edge Functions -> user-admin-actions -> Logs.');
    if (statusCode >= 502 && statusCode <= 504) friendly = 'Servidor do Supabase em manutencao. Aguarde 30 segundos e tente novamente.';
    if (typeof friendly === 'string' && friendly.toLowerCase().includes('edge function returned a non-2xx status code')) {
      friendly = backendMsg ?? 'Nao foi possivel concluir o cadastro. Tente novamente em 30 segundos.';
    }
    throw new Error(friendly);
  }

  if (data?.error) {
    throw new Error(data.error);
  }
  if (!data?.success) {
    throw new Error(data?.message ?? 'Não foi possível concluir o cadastro.');
  }

  return {
    success: true,
    userId: data.userId,
    message:
      data.message ??
      'Cadastro enviado! O gerente da sua loja já recebeu a solicitação de aprovação.',
  };
}

export async function approvePendingProfile(userId) {
  if (!hasSupabaseCredentials || !supabase) {
    return {
      success: true,
      message: 'Usuário aprovado no modo demonstração.',
    };
  }

  const data = await callUserAdminActions({
    action: 'approve-profile',
    userId,
  });

  return {
    success: true,
    message: data?.message ?? 'Usuário aprovado. Ele já pode entrar normalmente.',
  };
}

export async function rejectPendingProfile(userId) {
  if (!hasSupabaseCredentials || !supabase) {
    return {
      success: true,
      message: 'Usuário recusado no modo demonstração.',
    };
  }

  const data = await callUserAdminActions({
    action: 'reject-profile',
    userId,
  });

  return {
    success: true,
    message: data?.message ?? 'Cadastro recusado.',
  };
}

export async function toggleActiveProfile(userId, newActiveState) {
  if (!hasSupabaseCredentials || !supabase) {
    return {
      success: true,
      message: newActiveState
        ? 'Usuário ativado no modo demonstração.'
        : 'Usuário desativado no modo demonstração.',
    };
  }

  const data = await callUserAdminActions({
    action: 'toggle-active',
    userId,
    newActiveState: Boolean(newActiveState),
  });

  return {
    success: true,
    message:
      data?.message ??
      (newActiveState
        ? 'Login reativado. O usuário já pode acessar normalmente.'
        : 'Login desativado. O usuário não conseguirá mais entrar até ser reativado.'),
  };
}

export async function deleteUser(userId) {
  if (!hasSupabaseCredentials || !supabase) {
    return {
      success: true,
      message: 'Usuário excluído do modo demonstração.',
    };
  }

  const data = await callUserAdminActions({
    action: 'delete-user',
    userId,
  });

  return {
    success: true,
    message: data?.message ?? 'Usuário e seus dados de autenticação foram excluídos permanentemente.',
  };
}
