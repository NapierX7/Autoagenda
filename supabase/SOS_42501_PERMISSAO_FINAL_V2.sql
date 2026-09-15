-- =====================================================
-- SCRIPT SOS 42501 V2 (CORRIGIDO: ORDEM DROP CERTA)
-- AutoAgenda - COLA TUDO NO SQL EDITOR DO SUPABASE E RODA
-- Resolve erro 2BP01: cannot drop function get_my_company_id because other objects depend on it
-- Motivo: tem que APAGAR POLICIES PRIMEIRO, so DEPOIS apagar a funcao.
-- =====================================================

-- =====================================================
-- 0) ANTES DE QUALQUER COISA: APAGA TUDO QUE DEPENDE de get_my_company_id()
--    (todas policies em TODAS tabelas, todas a ordem reversa)
-- =====================================================

-- 0a) POLICIES EM public.company_settings (DROP TUDO)
drop policy if exists "company_settings_select_own" on public.company_settings;
drop policy if exists "company_settings_update_own" on public.company_settings;
drop policy if exists "company_settings_insert_own" on public.company_settings;
drop policy if exists "company_settings_v2_select" on public.company_settings;
drop policy if exists "company_settings_v2_insert" on public.company_settings;
drop policy if exists "company_settings_v2_update" on public.company_settings;
drop policy if exists "company_settings_admin" on public.company_settings;
drop policy if exists "company_settings_all_own" on public.company_settings;

-- 0b) POLICIES EM public.companies (DROP TUDO)
drop policy if exists "companies_select_own" on public.companies;
drop policy if exists "companies_update_own" on public.companies;
drop policy if exists "companies_v2_select" on public.companies;
drop policy if exists "companies_v2_update" on public.companies;
drop policy if exists "companies_admin" on public.companies;
drop policy if exists "companies_all_own" on public.companies;

-- 0c) POLICIES EM public.appointments (DROP TUDO)
drop policy if exists "apt_select_final" on public.appointments;
drop policy if exists "apt_insert_final" on public.appointments;
drop policy if exists "apt_update_final" on public.appointments;
drop policy if exists "apt_delete_final" on public.appointments;
drop policy if exists "appointments_select_own_company" on public.appointments;
drop policy if exists "appointments_insert_own_company" on public.appointments;
drop policy if exists "appointments_update_own_company" on public.appointments;
drop policy if exists "appointments_sellers_see_own" on public.appointments;
drop policy if exists "appointments_admin_delete" on public.appointments;
drop policy if exists "appointments_select_self_or_company" on public.appointments;
drop policy if exists "appointments_admin_cancel_delete" on public.appointments;
drop policy if exists "appointments_v2_select" on public.appointments;
drop policy if exists "appointments_v2_insert" on public.appointments;
drop policy if exists "appointments_v2_update" on public.appointments;
drop policy if exists "appointments_v2_delete" on public.appointments;
drop policy if exists "appointments_all_read" on public.appointments;
drop policy if exists "appointments_all_write" on public.appointments;

-- 0d) POLICIES EM public.profiles (DROP TUDO)
drop policy if exists "profiles_select_self" on public.profiles;
drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_update_self" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "profiles_all_read" on public.profiles;
drop policy if exists "profiles_v2_select" on public.profiles;
drop policy if exists "profiles_v2_update" on public.profiles;
drop policy if exists "profiles_admin" on public.profiles;

-- =====================================================
-- 1) AGORA SIM: apaga funcao get_my_company_id()
--    (agora nao ha mais nenhuma policy dependendo, CASCADE de rede de seguranca)
-- =====================================================
drop function if exists public.get_my_company_id() cascade;

-- Recria RPC do jeito CERTO: SECURITY DEFINER, search_path public, GRANT so p/ authenticated
create function public.get_my_company_id()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
begin
  select p.company_id
    into v_company_id
    from public.profiles p
   where p.id = auth.uid()
   limit 1;
  return v_company_id;
