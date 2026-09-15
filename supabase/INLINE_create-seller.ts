// ================================================================
// INLINE_create-seller.ts — Versão PARA COLAR NO EDITOR INLINE
// DO SUPABASE (Dashboard → Edge Functions → create-seller → Edit)
//
// NÃO TEM IMPORTS DE _shared/ (não funciona no Editor Inline).
// Todo o CORS e demais lógicas estão embutidas aqui.
// ================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

function isValidEmail(e) {
  return typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}
function isValidPassword(p) {
  return typeof p === 'string' && p.length >= 6;
}
function isValidUuid(s) {
  if (typeof s !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}
function isValidRole(r) {
  return r === 'seller' || r === 'evaluator';
}
function getRoleLabel(r) {
  return r === 'seller' ? 'vendedor' : 'avaliador';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Autenticacao necessaria.' }),
        { status: 401, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } },
      );
    }
    const token = authHeader.substring('Bearer '.length);
    const { data: userData, error: jwtErr } = await supabaseAdmin.auth.getUser(token);
    if (jwtErr || !userData?.user?.id) {
      return new Response(
        JSON.stringify({ error: 'Token invalido ou expirado.' }),
        { status: 401, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } },
      );
    }

    const { data: callerProfile } = await supabaseAdmin
      .from('profiles')
      .select('role, company_id, full_name')
      .eq('id', userData.user.id)
      .single();

    if (!callerProfile || !['admin'].includes(String(callerProfile.role))) {
      return new Response(
        JSON.stringify({ error: 'Apenas gerentes podem criar novos usuarios.' }),
        { status: 403, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } },
      );
    }

    const body = await req.json().catch(() => ({}));
    const email    = body.email;
    const password = body.password;
    const fullName = body.fullName;
    const rawRole  = body.role;
    const companyId = body.companyId ?? callerProfile.company_id;

    if (!isValidEmail(email)) {
      return new Response(
        JSON.stringify({ error: 'Email invalido.' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } },
      );
    }
    if (!isValidPassword(password)) {
      return new Response(
        JSON.stringify({ error: 'A senha precisa ter pelo menos 6 caracteres.' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } },
      );
    }
    if (typeof fullName !== 'string' || fullName.trim().length < 3) {
      return new Response(
        JSON.stringify({ error: 'Informe o nome completo (minimo 3 letras).' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } },
      );
    }
    if (!isValidRole(rawRole)) {
      return new Response(
        JSON.stringify({ error: 'Perfil invalido. Escolha "seller" ou "evaluator".' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } },
      );
    }
    const targetRole = rawRole;
    if (!isValidUuid(companyId)) {
      return new Response(
        JSON.stringify({ error: 'Empresa invalida (companyId).' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } },
      );
    }
    if (String(companyId) !== String(callerProfile.company_id)) {
      return new Response(
        JSON.stringify({ error: 'Voce so pode criar usuarios para a sua propria empresa.' }),
        { status: 403, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } },
      );
    }
    const { count: companyCount, error: companyErr } = await supabaseAdmin
      .from('companies')
      .select('id', { count: 'exact', head: true })
      .eq('id', companyId);
    if (companyErr || (companyCount ?? 0) < 1) {
      return new Response(
        JSON.stringify({ error: 'Empresa informada nao existe.' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } },
      );
    }

    const { data: createdAuth, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: email,
      password: password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName.trim(),
        role: targetRole,
        company_id: companyId,
      },
    });
    if (createErr || !createdAuth?.user?.id) {
      return new Response(
        JSON.stringify({ error: (createErr && createErr.message) ? createErr.message : 'Erro ao criar usuario. Email ja pode estar cadastrado.' }),
        { status: 409, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } },
      );
    }

    const { error: profileErr } = await supabaseAdmin.from('profiles').upsert({
      id: createdAuth.user.id,
      email: email,
      company_id: companyId,
      full_name: fullName.trim(),
      role: targetRole,
      approval_status: 'approved',
      is_active: true,
      requested_at: new Date().toISOString(),
    }, { onConflict: 'id' });

    if (profileErr) {
      try {
        await supabaseAdmin.auth.admin.deleteUser(createdAuth.user.id);
      } catch (_cleanupErr) { /* ignora */ }
      return new Response(
        JSON.stringify({ error: (profileErr && profileErr.message) ? profileErr.message : 'Erro ao criar perfil.' }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } },
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        userId: createdAuth.user.id,
        profileCreated: true,
        companyId: companyId,
        role: targetRole,
        message: `Conta de ${getRoleLabel(targetRole)} criada com sucesso. Ele ja pode logar.`,
      }),
      { status: 201, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } },
    );
  } catch (e) {
    console.error('create-seller fatal:', e?.message ?? e);
    return new Response(
      JSON.stringify({ error: (e && e.message) ? e.message : 'Erro interno do servidor.' }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } },
    );
  }
});
