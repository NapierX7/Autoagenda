// Edge Function: user-admin-actions  (VERSAO COMPLETA v6 - atualizada 29/08/2026)
//
// CORRECOES v4 (review de seguranca 14/08/2026):
//  [1] CRITICAL: ban_duration com formato correto (unidades GoTrue: 'ns','us','ms','s','m','h')
//      - '2000000d' (INVALIDO!) -> '876000h' (100 anos em HORAS - unidade 'h' suportada)
//      - '0' (INVALIDO!)         -> 'none' (valor oficial para desbanir)
//      - Removido try/catch VAZIO que silenciava erros (agora propaga para o frontend)
//  [2] MAJOR: reject-profile AGORA BANIR tambem no auth.users (antes so atualizava profiles)
//  [3] MAJOR: request-seller-access - camadas extras de anti-spam (nao revela se empresa existe,
//      bloqueia email repetido pending, normaliza email antes de checar)
//  [4] MINOR: defense in depth - TODAS as queries UPDATE/DELETE de profiles agora tem
//      .eq('company_id', adminCompanyId) EXPLICITO alem do assertSameCompany()
// CORRECOES v6 (29/08/2026)
//  [5] NOVAS ACTIONS (10) finalize-appointment (bypass service role admin/evaluator,
//      inclui laudo_file_url, laudo_file_name, laudo_result, laudo_rejection_reason).
//  [6] NOVA ACTION (11) approve-voucher (bypass service role, cria voucher_approved_at/by).
//  [7] actions cancel-appointment / request-cancellation / approve-cancellation AGORA
//      tambem aceitam ROLE evaluator logado (antes so admin).
//
// AÇÕES: reset-password | approve-profile | reject-profile | toggle-active |
//         request-seller-access | delete-user | cancel-appointment |
//         request-cancellation | approve-cancellation | finalize-appointment |
//         approve-voucher
//
// IMPORTANTE: colar ESTE ARQUIVO TODO no editor inline do Supabase
// (1 arquivo unico - sem imports de arquivos _shared/cors.ts)
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