end;
$$;
revoke all on function public.get_my_company_id() from public;
grant execute on function public.get_my_company_id() to authenticated;

-- =====================================================
-- 2) SINCRONIZAR emails + company_id profiles <-> auth.users
--    (evita emails divergentes, is_active nulo, company_id nulo)
-- =====================================================
update public.profiles p
   set email           = au.email,
       is_active       = coalesce(p.is_active, true),
       approval_status = coalesce(p.approval_status, 'approved')
  from auth.users au
 where p.id = au.id
   and (
     p.email is distinct from au.email
     or p.is_active is null
     or p.company_id is null
   );

-- Rede: se profile.email ainda esta vazio, busca do auth.users
update public.profiles
   set email = (select email from auth.users where id = profiles.id)
 where email is null or email = '';

-- =====================================================
-- 3) RLS ligado em todas tabelas principais (re-liga se alguem desligou)
-- =====================================================
alter table public.appointments       enable row level security;
alter table public.profiles           enable row level security;
alter table public.companies          enable row level security;
alter table public.company_settings   enable row level security;

-- =====================================================
-- 4) POLICIES APPOINTMENTS (4) - 100% LIVRE DE 42501
--    Nenhuma subquery em public.profiles.
--    Role vem de auth.jwt() -> app_metadata ->> role (claim do token, sem RLS)
-- =====================================================
create policy "apt_select_final"
  on public.appointments
  for select
  using (
    company_id = public.get_my_company_id()
    and (
      coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') in ('admin', 'evaluator')
      or created_by = auth.uid()
    )
  );

create policy "apt_insert_final"
  on public.appointments
  for insert
  with check (
    company_id = public.get_my_company_id()
    and created_by = auth.uid()
  );

create policy "apt_update_final"
  on public.appointments
  for update
  using (company_id = public.get_my_company_id())
  with check (
    company_id = public.get_my_company_id()
    and (
      coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') in ('admin', 'evaluator')
      or (
        coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'seller'
        and created_by = auth.uid()
      )
    )
  );

create policy "apt_delete_final"
  on public.appointments
  for delete
  using (
    company_id = public.get_my_company_id()
    and coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
  );

-- =====================================================
-- 5) POLICIES PROFILES (cada usuario ve o PROPRIO perfil)
--    SEM SUBQUERY, policy simples id = auth.uid()
-- =====================================================
create policy "profiles_select_self"
  on public.profiles
  for select
  using (id = auth.uid());

create policy "profiles_update_self"
  on public.profiles
  for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- =====================================================
-- 6) POLICIES COMPANIES (empresa ve os DADOS DA PROPRIA empresa)
--    usa RPC public.get_my_company_id() (SECURITY DEFINER, sem RLS recursion)
-- =====================================================
create policy "companies_select_own"
  on public.companies
  for select
  using (id = public.get_my_company_id());

create policy "companies_update_own"
  on public.companies
  for update
  using (id = public.get_my_company_id())
  with check (id = public.get_my_company_id());

-- =====================================================
-- 7) POLICIES COMPANY_SETTINGS (configuracoes da propria empresa)
-- =====================================================
create policy "company_settings_select_own"
  on public.company_settings
  for select
  using (company_id = public.get_my_company_id());

create policy "company_settings_insert_own"
  on public.company_settings
  for insert
  with check (company_id = public.get_my_company_id());

create policy "company_settings_update_own"
  on public.company_settings
  for update
  using (company_id = public.get_my_company_id())
  with check (company_id = public.get_my_company_id());

-- =====================================================
-- FIM.
-- Proximos passos (NO NAVEGADOR, apos rodar esse SQL):
-- 1. Fechar site normal
-- 2. ABRIR JANELA ANONIMA NOVA (Ctrl + Shift + N no Chrome)
-- 3. Entrar com admin@gwm.com de novo
-- 4. Nao vai mais aparecer Modo Demo / 42501.
-- =====================================================
