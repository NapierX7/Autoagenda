-- =============================================================================
-- SCRIPT FINAL AUTOAGENDA - TUDO EM UM (V3 DEFINITIVO - CORRIGE 42501 + ROLE + REALTIME)
-- COLA TUDO NO SQL EDITOR DO SUPABASE E CLIQUE EM RUN
-- NÃO ALTERA ESTRUTURA DE TABELAS (não cria colunas novas, não deleta tabelas)
--
-- PROBLEMA RESOLVIDO: policies usavam auth.jwt()->'app_metadata'->>'role'
--   MAS o role só estava gravado em public.profiles.role, não no JWT → 42501.
-- SOLUÇÃO: Criar RPC get_my_role() SECURITY DEFINER (igual get_my_company_id)
--   e usar ELA nas policies. SECURITY DEFINER executa como OWNER da função →
--   NÃO PASSA por RLS na tabela profiles → NÃO TEM recursão → NÃO TEM 42501.
-- =============================================================================

-- =============================================================================
-- 0) DROP DE TODAS POLICIES ANTIGAS EM TODAS AS TABELAS
--    (ordem REVERSA de dependência: policies PRIMEIRO, depois a RPC)
-- =============================================================================

-- 0a) TABELA public.company_settings (todas as policies antigas que já existiram)
drop policy if exists "company_settings_select_own" on public.company_settings;
drop policy if exists "company_settings_update_own" on public.company_settings;
drop policy if exists "company_settings_insert_own" on public.company_settings;
drop policy if exists "company_settings_v2_select" on public.company_settings;
drop policy if exists "company_settings_v2_insert" on public.company_settings;
drop policy if exists "company_settings_v2_update" on public.company_settings;
drop policy if exists "company_settings_admin" on public.company_settings;
drop policy if exists "company_settings_all_own" on public.company_settings;

-- 0b) TABELA public.companies
drop policy if exists "companies_select_own" on public.companies;
drop policy if exists "companies_update_own" on public.companies;
drop policy if exists "companies_v2_select" on public.companies;
drop policy if exists "companies_v2_update" on public.companies;
drop policy if exists "companies_admin" on public.companies;
drop policy if exists "companies_all_own" on public.companies;

-- 0c) TABELA public.appointments
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

-- 0d) TABELA public.profiles
drop policy if exists "profiles_select_self" on public.profiles;
drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_update_self" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "profiles_all_read" on public.profiles;
drop policy if exists "profiles_v2_select" on public.profiles;
drop policy if exists "profiles_v2_update" on public.profiles;
drop policy if exists "profiles_admin" on public.profiles;

-- =============================================================================
-- 1) DROP DAS RPCs ANTIGAS (agora SEM dependências, CASCADE por segurança)
-- =============================================================================
drop function if exists public.get_my_company_id() cascade;
drop function if exists public.get_my_role() cascade;

-- =============================================================================
-- 2) RECRIAÇÃO DAS RPCs - AMBAS SECURITY DEFINER (EXECUTAM COMO OWNER, SEM RLS)
--    - search_path = public (evita busca por schemas externos / injection)
--    - REVOKE ALL public + GRANT EXECUTE só authenticated (segurança máxima)
-- =============================================================================

-- 2a) get_my_company_id() → retorna company_id do perfil do usuário logado
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

-- 2b) get_my_role() → NOVA FUNÇÃO. retorna role em letras minúsculas
--     (admin / evaluator / seller). FONTE VERDADEIRA = public.profiles.role.
--     COMO É SECURITY DEFINER: executa bypass RLS em profiles → SEM recursão.
create function public.get_my_role()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  select lower(coalesce(p.role, 'seller'))
    into v_role
    from public.profiles p
   where p.id = auth.uid()
   limit 1;
  return coalesce(v_role, 'seller');
end;
$$;
revoke all on function public.get_my_role() from public;
grant execute on function public.get_my_role() to authenticated;

-- =============================================================================
-- 3) SINCRONIZAR email / company_id / approval_status EM public.profiles
--    Usa auth.users como FONTE VERDADEIRA para emails e profiles.id = auth.users.id
-- =============================================================================
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

update public.profiles
   set email = (select email from auth.users where id = profiles.id)
 where email is null or email = '';