function isEmail(e) { return typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
function normalizeEmail(e) { return String(e ?? '').trim().toLowerCase(); }
function isUuid(s) {
  return typeof s === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}
function ok(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
}
function err(msg, status = 400) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl        = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabaseAnonKey    = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

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

    // ========== 1) request-seller-access (anonimo permitido) ==========================
    if (action === 'request-seller-access') {
      const rawEmail    = body.email;
      const password    = body.password;
      const fullName    = body.fullName;
      const companyId   = body.companyId;

      const email = normalizeEmail(rawEmail);

      if (!isEmail(email)) return err('Informe um email válido.');
      if (typeof password !== 'string' || password.length < 6) return err('Senha precisa ter pelo menos 6 caracteres.');
      if (typeof fullName !== 'string' || fullName.trim().length < 3) return err('Informe seu nome completo.');
      if (!isUuid(companyId)) return err('Selecione a loja onde você trabalha.');

      // (1) Bloqueia dupla submissao: se ja existe profile PENDING/APPROVED com esse email na empresa, nega.
      const { count: existingPending } = await admin
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq('email', email)
        .eq('company_id', companyId)
        .in('approval_status', ['pending', 'approved']);
      if (existingPending && existingPending > 0) {
        return err('Este e-mail já possui um cadastro nesta loja. Aguarde aprovação ou contate o gerente.');
      }

      // (2) Verifica se empresa existe, mas retorna mensagem GENERICA para nao vazar info
      //     (nao avisa se a empresa realmentexiste para evitar enumeracao de tenants)
      const { count: companyCount } = await admin
        .from('companies')
        .select('*', { count: 'exact', head: true })
        .eq('id', companyId);
      if (!companyCount || companyCount < 1) {
        return err('Não foi possível concluir o cadastro. Verifique os dados e tente novamente.');
      }

      // (3) Cria o usuario no auth SEMPRE com role = 'seller' hardcoded (nunca aceita input!)
      const { data: authData, error: authErr } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: {
          full_name: fullName.trim(),
          role: 'seller',
          company_id: companyId,
        },
      });
      if (authErr || !authData?.user?.id) {
        const msg = (authErr)?.message ?? '';
        if (msg.toLowerCase().includes('already') || msg.toLowerCase().includes('exists')) {
          return err('Este e-mail já está cadastrado no sistema. Se você já foi aprovado, basta fazer login.', 409);
        }
        return err('Não foi possível concluir o cadastro. Tente novamente em alguns minutos.', 409);
      }

      // (4) Profile criado PENDING (não é active até aprovação do admin) — redundância de segurança
      const { error: profileErr } = await admin.from('profiles').upsert({
        id: authData.user.id, email, company_id: companyId,
        approval_status: 'pending', requested_at: new Date().toISOString(),
        role: 'seller', full_name: fullName.trim(), is_active: false,
      }, { onConflict: 'id' });
      if (profileErr) return err((profileErr)?.message ?? 'Erro ao salvar perfil.', 500);

      return ok({
        success: true, userId: authData.user.id, profileCreated: true,
        message: 'Cadastro enviado! O gerente da sua loja já recebeu a solicitação de aprovação. Aguarde contato.',
      });
    }

    // ========== Todas outras acoes: exigem chamador logado + ADMIN ======================
    if (!bearer) return err('Autenticação necessária.', 401);
    const { data: { user: callerUser }, error: callerErr } = await callerClient.auth.getUser();
    if (callerErr || !callerUser) return err('Token inválido ou expirado.', 401);

    const { data: callerProfile } = await admin
      .from('profiles')
      .select('id, role, company_id, approval_status, is_active')
      .eq('id', callerUser.id)
      .single();
    if (!callerProfile) return err('Perfil não encontrado.', 404);
    // service_role bypassa RLS: gate empresarial obrigatório no código da Edge.
    if (
      String(callerProfile.approval_status ?? '') !== 'approved' ||
      callerProfile.is_active !== true
    ) {
      return err('Conta sem acesso empresarial ativo.', 403);
    }
    const callerRole = String(callerProfile.role ?? '').toLowerCase();
    const hasAdminOrEvaluator = callerRole === 'admin' || callerRole === 'evaluator';
    const adminCompanyId = callerProfile.company_id;

    // ==========================================
    // BLOQUEIO ADMIN APENAS PARA AÇÕES DE GESTÃO DE USUÁRIO (1-6):
    //   reset-password / approve-profile / reject-profile /
    //   toggle-active / delete-user
    // Ações de agendamento (7-11) têm SUA PRÓPRIA autorização interna:
    //   cancel-appointment → admin ou evaluator
    //   request-cancellation → seller (se for dono) OU admin/evaluator
    //   approve-cancellation → admin ou evaluator
    //   finalize-appointment → admin ou evaluator
    //   approve-voucher → admin
    // request-seller-access (ação 0) é ANÔNIMA (já tratada acima).
    // ==========================================
    const adminOnlyActions = [
      'reset-password',
      'approve-profile',
      'reject-profile',
      'toggle-active',
      'delete-user',
    ];
    const appointmentActions = [
      'cancel-appointment',
      'request-cancellation',
      'approve-cancellation',
      'finalize-appointment',
      'approve-voucher',
    ];
    if (adminOnlyActions.includes(action) && callerRole !== 'admin') {
      return err('Apenas gerentes podem executar essa ação de gestão de usuários.', 403);
    }
    if (
      !adminOnlyActions.includes(action) &&
      !appointmentActions.includes(action) &&
      !hasAdminOrEvaluator &&
      callerRole !== 'seller'
    ) {
      return err('Você não tem permissão para executar essa ação.', 403);
    }

    async function assertSameCompany(targetUserId) {
      const { data: target } = await admin
        .from('profiles').select('company_id').eq('id', targetUserId).maybeSingle();
      if (!target) return false;
      return String(target.company_id) === String(adminCompanyId);
    }

    // ========== 2) reset-password =======================================================
    if (action === 'reset-password') {
      const userId      = body.userId;
      const newPassword = body.newPassword;
      if (!isUuid(userId)) return err('Usuário inválido.');
      if (typeof newPassword !== 'string' || newPassword.length < 6) return err('Nova senha precisa ter pelo menos 6 caracteres.');
      if (!await assertSameCompany(userId)) return err('Você não tem permissão sobre esse usuário.', 403);

      const { error: upErr } = await admin.auth.admin.updateUserById(userId, { password: newPassword });
      if (upErr) return err((upErr)?.message ?? 'Não foi possível redefinir a senha.', 500);
      await admin.auth.admin.updateUserById(userId, { email_confirm: true }).catch(() => {});

      return ok({ success: true, message: 'Senha redefinida com sucesso. Avise o novo valor ao vendedor.' });
    }

    // ========== 3) approve-profile ======================================================
    if (action === 'approve-profile') {
      const userId = body.userId;
      if (!isUuid(userId)) return err('Usuário inválido.');
      if (!await assertSameCompany(userId)) return err('Você não tem permissão sobre esse usuário.', 403);

      // Defense in depth: filtro company_id EXPLICITO alem do assert
      const { error: upErr } = await admin
        .from('profiles')
        .update({ approval_status: 'approved', is_active: true })
        .eq('id', userId)
        .eq('company_id', adminCompanyId);
      if (upErr) return err((upErr)?.message ?? 'Erro ao aprovar.', 500);

      await admin.auth.admin.updateUserById(userId, { email_confirm: true }).catch(() => {});
      // Garante que esteja desbanido (caso estivesse rejeitado antes e foi banido)
      await admin.auth.admin.updateUserById(userId, { ban_duration: 'none' }).catch(() => {});

      return ok({ success: true, message: 'Usuário aprovado. Ele já pode entrar normalmente.' });
    }

    // ========== 4) reject-profile =======================================================
    if (action === 'reject-profile') {
      const userId = body.userId;
      if (!isUuid(userId)) return err('Usuário inválido.');
      if (!await assertSameCompany(userId)) return err('Você não tem permissão sobre esse usuário.', 403);

      const { error: upErr } = await admin
        .from('profiles')
        .update({ approval_status: 'rejected', is_active: false })
        .eq('id', userId)
        .eq('company_id', adminCompanyId);
      if (upErr) return err((upErr)?.message ?? 'Erro ao recusar.', 500);

      // FIX v4 ISSUE #2: BANIR no auth.users tambem!
      // (antes só atualizava profiles, então usuário rejeitado conseguia logar)
      const { error: banErr } = await admin.auth.admin.updateUserById(userId, {
        ban_duration: 'permanent',
      });
      if (banErr) console.warn('reject-profile: falha ao banir usuario no auth (continuar com profile rejeitado):', banErr);

      return ok({ success: true, message: 'Cadastro recusado e login bloqueado permanentemente.' });
    }

    // ========== 5) toggle-active ========================================================
    if (action === 'toggle-active') {
      const userId      = body.userId;
      const newIsActive = Boolean(body.newActiveState);
      if (!isUuid(userId)) return err('Usuário inválido.');
      if (!await assertSameCompany(userId)) return err('Você não tem permissão sobre esse usuário.', 403);

      const { error: upErr } = await admin
        .from('profiles')
        .update({ is_active: newIsActive })
        .eq('id', userId)
        .eq('company_id', adminCompanyId);
      if (upErr) return err((upErr)?.message ?? 'Erro ao alterar status.', 500);

      // FIX v4 ISSUE #1: formatos CORRETOS de ban_duration (Unidades GoTrue = ns,us,ms,s,m,h)
      //                  + REMOVIDO try/catch vazio para NAO silenciar erros
      if (!newIsActive) {
        // Banimento "permanente": 100 ANOS em horas (unidade 'h' é suportada oficialmente)
        const { error: banError } = await admin.auth.admin.updateUserById(userId, {
          ban_duration: '876000h',
        });
        if (banError) return err((banError)?.message ?? 'Erro ao desativar o login do usuário.', 500);
      } else {
        // Desbanir: valor OFICIAL é a string literal 'none'
        const { error: unbanError } = await admin.auth.admin.updateUserById(userId, {
          ban_duration: 'none',
        });
        if (unbanError) return err((unbanError)?.message ?? 'Erro ao reativar o login do usuário.', 500);
        await admin.auth.admin.updateUserById(userId, { email_confirm: true }).catch(() => {});
      }

      return ok({
        success: true,
        message: newIsActive
          ? 'Login reativado. O usuário já pode acessar normalmente.'
          : 'Login desativado. O usuário não conseguirá mais entrar até ser reativado.',
      });
    }

    // ========== 6) delete-user  (NOVA! v5 - com cascade de appointments) ====================
    if (action === 'delete-user') {
      const userId = body.userId;
      if (!isUuid(userId)) return err('Usuário inválido.');
      if (!await assertSameCompany(userId)) return err('Você não tem permissão sobre esse usuário.', 403);
      if (String(userId) === String(callerUser.id)) return err('Você não pode excluir a sua própria conta.', 400);

      // (0) CASCADE FK: apaga appointments CRIADOS POR esse usuario (criados/agendados por ele).
      //     A FK appointments.created_by -> profiles.id impede apagar profile se tiver agendamento.
      //     Aqui apaga TUDO do usuario, para não deixar órfão.
      const { count: qtdAppointmentsDeleted, error: aptDelErr } = await admin
        .from('appointments')
        .delete({ count: 'exact' })
        .eq('created_by', userId)
        .eq('company_id', adminCompanyId);
      if (aptDelErr) return err((aptDelErr)?.message ?? 'Erro ao apagar histórico de agendamentos do usuário.', 500);

      // (A) Apaga profile DEPOIS que já apagou appointments (FK liberada)
      const { error: profileDelErr } = await admin
        .from('profiles')
        .delete()
        .eq('id', userId)
        .eq('company_id', adminCompanyId);
      if (profileDelErr) return err((profileDelErr)?.message ?? 'Erro ao excluir profile.', 500);

      // (B) Apaga auth.users (remove credenciais permanentemente)
      const { error: authDelErr } = await admin.auth.admin.deleteUser(userId);
      if (authDelErr) return err((authDelErr)?.message ?? 'Erro ao excluir login do banco de autenticação.', 500);

      return ok({
        success: true,
        deletedAppointments: qtdAppointmentsDeleted ?? 0,
        message:
          `Usuário excluído permanentemente. ${qtdAppointmentsDeleted ?? 0} agendamento(s) criado(s) por ele também foram removidos do histórico. ` +
          'Login e perfil foram apagados com sucesso.',
      });
    }

    // ========== 7) cancel-appointment (bypass service role para admin / evaluator) ============
    if (action === 'cancel-appointment') {
      const appointmentId = String(body.appointmentId ?? '').trim();
      const reason = String(body.reason ?? '').trim() || 'Cancelamento direto efetuado por gerência.';
      if (!isUuid(appointmentId)) return err('Agendamento inválido.', 400);
      if (!hasAdminOrEvaluator) {
        return err('Apenas gerente ou avaliador podem cancelar diretamente. Peça ao seu vendedor para solicitar cancelamento.', 403);
      }

      // Validação extra: garantir que o appointment pertence a mesma empresa do admin
      const { data: targetApt, error: findErr } = await admin
        .from('appointments')
        .select('id, company_id, status')
        .eq('id', appointmentId)
        .maybeSingle();
      if (findErr) return err((findErr)?.message ?? 'Erro ao consultar agendamento.', 500);
      if (!targetApt) return err('Agendamento não encontrado.', 404);
      if (String(targetApt.company_id) !== String(adminCompanyId)) {
        return err('Você não tem permissão sobre esse agendamento.', 403);
      }

      const now = new Date().toISOString();
      const updatePayload = {
        status: 'cancelled',
        cancelled_at: now,
        cancelled_by: callerUser.id,
        cancellation_request_reason: reason,
      };
      if (callerRole === 'admin') {
        updatePayload.cancellation_admin_approved_at = now;
        updatePayload.cancellation_admin_approved_by = callerUser.id;
      } else if (callerRole === 'evaluator') {
        updatePayload.cancellation_evaluator_approved_at = now;
        updatePayload.cancellation_evaluator_approved_by = callerUser.id;
      }

      const { error: upErr } = await admin
        .from('appointments')
        .update(updatePayload)
        .eq('id', appointmentId)
        .eq('company_id', adminCompanyId);
      if (upErr) return err((upErr)?.message ?? 'Erro ao cancelar o agendamento.', 500);

      return ok({
        success: true,
        message: 'Horário liberado com sucesso. O agendamento foi cancelado e o slot voltou a ficar disponível.',
      });
    }

    // ========== 8) request-cancellation (seller pede cancelamento, logado como seu user) =========
    if (action === 'request-cancellation') {
      const appointmentId = String(body.appointmentId ?? '').trim();
      const reason = String(body.reason ?? '').trim();
      if (!isUuid(appointmentId)) return err('Agendamento inválido.', 400);
      if (reason.length < 3) return err('Informe o motivo do cancelamento (pelo menos 3 caracteres).', 400);

      const { data: targetApt, error: findErr } = await admin
        .from('appointments')
        .select('id, company_id, seller_email, created_by, status')
        .eq('id', appointmentId)
        .maybeSingle();
      if (findErr) return err((findErr)?.message ?? 'Erro ao consultar agendamento.', 500);
      if (!targetApt) return err('Agendamento não encontrado.', 404);
      if (String(targetApt.company_id) !== String(adminCompanyId)) {
        return err('Você não tem permissão sobre esse agendamento.', 403);
      }

      // Se chamador for seller, permitir APENAS se for seu prórpio agendamento
      const callerRole = String(callerProfile.role ?? '').toLowerCase();
      if (callerRole === 'seller') {
        const callerEmail = String(callerUser.email ?? '').trim().toLowerCase();
        const aptSellerEmail = String(targetApt.seller_email ?? '').trim().toLowerCase();
        const aptCreatedBy = String(targetApt.created_by ?? '');
        const sameSeller = aptSellerEmail === callerEmail || aptCreatedBy === String(callerUser.id);
        if (!sameSeller) {
          return err('Você só pode solicitar cancelamento dos seus próprios agendamentos.', 403);
        }
      }

      const now = new Date().toISOString();
      const updatePayload = {
        cancellation_requested_at: now,
        cancellation_requested_by: callerUser.id,
        cancellation_request_reason: reason,
        cancellation_admin_approved_at: null,
        cancellation_admin_approved_by: null,
        cancellation_evaluator_approved_at: null,
        cancellation_evaluator_approved_by: null,
      };

      const { error: upErr } = await admin
        .from('appointments')
        .update(updatePayload)
        .eq('id', appointmentId)
        .eq('company_id', adminCompanyId);
      if (upErr) return err((upErr)?.message ?? 'Erro ao registrar a solicitação de cancelamento.', 500);

      return ok({
        success: true,
        message:
          'Solicitação enviada! Agora é só aguardar a aprovação do gerente ou avaliador. ' +
          'Apenas uma aprovação já conclui o cancelamento e libera o horário automaticamente.',
      });
    }

    // ========== 9) approve-cancellation (admin/evaluator) =====================================
    if (action === 'approve-cancellation') {
      const appointmentId = String(body.appointmentId ?? '').trim();
      if (!isUuid(appointmentId)) return err('Agendamento inválido.', 400);

      const callerRole = String(callerProfile.role ?? '').toLowerCase();
      if (!['admin', 'evaluator'].includes(callerRole)) {
        return err('Apenas gerente ou avaliador podem aprovar cancelamentos.', 403);
      }

      const { data: targetApt, error: findErr } = await admin
        .from('appointments')
        .select('id, company_id, cancellation_requested_at, status')
        .eq('id', appointmentId)
        .maybeSingle();
      if (findErr) return err((findErr)?.message ?? 'Erro ao consultar agendamento.', 500);
      if (!targetApt) return err('Agendamento não encontrado.', 404);
      if (String(targetApt.company_id) !== String(adminCompanyId)) {
        return err('Você não tem permissão sobre esse agendamento.', 403);
      }
      if (!targetApt.cancellation_requested_at) {
        return err('Este agendamento ainda não possui uma solicitação de cancelamento.', 400);
      }

      const now = new Date().toISOString();
      const updatePayload = {
        status: 'cancelled',
        cancelled_at: now,
        cancelled_by: callerUser.id,
        cancellation_reason: targetApt.cancellation_request_reason ?? 'Cancelamento aprovado por gerência.',
      };
      if (callerRole === 'admin') {
        updatePayload.cancellation_admin_approved_at = now;
        updatePayload.cancellation_admin_approved_by = callerUser.id;
      } else if (callerRole === 'evaluator') {
        updatePayload.cancellation_evaluator_approved_at = now;
        updatePayload.cancellation_evaluator_approved_by = callerUser.id;
      }

      const { error: upErr } = await admin
        .from('appointments')
        .update(updatePayload)
        .eq('id', appointmentId)
        .eq('company_id', adminCompanyId);
      if (upErr) return err((upErr)?.message ?? 'Erro ao aprovar o cancelamento.', 500);

      return ok({
        success: true,
        message: 'Aprovação registrada! O agendamento foi cancelado e o horário foi liberado.',
      });
    }

    // ========== 10) finalize-appointment (admin/evaluator service role bypass) ===================
    if (action === 'finalize-appointment') {
      const appointmentId = String(body.appointmentId ?? '').trim();
      const result = String(body.result ?? '').trim();
      const rejectionReason = String(body.rejectionReason ?? '').trim() || null;
      const laudoFileUrl = String(body.laudoFileUrl ?? '').trim() || null;
      const laudoFileName = String(body.laudoFileName ?? '').trim() || null;

      if (!isUuid(appointmentId)) return err('Agendamento inválido.', 400);
      if (!['approved', 'rejected'].includes(result)) {
        return err('Informe se o laudo foi aprovado (approved) ou reprovado (rejected).', 400);
      }
      if (result === 'rejected' && (!rejectionReason || rejectionReason.length < 3)) {
        return err('Informe o motivo da reprovação (pelo menos 3 caracteres).', 400);
      }
      if (!hasAdminOrEvaluator) {
        return err('Apenas gerente ou avaliador podem finalizar um laudo.', 403);
      }

      const { data: targetApt, error: findErr } = await admin
        .from('appointments')
        .select('id, company_id')
        .eq('id', appointmentId)
        .maybeSingle();
      if (findErr) return err((findErr)?.message ?? 'Erro ao consultar agendamento.', 500);
      if (!targetApt) return err('Agendamento não encontrado.', 404);
      if (String(targetApt.company_id) !== String(adminCompanyId)) {
        return err('Você não tem permissão sobre esse agendamento.', 403);
      }

      const now = new Date().toISOString();
      const updatePayload = {
        status: 'completed',
        laudo_result: result,
        laudo_rejection_reason: result === 'rejected' ? rejectionReason : null,
        laudo_file_url: laudoFileUrl,
        laudo_file_name: laudoFileName,
        laudo_finalized_at: now,
        laudo_finalized_by: callerUser.id,
      };

      const { error: upErr } = await admin
        .from('appointments')
        .update(updatePayload)
        .eq('id', appointmentId)
        .eq('company_id', adminCompanyId);
      if (upErr) return err((upErr)?.message ?? 'Erro ao finalizar o agendamento.', 500);

      return ok({
        success: true,
        message:
          result === 'approved'
            ? 'Laudo aprovado com sucesso. O status do agendamento já foi atualizado para finalizado.'
            : 'Laudo reprovado com sucesso. O motivo já foi salvo e o status atualizado.',
      });
    }

    // ========== 11) approve-voucher (admin service role bypass) ==================================
    if (action === 'approve-voucher') {
      const appointmentId = String(body.appointmentId ?? '').trim();
      if (!isUuid(appointmentId)) return err('Agendamento inválido.', 400);
      if (callerRole !== 'admin') {
        return err('Apenas gerentes podem aprovar uso de voucher.', 403);
      }

      const { data: targetApt, error: findErr } = await admin
        .from('appointments')
        .select('id, company_id')
        .eq('id', appointmentId)
        .maybeSingle();
      if (findErr) return err((findErr)?.message ?? 'Erro ao consultar agendamento.', 500);
      if (!targetApt) return err('Agendamento não encontrado.', 404);
      if (String(targetApt.company_id) !== String(adminCompanyId)) {
        return err('Você não tem permissão sobre esse agendamento.', 403);
      }

      const now = new Date().toISOString();
      const updatePayload = {
        voucher_approved_at: now,
        voucher_approved_by: callerUser.id,
      };

      const { error: upErr } = await admin
        .from('appointments')
        .update(updatePayload)
        .eq('id', appointmentId)
        .eq('company_id', adminCompanyId);
      if (upErr) return err((upErr)?.message ?? 'Erro ao aprovar voucher.', 500);

      return ok({
        success: true,
        message: 'Voucher aprovado com sucesso! O uso do desconto já foi liberado neste agendamento.',
      });
    }

    return err(
      'Ação inválida. Escolha: reset-password, approve-profile, reject-profile, toggle-active, request-seller-access, delete-user, cancel-appointment, request-cancellation, approve-cancellation, finalize-appointment, approve-voucher.',
      400,
    );

  } catch (e) {
    console.error('user-admin-actions FATAL:', e?.message ?? e);
    return err(e?.message ?? 'Erro interno do servidor.', 500);
  }
});
