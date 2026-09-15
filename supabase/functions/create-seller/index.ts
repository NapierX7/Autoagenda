// Edge Function: create-seller
// Local: supabase/functions/create-seller/index.ts
// Publica com: supabase functions deploy create-seller --project-ref adyzxvkrrdrpkqxjtrxj
//
// Objetivo: backend-side criar usuario + profile (usa service_role key segura,
// evitando o erro "This endpoint requires a valid Bearer token" do frontend)
//
// Suporta perfis: seller (vendedor) ou evaluator (avaliador) - NUNCA admin por aqui.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

// ======= VALIDACOES ==========================================================
function isValidEmail(e: unknown): e is string {
  return typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

function isValidPassword(p: unknown): p is string {
  return typeof p === 'string' && p.length >= 6;
}

function isValidUuid(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

function isValidRole(r: unknown): r is 'seller' | 'evaluator' {
  return r === 'seller' || r === 'evaluator';
}

function getRoleLabel(r: 'seller' | 'evaluator') {
  return r === 'seller' ? 'vendedor' : 'avaliador';
}

serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 1) Service role client (seguro - server side apenas)
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // 2) Valida autorizacao do chamador (tem que ser user logado + admin)
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Autenticacao necessaria.' }),
        { status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
      );
    }
    const token = authHeader.substring('Bearer '.length);
    const { data: userData, error: jwtErr } = await supabaseAdmin.auth.getUser(token);
    if (jwtErr || !userData?.user?.id) {
      return new Response(
        JSON.stringify({ error: 'Token invalido ou expirado.' }),
        { status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
      );
    }

    // Verifica se o chamador e admin
    const { data: callerProfile } = await supabaseAdmin
      .from('profiles')
      .select('role, company_id')
      .eq('id', userData.user.id)
      .single();

    if (!callerProfile || !['admin'].includes(String(callerProfile.role))) {
      return new Response(
        JSON.stringify({ error: 'Apenas gerentes podem criar novos usuarios.' }),
        { status: 403, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
      );
    }

    // 3) Parse + validacao body payload
    const body = await req.json();
    const email    = body.email;
    const password = body.password;
    const fullName = body.fullName;
    const rawRole  = body.role;
    // Preferencia: usa companyId do payload ou assume a company do admin (multi-tenant safe)
    const companyId = body.companyId ?? callerProfile.company_id;

    if (!isValidEmail(email)) {
      return new Response(
        JSON.stringify({ error: 'Email invalido.' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
      );
    }
    if (!isValidPassword(password)) {
      return new Response(
        JSON.stringify({ error: 'A senha precisa ter pelo menos 6 caracteres.' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
      );
    }
    if (typeof fullName !== 'string' || fullName.trim().length < 3) {
      return new Response(
        JSON.stringify({ error: 'Informe o nome completo (minimo 3 letras).' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
      );
    }
    // Valida role (apenas seller ou evaluator - seguranca: admin nunca por aqui)
    if (!isValidRole(rawRole)) {
      return new Response(
        JSON.stringify({ error: 'Perfil invalido. Escolha "seller" ou "evaluator".' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
      );
    }
    const targetRole: 'seller' | 'evaluator' = rawRole;
    if (!isValidUuid(companyId)) {
      return new Response(
        JSON.stringify({ error: 'Empresa invalida (companyId).' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
      );
    }
    // Garante que o admin so cria user na PROPRIA empresa (tenant isolation)
    if (String(companyId) !== String(callerProfile.company_id)) {
      return new Response(
        JSON.stringify({ error: 'Voce so pode criar usuarios para a sua propria empresa.' }),
        { status: 403, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
      );
    }
    const { count: companyCount, error: companyErr } = await supabaseAdmin
      .from('companies')
      .select('id', { count: 'exact', head: true })
      .eq('id', companyId);
    if (companyErr || (companyCount ?? 0) < 1) {
      return new Response(
        JSON.stringify({ error: 'Empresa informada nao existe.' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
      );
    }

    // 4) Cria usuario no auth.users (confirmado - sem email de confirmacao)
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
        JSON.stringify({ error: (createErr as any)?.message ?? 'Erro ao criar usuario. Email ja pode estar cadastrado.' }),
        { status: 409, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
      );
    }

    // 5) Cria profile (upsert - seguro)
    //    Nota: approval_status='approved' e is_active=true pois o GERENTE esta criando
    //    (diferente do self-service request-seller-access que cria como 'pending')
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
      // Fallback seguro: apaga o auth user se o profile falhar, evita dangling user
      await supabaseAdmin.auth.admin.deleteUser(createdAuth.user.id).catch(() => {});
      return new Response(
        JSON.stringify({ error: (profileErr as any)?.message ?? 'Erro ao criar perfil.' }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
      );
    }

    // 6) Sucesso
    return new Response(
      JSON.stringify({
        success: true,
        userId: createdAuth.user.id,
        profileCreated: true,
        companyId: companyId,
        role: targetRole,
        message: `Conta de ${getRoleLabel(targetRole)} criada com sucesso. Ele ja pode logar.`,
      }),
      { status: 201, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
    );
  } catch (e: any) {
    console.error('create-seller fatal:', e?.message ?? e);
    return new Response(
      JSON.stringify({ error: e?.message ?? 'Erro interno do servidor.' }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
    );
  }
});
