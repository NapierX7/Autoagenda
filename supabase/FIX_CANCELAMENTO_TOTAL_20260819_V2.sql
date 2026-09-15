-- ================================================================
-- PATCH DE CANCELAMENTO (VERSAO CORRIGIDA) - 19/08/2026
-- ERRO ANTERIOR: function public.get_my_role() does not exist.
-- CORRECAO: cria get_my_role() PRIMEIRO + policies usam subquery
-- diretamente de public.profiles.role (mais seguro e compativel).
--
-- OBRIGATORIO RODAR NO SUPABASE (SQL Editor).
-- ================================================================

-- ----------------------------------------------------------------
-- 0) CRIAR FUNCAO get_my_role() (se nao existir) + is_current_user_evaluator()
-- ----------------------------------------------------------------
create or replace function public.get_my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid()
  limit 1;
$$;

revoke all on function public.get_my_role() from public;
grant execute on function public.get_my_role() to authenticated;
grant execute on function public.get_my_role() to service_role;

create or replace function public.is_current_user_evaluator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'evaluator'
  );
$$;

revoke all on function public.is_current_user_evaluator() from public;
grant execute on function public.is_current_user_evaluator() to authenticated;
grant execute on function public.is_current_user_evaluator() to service_role;

-- Garante tambem que is_current_user_admin() existe (algumas deploys antigas nao tem)
create or replace function public.is_current_user_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  );
$$;

revoke all on function public.is_current_user_admin() from public;
grant execute on function public.is_current_user_admin() to authenticated;
grant execute on function public.is_current_user_admin() to service_role;

-- ----------------------------------------------------------------
-- 1) COLUNAS OBRIGATORIAS DE CANCELAMENTO (cria se nao existir)
-- ----------------------------------------------------------------
do $$
begin
  alter table public.appointments
    add column if not exists cancelled_at timestamptz null;
exception when others then null;
end $$;

do $$
begin
  alter table public.appointments
    add column if not exists cancelled_by uuid null references public.profiles(id) on delete set null;
exception when others then null;
end $$;

do $$
begin
  alter table public.appointments
    add column if not exists cancellation_reason text null;
exception when others then null;
end $$;

-- ----------------------------------------------------------------
-- 2) APAGA TUDO QUE EH TRIGGER/POLICY ANTIGA DE CANCELAMENTO
-- ----------------------------------------------------------------
drop trigger if exists appointments_validate_cancellation on public.appointments;
drop trigger if exists appointments_fill_cancellation_audit on public.appointments;
drop trigger if exists appointments_check_cancellation_approval on public.appointments;
drop trigger if exists appointments_require_approval_to_cancel on public.appointments;
drop trigger if exists appointments_after_update_ensure_audits on public.appointments;
drop trigger if exists appointments_final_cancel_validation on public.appointments;
drop function if exists public.appointments_require_approval_to_cancel_fn();
drop function if exists public.validate_appointment_cancellation();
drop function if exists public.fill_cancellation_audit_fields();
drop function if exists public.validate_and_fill_appointment_cancellation();

-- ----------------------------------------------------------------
-- 3) RECRIA POLICIES DE APPOINTMENTS (permissoes granulares por role)
--    Usam SUBQUERY em profiles.role (NAO dependem de get_my_role()).
-- ----------------------------------------------------------------
drop policy if exists "appointments_select_own_company" on public.appointments;
drop policy if exists "appointments_insert_own_company" on public.appointments;
drop policy if exists "appointments_update_own_company" on public.appointments;
drop policy if exists "appointments_sellers_see_own" on public.appointments;
drop policy if exists "appointments_admin_delete" on public.appointments;

create policy "appointments_select_own_company"
  on public.appointments
  for select
  using (
    company_id = public.get_my_company_id()
    and (
      (select role from public.profiles where id = auth.uid()) in ('admin', 'evaluator')
      or created_by = auth.uid()
    )
  );

create policy "appointments_insert_own_company"
  on public.appointments
  for insert
  with check (
    company_id = public.get_my_company_id()
    and created_by = auth.uid()
  );

create policy "appointments_update_own_company"
  on public.appointments
  for update
  using (company_id = public.get_my_company_id())
  with check (
    company_id = public.get_my_company_id()
    and (
      (select role from public.profiles where id = auth.uid()) in ('admin', 'evaluator')
      or ((select role from public.profiles where id = auth.uid()) = 'seller' and created_by = auth.uid())
    )
  );

create policy "appointments_admin_delete"
  on public.appointments
  for delete
  using (
    company_id = public.get_my_company_id()
    and (select role from public.profiles where id = auth.uid()) = 'admin'
  );

-- ----------------------------------------------------------------
-- 4) FUNCAO FINAL: valida cancelamento + preenche campos de auditoria
-- ----------------------------------------------------------------
create or replace function public.validate_and_fill_appointment_cancellation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  my_role text;
  v_admin text := 'admin';
  v_eval  text := 'evaluator';
begin
  if new.status is distinct from 'cancelled' then
    return new;
  end if;

  begin
    select p.role into my_role
    from public.profiles p
    where p.id = auth.uid()
    limit 1;
  exception when others then
    my_role := null;
  end;

  if new.cancelled_at is null then
    new.cancelled_at := timezone('utc', now());
  end if;

  if new.cancelled_by is null then
    new.cancelled_by := auth.uid();
  end if;

  if new.cancellation_reason is null or char_length(trim(new.cancellation_reason)) < 2 then
    if old.cancellation_request_reason is not null and char_length(trim(old.cancellation_request_reason)) > 2 then
      new.cancellation_reason := old.cancellation_request_reason;
    elsif my_role = v_admin then
      new.cancellation_reason := 'Cancelamento direto efetuado por gerente.';
    elsif my_role = v_eval then
      new.cancellation_reason := 'Cancelamento direto efetuado por avaliador.';
    else
      new.cancellation_reason := 'Cancelamento aprovado.';
    end if;
  end if;

  -- Se o VENDEDOR solicitou cancelamento (campo preenchido): EXIGE PELO MENOS UMA aprovacao
  if old.cancellation_requested_at is not null then
    if (
      (new.cancellation_admin_approved_at is null and new.cancellation_evaluator_approved_at is null)
      and
      (old.cancellation_admin_approved_at is null and old.cancellation_evaluator_approved_at is null)
    ) then
      raise exception 'Cancelamento requer aprovacao de admin OU evaluator (basta um dos dois). O vendedor precisa solicitar o cancelamento primeiro para que o gerente ou avaliador aprove.';
    end if;
  end if;

  -- Preenche o outro lado de aprovacao tambem (mantem log completo)
  if (new.cancellation_admin_approved_at is not null and new.cancellation_evaluator_approved_at is null) then
    new.cancellation_evaluator_approved_at := new.cancellation_admin_approved_at;
    new.cancellation_evaluator_approved_by := coalesce(new.cancellation_evaluator_approved_by, auth.uid());
  end if;
  if (new.cancellation_evaluator_approved_at is not null and new.cancellation_admin_approved_at is null) then
    new.cancellation_admin_approved_at := new.cancellation_evaluator_approved_at;
    new.cancellation_admin_approved_by := coalesce(new.cancellation_admin_approved_by, auth.uid());
  end if;

  return new;
end;
$$;

create trigger appointments_final_cancel_validation
before update on public.appointments
for each row
when (
  new.status is distinct from old.status
  and new.status = 'cancelled'
)
execute function public.validate_and_fill_appointment_cancellation();
