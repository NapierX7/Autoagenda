// Edge Function: user-admin-actions  (VERSAO COMPLETA v3 - atualizada 13/08/2026)
//
// AÇÕES: reset-password | approve-profile | reject-profile | toggle-active |
//         request-seller-access | delete-user (NOVA!)
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
      const email     = body.email;
      const password  = body.password;
      const fullName  = body.fullName;
      const companyId = body.companyId;

      if (!isEmail(email)) return err('Informe um email valido.');
      if (typeof password !== 'string' || password.length < 6) return err('Senha precisa ter pelo menos 6 caracteres.');
      if (typeof fullName !== 'string' || fullName.trim().length < 3) return err('Informe seu nome completo.');
      if (!isUuid(companyId)) return err('Selecione a loja onde voce trabalha.');
      const { count } = await admin.from('companies').select('*', { count: 'exact', head: true }).eq('id', companyId);
      if (!count) return err('Loja selecionada nao existe.');

      const { data: authData, error: authErr } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: {
          full_name: fullName.trim(),
          role: 'seller',
          company_id: companyId,
        },
      });
      if (authErr || !authData?.user?.id) {
        return err((authErr)?.message ?? 'Nao foi possivel concluir o cadastro. Email ja pode estar cadastrado.', 409);
      }

      const { error: profileErr } = await admin.from('profiles').upsert({
        id: authData.user.id, email, company_id: companyId,
        approval_status: 'pending', requested_at: new Date().toISOString(),
        role: 'seller', full_name: fullName.trim(), is_active: true,
      }, { onConflict: 'id' });
      if (profileErr) return err((profileErr)?.message ?? 'Erro ao salvar perfil.', 500);

      return ok({
        success: true, userId: authData.user.id, profileCreated: true,
        message: 'Cadastro enviado! O gerente da sua loja ja recebeu a solicitacao de aprovacao.',
      });
    }

    // ========== Todas outras acoes: exigem chamador logado + ADMIN ======================
    if (!bearer) return err('Autenticacao necessaria.', 401);
    const { data: { user: callerUser }, error: callerErr } = await callerClient.auth.getUser();
    if (callerErr || !callerUser) return err('Token invalido ou expirado.', 401);

    const { data: callerProfile } = await admin
      .from('profiles').select('id, role, company_id').eq('id', callerUser.id).single();
    if (!callerProfile) return err('Perfil nao encontrado.', 404);
    if (callerProfile.role !== 'admin') return err('Apenas gerentes podem executar essa acao.', 403);
    const adminCompanyId = callerProfile.company_id;

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
      if (!isUuid(userId)) return err('Usuario invalido.');
      if (typeof newPassword !== 'string' || newPassword.length < 6) return err('Nova senha precisa ter pelo menos 6 caracteres.');
      if (!await assertSameCompany(userId)) return err('Voce nao tem permissao sobre esse usuario.', 403);

      const { error: upErr } = await admin.auth.admin.updateUserById(userId, { password: newPassword });
      if (upErr) return err((upErr)?.message ?? 'Nao foi possivel redefinir a senha.', 500);
      await admin.auth.admin.updateUserById(userId, { email_confirm: true }).catch(() => {});

      return ok({ success: true, message: 'Senha redefinida com sucesso. Avise o novo valor ao vendedor.' });
    }

    // ========== 3) approve-profile ======================================================
    if (action === 'approve-profile') {
      const userId = body.userId;
      if (!isUuid(userId)) return err('Usuario invalido.');
      if (!await assertSameCompany(userId)) return err('Voce nao tem permissao sobre esse usuario.', 403);

      const { error: upErr } = await admin
        .from('profiles')
        .update({ approval_status: 'approved', is_active: true })
        .eq('id', userId);
      if (upErr) return err((upErr)?.message ?? 'Erro ao aprovar.', 500);
      await admin.auth.admin.updateUserById(userId, { email_confirm: true }).catch(() => {});

      return ok({ success: true, message: 'Usuario aprovado. Ele ja pode entrar normalmente.' });
    }

    // ========== 4) reject-profile =======================================================
    if (action === 'reject-profile') {
      const userId = body.userId;
      if (!isUuid(userId)) return err('Usuario invalido.');
      if (!await assertSameCompany(userId)) return err('Voce nao tem permissao sobre esse usuario.', 403);

      const { error: upErr } = await admin
        .from('profiles')
        .update({ approval_status: 'rejected', is_active: false })
        .eq('id', userId);
      if (upErr) return err((upErr)?.message ?? 'Erro ao recusar.', 500);

      return ok({ success: true, message: 'Cadastro recusado.' });
    }

    // ========== 5) toggle-active ========================================================
    if (action === 'toggle-active') {
      const userId      = body.userId;
      const newIsActive = Boolean(body.newActiveState);
      if (!isUuid(userId)) return err('Usuario invalido.');
      if (!await assertSameCompany(userId)) return err('Voce nao tem permissao sobre esse usuario.', 403);

      const { error: upErr } = await admin
        .from('profiles')
        .update({ is_active: newIsActive })
        .eq('id', userId);
      if (upErr) return err((upErr)?.message ?? 'Erro ao alterar status.', 500);

      try {
        if (!newIsActive) {
          await admin.auth.admin.updateUserById(userId, { ban_duration: '2000000d' });
        } else {
          await admin.auth.admin.updateUserById(userId, { ban_duration: '0' });
          await admin.auth.admin.updateUserById(userId, { email_confirm: true });
        }
      } catch {}

      return ok({
        success: true,
        message: newIsActive
          ? 'Login reativado. O usuario ja pode acessar normalmente.'
          : 'Login desativado. O usuario nao conseguira mais entrar ate ser reativado.',
      });
    }

    // ========== 6) delete-user  (NOVA!) =================================================
    if (action === 'delete-user') {
      const userId = body.userId;
      if (!isUuid(userId)) return err('Usuario invalido.');
      if (!await assertSameCompany(userId)) return err('Voce nao tem permissao sobre esse usuario.', 403);
      if (String(userId) === String(callerUser.id)) return err('Voce nao pode excluir a sua propria conta.', 400);

      // (A) Apaga profile primeiro (FK cascade se houver, mas safe)
      const { error: profileDelErr } = await admin.from('profiles').delete().eq('id', userId);
      if (profileDelErr) return err((profileDelErr)?.message ?? 'Erro ao excluir profile.', 500);

      // (B) Apaga auth.users (remove credenciais permanentemente)
      const { error: authDelErr } = await admin.auth.admin.deleteUser(userId);
      if (authDelErr) return err((authDelErr)?.message ?? 'Erro ao excluir login do banco de autenticacao.', 500);

      return ok({
        success: true,
        message:
          'Usuário excluído permanentemente. O login dele (auth.users) foi apagado e o registro em profiles também. ' +
          'Agendamentos do histórico foram mantidos para preservar a integridade dos laudos.',
      });
    }

    return err(
      'Acao invalida. Escolha: reset-password, approve-profile, reject-profile, toggle-active, request-seller-access, delete-user.',
      400,
    );

  } catch (e) {
    console.error('user-admin-actions FATAL:', e?.message ?? e);
    return err(e?.message ?? 'Erro interno do servidor.', 500);
  }
});
