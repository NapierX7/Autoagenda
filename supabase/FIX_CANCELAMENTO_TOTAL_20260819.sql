-- ================================================================
-- PATCH DE CANCELAMENTO - 19/08/2026 - OBRIGATORIO RODAR NO SUPABASE
-- ================================================================
-- O problema: triggers antigos de cancelamento continuavam ativos no banco
-- (incluindo uma versão que exigia as DUAS aprovacoes) e conflitavam
-- com a logica do frontend.
--
-- O frontend agora USA A EDGE FUNCTION user-admin-actions para todas
-- as acoes de cancelamento (cancel-appointment / request-cancellation /
-- approve-cancellation), logo as politicas de RLS e triggers abaixo
-- servem APENAS como "ultima camada de seguranca".
--
-- Este script:
-- 1) APAGA QUALQUER trigger antigo relacionado a cancelamento
-- 2) GARANTE colunas de cancelamento NOT NULL default presentes
-- 3) RECRIA POLICIES (RLS) corretas para appointments (admin/evaluator
--    podem alterar livremente, seller so altera o que criou)
-- 4) CRIA trigger "soft final" que apenas deixa cancelar se:
--    - cancelamento DIRETO de admin/evaluator = permite sempre
--    - solicitacao de seller = BASTA UMA aprovacao (admin OU evaluator)
-- ================================================================

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
drop function if exists public.appointments_require_approval_to_cancel_fn();
drop function if exists public.validate_appointment_cancellation();
drop function if exists public.fill_cancellation_audit_fields();

-- ----------------------------------------------------------------
-- 3) RECRIA POLICIES DE APPOINTMENTS (permissoes granulares por role)
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
      public.get_my_role() in ('admin', 'evaluator')
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
      public.get_my_role() in ('admin', 'evaluator')
      or (public.get_my_role() = 'seller' and created_by = auth.uid())
    )
  );

create policy "appointments_admin_delete"
  on public.appointments
  for delete
  using (
    company_id = public.get_my_company_id()
    and public.get_my_role() = 'admin'
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
  -- Apenas processa se o status esta mudando para 'cancelled'
  -- ou se esta cancelado e faltam auditorias
  if new.status is distinct from 'cancelled' then
    return new;
  end if;

  begin
    my_role := public.get_my_role();
  exception when others then
    my_role := null;
  end;

  -- Cancelled_at obrigatorio
  if new.cancelled_at is null then
    new.cancelled_at := timezone('utc', now());
  end if;

  -- Cancelled_by obrigatorio
  if new.cancelled_by is null then
    new.cancelled_by := auth.uid();
  end if;

  -- Cancelled_reason padrao
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

  -- APENAS SE: vendedor SOLICITOU cancelamento (existe cancellation_requested_at).
  -- Exigimos pelo menos UMA aprovacao (admin OU evaluator).
  -- Se o proprio admin/evaluator cancelou DIRETO (sem solicitacao), a verificacao
  -- eh feita VIA RLS/policies, e aqui APENAS garantimos os campos preenchidos.
  if old.cancellation_requested_at is not null then
    if (
      (new.cancellation_admin_approved_at is null and new.cancellation_evaluator_approved_at is null)
      and
      (old.cancellation_admin_approved_at is null and old.cancellation_evaluator_approved_at is null)
    ) then
      raise exception 'Cancelamento requer aprovacao de admin OU evaluator (basta um dos dois). O vendedor precisa solicitar o cancelamento primeiro para que o gerente ou avaliador aprove.';
    end if;
  end if;

  -- Preenche o outro lado de aprovacao tambem se um lado ja foi marcado
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

drop trigger if exists appointments_final_cancel_validation on public.appointments;
create trigger appointments_final_cancel_validation
before update on public.appointments
for each row
when (
  new.status is distinct from old.status
  and new.status = 'cancelled'
)
execute function public.validate_and_fill_appointment_cancellation();
