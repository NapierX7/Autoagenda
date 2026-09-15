-- =====================================================
-- SCRIPT SOS 42501 - PERMISSAO TEMPORARIAMENTE INDISPONIVEL
-- AutoAgenda - COLA TUDO ISSO NO SQL EDITOR DO SUPABASE E RODA 1 VEZ
-- Data: 29/08/2026
-- Objetivo: ELIMINAR de vez ERRO 42501 para admin, vendedor, avaliador
-- Motivo do erro: POLICIES appointments usam SUBQUERY EM public.profiles (tabela com RLS) dentro de appointment policy)
--                 → PostgreSQL as vezes retorna NULL → 42501 no caller!
-- Correção: TODAS as policies appointments vao usar SOMENTE auth.jwt() claim (nao consulta profiles nao depende de RLS na mesma transação)
-- =====================================================

-- =====================================================
-- 1) FUNCAO get_my_company_id() - DROP TOTAL + RECRIAR (GARANTE security definer)
--    O create or replace AS VEZES nao atualiza o security definer se
--    tem que DROP + CREATE de verdade!
-- =====================================================
drop function if exists public.get_my_company_id();

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
-- 2) SINCRONIZAR emails + is_active + company_id profiles <-> auth.users
--    (evita divergência email NULL / company_id NULL → 42501)
-- =====================================================
update public.profiles p
   set email         = au.email,
       is_active       = coalesce(p.is_active, true),
       approval_status = coalesce(p.approval_status, 'approved')
  from auth.users au
 where p.id = au.id
   and (
     p.email is distinct from au.email
     or p.is_active is null
     or p.company_id is null
   );

-- Garante SEM email vazio → pega do auth.users (se por acaso ficou vazio)
update public.profiles
   set email = (select email from auth.users where id = profiles.id)
 where email is null or email = '';

-- =====================================================
-- 3) REMOVER TODAS as POLICIES appointments EXISTENTES (TUDO MESMO)
--    para nao ficar policy duplicada / policy antiga atrapalhando
-- =====================================================
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

-- Garante RLS esta ligado (se por acaso estava desligado)
alter table public.appointments enable row level security;

-- =====================================================
-- 4) POLICIES FINAL appointments (4)
--    NAO USA SUBQUERY EM profiles EM NENHUMA LINHA
--    TUDO vem de auth.jwt() (claims do token) → 0% 42501
--    company_id sempre vem da RPC public.get_my_company_id() → SECURITY DEFINER
-- =====================================================

-- 4a) SELECT: admin/evaluator ve TUDO da empresa; seller ve os que ele criou (apenas)
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

-- 4b) INSERT: todos roles (incluindo voucher) pode inserir na sua empresa e proprio uid
create policy "apt_insert_final"
  on public.appointments
  for insert
  with check (
    company_id = public.get_my_company_id()
    and created_by = auth.uid()
  );

-- 4c) UPDATE: admin/evaluator atualiza tudo; seller atualiza o que ele criou
create policy "apt_update_final"
  on public.appointments
  for update
  using (
    company_id = public.get_my_company_id())
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

-- 4d) DELETE: APENAS admin pode deletar (para manter lei de delete hard cancelar direto no botao)
create policy "apt_delete_final"
  on public.appointments
  for delete
  using (
    company_id = public.get_my_company_id()
    and coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
  );

-- =====================================================
-- 5) POLICY profiles (auto-acesso: cada um ve o PROPRIO perfil (id=auth.uid())
--    (POLICY SIMPLES, sem subquery → nao da infinite recursion)
-- =====================================================
drop policy if exists "profiles_select_self" on public.profiles;
drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_update_self" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "profiles_all_read" on public.profiles;

alter table public.profiles enable row level security;

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
-- FIM. Fechamento:
-- 1. Roda tudo no SQL Editor do Supabase
-- 2. Abre JANELA ANONIMA NOVA (Ctrl + Shift + N no Chrome)
-- 3. Faz LOGOUT NOVAMENTE e entra com admin@gwm.com
-- 4. ERRO 42501 ACABOU.
-- =====================================================
