// ================================================================
// INLINE_user-admin-actions.ts — Versão PARA COLAR NO EDITOR INLINE
// DO SUPABASE (Dashboard → Edge Functions → user-admin-actions → Edit)
//
// NÃO TEM IMPORTS DE _shared/ (não funciona no Editor Inline).
// Todo o CORS está embutido aqui.
//
// Inclui a ação "delete-user" adicionada recentemente.
// ================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

function isEmail(e) {
  return typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}
function isUuid(s) {
  return typeof s === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}
function ok(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}
function err(msg, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    const supabaseUrl          = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabaseAnonKey      = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

    const admin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const authHeader = req.headers.get('Authorization') ?? '';
    const bearer     = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const callerClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: bearer ? { headers: { Authorization: authHeader } } : undefined,
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? '').trim();

    // ========== ACAO 1: request-seller-access (ANONIMO permitido - qualquer pessoa pode solicitar) =====
    if (action === 'request-seller-access') {
      const email     = body.email;
      const password  = body.password;
      const fullName  = body.fullName;
      const companyId = body.companyId;

      if (!isEmail(email))                 return err('Informe um email valido.');
      if (typeof password !== 'string' || password.length < 6) return err('Senha precisa ter pelo menos 6 caracteres.');
      if (typeof fullName !== 'string' || fullName.trim().length < 3) return err('Informe seu nome completo.');
      if (!isUuid(companyId))              return err('Selecione a loja onde voce trabalha.');
      const { count } = await admin.from('companies').select('*', { count: 'exact', head: true }).eq('id', companyId);
      if (!count)                          return err('Loja selecionada nao existe.');

      const { data: authData, error: authErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: fullName.trim(),
          role: 'seller',
          company_id: companyId,
        },
      });
      if (authErr || !authData?.user?.id) {
        return err((authErr && authErr.message) ? authErr.message : 'Nao foi possivel concluir o cadastro. Email ja pode estar cadastrado.', 409);
      }

      const { error: profileErr } = await admin.from('profiles').upsert(
        {
          id: authData.user.id,
          email,
          company_id: companyId,
          approval_status: 'pending',
          requested_at: new Date().toISOString(),
          role: 'seller',
          full_name: fullName.trim(),
          is_active: true,
        },
        { onConflict: 'id' },
      );
      if (profileErr) {
        try { await admin.auth.admin.deleteUser(authData.user.id); } catch (_e) { /* ignora cleanup */ }
        return err((profileErr && profileErr.message) ? profileErr.message : 'Erro ao salvar perfil. Tente novamente.', 500);
      }

      return ok({
        success: true,
        userId: authData.user.id,
        profileCreated: true,
        message: 'Cadastro enviado! O gerente da sua loja ja recebeu a solicitacao de aprovacao.',
      });
    }

    // ========== TODAS AS OUTRAS ACOES EXIGEM CHAMADOR LOGADO + ADMIN =================================
    if (!bearer) return err('Autenticacao necessaria.', 401);
    const { data: { user: callerUser }, error: callerErr } = await callerClient.auth.getUser();
    if (callerErr || !callerUser) return err('Token invalido ou expirado.', 401);

    const { data: callerProfile } = await admin
      .from('profiles')
      .select('id, role, company_id')
      .eq('id', callerUser.id)
      .single();
    if (!callerProfile) return err('Perfil nao encontrado.', 404);
    if (callerProfile.role !== 'admin') return err('Apenas gerentes podem executar essa acao.', 403);
    const adminCompanyId = callerProfile.company_id;

    async function assertSameCompany(targetUserId) {
      const { data: target } = await admin
        .from('profiles').select('company_id').eq('id', targetUserId).maybeSingle();
      if (!target) return false;
      return String(target.company_id) === String(adminCompanyId);
    }

    // ========== ACAO 2: reset-password ================================================================
    if (action === 'reset-password') {
      const userId     = body.userId;
      const newPassword = body.newPassword;
      if (!isUuid(userId))                 return err('Usuario invalido.');
      if (typeof newPassword !== 'string' || newPassword.length < 6) return err('Nova senha precisa ter pelo menos 6 caracteres.');
      if (!await assertSameCompany(userId)) return err('Voce nao tem permissao sobre esse usuario.', 403);

      const { error: upErr } = await admin.auth.admin.updateUserById(userId, {
        password: newPassword,
      });
      if (upErr) return err((upErr && upErr.message) ? upErr.message : 'Nao foi possivel redefinir a senha.', 500);

      await admin.auth.admin.updateUserById(userId, { email_confirm: true }).catch(() => {});

      return ok({ success: true, message: 'Senha redefinida com sucesso. Avise o novo valor ao vendedor.' });
    }

    // ========== ACAO 3: approve-profile ==============================================================
    if (action === 'approve-profile') {
      const userId = body.userId;
      if (!isUuid(userId)) return err('Usuario invalido.');
      if (!await assertSameCompany(userId)) return err('Voce nao tem permissao sobre esse usuario.', 403);

      const { error: upErr } = await admin
        .from('profiles')
        .update({ approval_status: 'approved', is_active: true })
        .eq('id', userId);
      if (upErr) return err((upErr && upErr.message) ? upErr.message : 'Erro ao aprovar.', 500);

      await admin.auth.admin.updateUserById(userId, { email_confirm: true }).catch(() => {});

      return ok({ success: true, message: 'Usuario aprovado. Ele ja pode entrar normalmente.' });
    }

    // ========== ACAO 4: reject-profile ===============================================================
    if (action === 'reject-profile') {
      const userId = body.userId;
      if (!isUuid(userId)) return err('Usuario invalido.');
      if (!await assertSameCompany(userId)) return err('Voce nao tem permissao sobre esse usuario.', 403);

      const { error: upErr } = await admin
        .from('profiles')
        .update({ approval_status: 'rejected', is_active: false })
        .eq('id', userId);
      if (upErr) return err((upErr && upErr.message) ? upErr.message : 'Erro ao recusar.', 500);

      return ok({ success: true, message: 'Cadastro recusado.' });
    }

    // ========== ACAO 5: toggle-active ================================================================
    if (action === 'toggle-active') {
      const userId       = body.userId;
      const newIsActive  = Boolean(body.newActiveState);
      if (!isUuid(userId)) return err('Usuario invalido.');
      if (!await assertSameCompany(userId)) return err('Voce nao tem permissao sobre esse usuario.', 403);

      const { error: upErr } = await admin
        .from('profiles')
        .update({ is_active: newIsActive })
        .eq('id', userId);
      if (upErr) return err((upErr && upErr.message) ? upErr.message : 'Erro ao alterar status.', 500);

      try {
        if (!newIsActive) {
          await admin.auth.admin.updateUserById(userId, { ban_duration: '2000000d' });
        } else {
          await admin.auth.admin.updateUserById(userId, { ban_duration: '0' });
          await admin.auth.admin.updateUserById(userId, { email_confirm: true });
        }
      } catch (_e) { /* ignora */ }

      return ok({
        success: true,
        message: newIsActive
          ? 'Login reativado. O usuario ja pode acessar normalmente.'
          : 'Login desativado. O usuario nao conseguira mais entrar ate ser reativado.',
      });
    }

    // ========== ACAO 6: delete-user (apenas ADMIN pode excluir auth.users + profile) =================
    if (action === 'delete-user') {
      const userId = body.userId;
      if (!isUuid(userId)) return err('Usuario invalido.');
      if (!await assertSameCompany(userId)) return err('Voce nao tem permissao sobre esse usuario.', 403);

      try {
        await admin.from('profiles').delete().eq('id', userId);
      } catch (e) { /* ignora - pode ja ter sido apagado */ }

      const { error: delErr } = await admin.auth.admin.deleteUser(userId);
      if (delErr) return err((delErr && delErr.message) ? delErr.message : 'Nao foi possivel excluir o usuario.', 500);

      return ok({ success: true, message: 'Usuario e seus dados de autenticacao foram excluidos permanentemente.' });
    }

    // ========== ACAO 7: cancel-appointment (admin OU evaluator cancela DIRETAMENTE) =================
    if (action === 'cancel-appointment') {
      const appointmentId = body.appointmentId;
      const reason = body.reason;

      if (!isUuid(appointmentId)) return err('Agendamento invalido.');
      const callerRole = String(callerProfile.role ?? '');
      if (callerRole !== 'admin' && callerRole !== 'evaluator') {
        return err('Apenas gerentes ou avaliadores podem cancelar diretamente.', 403);
      }

      const { data: appt, error: fetchErr } = await admin
        .from('appointments')
        .select('id, company_id, status, cancellation_request_reason, cancellation_admin_approved_at, cancellation_evaluator_approved_at')
        .eq('id', appointmentId)
        .single();
      if (fetchErr || !appt) return err('Agendamento nao encontrado.', 404);
      if (String(appt.company_id) !== String(adminCompanyId)) return err('Esse agendamento nao pertence a sua empresa.', 403);
      if (appt.status === 'cancelled') {
        return ok({ success: true, alreadyCancelled: true, message: 'Agendamento ja estava cancelado.' });
      }

      const now = new Date().toISOString();
      const finalReason = (typeof reason === 'string' && reason.trim())
        ? reason.trim()
        : appt.cancellation_request_reason
          ? appt.cancellation_request_reason
          : callerRole === 'admin'
            ? 'Cancelamento direto efetuado por gerente.'
            : 'Cancelamento direto efetuado por avaliador.';

      const update = {
        status: 'cancelled',
        cancelled_at: now,
        cancelled_by: callerUser.id,
        cancellation_reason: finalReason,
      };
      if (!appt.cancellation_admin_approved_at) {
        update.cancellation_admin_approved_at = now;
        update.cancellation_admin_approved_by = callerUser.id;
      }
      if (!appt.cancellation_evaluator_approved_at) {
        update.cancellation_evaluator_approved_at = now;
        update.cancellation_evaluator_approved_by = callerUser.id;
      }

      const { error: upErr } = await admin
        .from('appointments')
        .update(update)
        .eq('id', appointmentId);
      if (upErr) return err((upErr && upErr.message) ? upErr.message : 'Nao foi possivel cancelar o agendamento.', 500);

      return ok({ success: true, message: 'Horario cancelado com sucesso. O slot ja voltou a ficar disponivel.' });
    }

    // ========== ACAO 8: request-cancellation (vendedor SOLICITA cancelamento) =====================
    if (action === 'request-cancellation') {
      const appointmentId = body.appointmentId;
      const reason = body.reason;

      if (!isUuid(appointmentId)) return err('Agendamento invalido.');
      if (!reason || String(reason).trim().length < 3) {
        return err('Explique o motivo do cancelamento (minimo 3 letras).');
      }

      const { data: appt, error: fetchErr } = await admin
        .from('appointments')
        .select('id, company_id, status, created_by')
        .eq('id', appointmentId)
        .single();
      if (fetchErr || !appt) return err('Agendamento nao encontrado.', 404);
      if (String(appt.company_id) !== String(adminCompanyId)) return err('Esse agendamento nao pertence a sua empresa.', 403);
      if (appt.status !== 'scheduled') return err('Apenas agendamentos agendados podem ser cancelados.', 400);

      const isOwner = String(appt.created_by) === String(callerUser.id);
      const isPrivileged = callerProfile.role === 'admin' || callerProfile.role === 'evaluator';
      if (!isOwner && !isPrivileged) {
        return err('Apenas o vendedor que criou, gerente ou avaliador podem solicitar o cancelamento.', 403);
      }

      const now = new Date().toISOString();
      const { error: upErr } = await admin
        .from('appointments')
        .update({
          cancellation_requested_at: now,
          cancellation_requested_by: callerUser.id,
          cancellation_request_reason: String(reason).trim(),
          cancellation_admin_approved_at: null,
          cancellation_admin_approved_by: null,
          cancellation_evaluator_approved_at: null,
          cancellation_evaluator_approved_by: null,
        })
        .eq('id', appointmentId);
      if (upErr) return err((upErr && upErr.message) ? upErr.message : 'Nao foi possivel registrar a solicitacao.', 500);

      return ok({
        success: true,
        message: 'Solicitacao enviada. Apenas uma aprovacao e necessaria (gerente ou avaliador). Avise o responsavel antes para agilizar.',
      });
    }

    // ========== ACAO 9: approve-cancellation (admin OU evaluator aprova solicitacao) =============
    if (action === 'approve-cancellation') {
      const appointmentId = body.appointmentId;

      if (!isUuid(appointmentId)) return err('Agendamento invalido.');
      if (callerProfile.role !== 'admin' && callerProfile.role !== 'evaluator') {
        return err('Apenas gerentes ou avaliadores podem aprovar cancelamentos.', 403);
      }

      const { data: appt, error: fetchErr } = await admin
        .from('appointments')
        .select('id, company_id, status, cancellation_requested_at, cancellation_request_reason, cancellation_admin_approved_at, cancellation_evaluator_approved_at')
        .eq('id', appointmentId)
        .single();
      if (fetchErr || !appt) return err('Agendamento nao encontrado.', 404);
      if (String(appt.company_id) !== String(adminCompanyId)) return err('Esse agendamento nao pertence a sua empresa.', 403);
      if (appt.status === 'cancelled') {
        return ok({ success: true, alreadyCancelled: true, message: 'Ja estava cancelado.' });
      }

      const now = new Date().toISOString();
      const update = {};
      if (callerProfile.role === 'admin' && !appt.cancellation_admin_approved_at) {
        update.cancellation_admin_approved_at = now;
        update.cancellation_admin_approved_by = callerUser.id;
      }
      if (callerProfile.role === 'evaluator' && !appt.cancellation_evaluator_approved_at) {
        update.cancellation_evaluator_approved_at = now;
        update.cancellation_evaluator_approved_by = callerUser.id;
      }

      const hasAnyApproval = Boolean(
        update.cancellation_admin_approved_at ||
        update.cancellation_evaluator_approved_at ||
        appt.cancellation_admin_approved_at ||
        appt.cancellation_evaluator_approved_at,
      );
      if (hasAnyApproval) {
        update.status = 'cancelled';
        update.cancelled_at = now;
        update.cancelled_by = callerUser.id;
        const fallbackReason = callerProfile.role === 'admin'
          ? 'Cancelamento aprovado por gerente.'
          : 'Cancelamento aprovado por avaliador.';
        update.cancellation_reason = (appt.cancellation_request_reason && String(appt.cancellation_request_reason).trim()) || fallbackReason;
        if (!appt.cancellation_admin_approved_at && !update.cancellation_admin_approved_at) {
          update.cancellation_admin_approved_at = now;
          update.cancellation_admin_approved_by = callerUser.id;
        }
        if (!appt.cancellation_evaluator_approved_at && !update.cancellation_evaluator_approved_at) {
          update.cancellation_evaluator_approved_at = now;
          update.cancellation_evaluator_approved_by = callerUser.id;
        }
      }

      const { error: upErr } = await admin
        .from('appointments')
        .update(update)
        .eq('id', appointmentId);
      if (upErr) return err((upErr && upErr.message) ? upErr.message : 'Nao foi possivel aprovar o cancelamento.', 500);

      return ok({
        success: true,
        message: 'Aprovacao registrada. O cancelamento foi concluido e o horario ja foi liberado.',
      });
    }

    return err('Acao invalida. Escolha: reset-password, approve-profile, reject-profile, toggle-active, delete-user, request-seller-access, cancel-appointment, request-cancellation, approve-cancellation.', 400);

  } catch (e) {
    console.error('user-admin-actions FATAL:', (e && e.message) ? e.message : e);
    return err((e && e.message) ? e.message : 'Erro interno do servidor.', 500);
  }
});