-- =============================================================================
-- 4) GARANTE QUE RLS ESTÁ LIGADO EM TODAS TABELAS PRINCIPAIS
-- =============================================================================
alter table public.appointments       enable row level security;
alter table public.profiles           enable row level security;
alter table public.companies          enable row level security;
alter table public.company_settings   enable row level security;

-- =============================================================================
-- 5) POLICIES DE public.appointments (4 policies FINAIS)
--    - AGORA USAM public.get_my_role() NO LUGAR DE auth.jwt()
--    - company_id sempre usa public.get_my_company_id() (SECURITY DEFINER)
-- =============================================================================

-- SELECT: Admin/Avaliador vê TUDO da empresa; Vendedor vê SÓ o que ele criou
--         OU o que foi criado COM O SEU seller_email (encaixes feitos por admin no nome dele)
create policy "apt_select_final"
  on public.appointments
  for select
  using (
    company_id = public.get_my_company_id()
    and (
      public.get_my_role() in ('admin', 'evaluator')
      or created_by = auth.uid()
      or seller_email = (select email from auth.users where id = auth.uid())
    )
  );

-- INSERT: Mesma empresa e quem cria é SEMPRE o usuário logado (integridade created_by)
--         Bloqueia explicitamente email vazio de vendedor (garante que vendedor vai ver o agendamento)
create policy "apt_insert_final"
  on public.appointments
  for insert
  with check (
    company_id = public.get_my_company_id()
    and created_by = auth.uid()
    and seller_email is not null
    and seller_email <> ''
  );

-- UPDATE: Admin/Avaliador edita QUALQUER agendamento da empresa (incluindo encaixes)
--         Vendedor SÓ edita o que ELE CRIOU ou quando seller_email = EMAIL DELE (encaixes)
create policy "apt_update_final"
  on public.appointments
  for update
  using (company_id = public.get_my_company_id())
  with check (
    company_id = public.get_my_company_id()
    and (
      public.get_my_role() in ('admin', 'evaluator')
      or created_by = auth.uid()
      or seller_email = (select email from auth.users where id = auth.uid())
    )
  );

-- DELETE: SÓ ADMIN consegue apagar (hard delete).
--         Avaliador/Vendedor usam cancelamento ou edge function service role.
create policy "apt_delete_final"
  on public.appointments
  for delete
  using (
    company_id = public.get_my_company_id()
    and public.get_my_role() = 'admin'
  );

-- =============================================================================
-- 6) POLICIES public.profiles (cada usuário SÓ enxerga O PRÓPRIO perfil)
--    Policy SEM subquery: id = auth.uid(). SECURITY DEFINER das RPCs resolve o resto.
-- =============================================================================
create policy "profiles_select_self"
  on public.profiles
  for select
  using (id = auth.uid());

create policy "profiles_update_self"
  on public.profiles
  for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- =============================================================================
-- 7) POLICIES public.companies (cada usuário vê DADOS DA PRÓPRIA empresa)
-- =============================================================================
create policy "companies_select_own"
  on public.companies
  for select
  using (id = public.get_my_company_id());

create policy "companies_update_own"
  on public.companies
  for update
  using (id = public.get_my_company_id())
  with check (id = public.get_my_company_id());

-- =============================================================================
-- 8) POLICIES public.company_settings (cada empresa vê SUAS configurações)
-- =============================================================================
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

-- =============================================================================
-- 9) ATIVAÇÃO REALTIME (RESOLVE "não atualiza para os outros")
--    - usa DO $$ pq postgres NÃO tem ADD TABLE IF NOT EXISTS em ALTER PUBLICATION
--    - REPLICA IDENTITY FULL para UPDATE/DELETE enviar payload completo (old+new)
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'appointments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.appointments;
  END IF;
END
$$;

ALTER TABLE IF EXISTS public.appointments REPLICA IDENTITY FULL;

-- =============================================================================
-- (OPCIONAL) VALIDAÇÃO POST-EXECUÇÃO — rode separadamente SE QUISER confirmar:
-- =============================================================================
-- 1) Verifica se appointments está na publication Realtime:
-- select pubname, schemaname, tablename from pg_publication_tables where pubname = 'supabase_realtime';
--
-- 2) Verifica REPLICA IDENTITY (tem que ser FULL = 'd' ou 'f'):
-- select c.relname, c.relreplident from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='appointments';
--
-- 3) Testa as RPCs (executa como authenticated):
-- select public.get_my_company_id() as company_id, public.get_my_role() as role;
-- =============================================================================
