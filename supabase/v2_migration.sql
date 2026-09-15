-- AutoAgenda V2 Migration
-- Novos campos: voucher, laudo (resultado/motivo/arquivo), reagendamento

create type public.laudo_result as enum ('approved', 'rejected');

alter table public.appointments
  add column if not exists is_voucher boolean not null default false,
  add column if not exists voucher_approved_at timestamptz,
  add column if not exists voucher_approved_by uuid references public.profiles (id) on delete set null,
  add column if not exists laudo_result public.laudo_result,
  add column if not exists laudo_rejection_reason text,
  add column if not exists laudo_file_url text,
  add column if not exists laudo_file_name text,
  add column if not exists laudo_finalized_at timestamptz,
  add column if not exists laudo_finalized_by uuid references public.profiles (id) on delete set null,
  add column if not exists original_appointment_date date,
  add column if not exists original_appointment_time time,
  add column if not exists rescheduled_count integer not null default 0,
  add column if not exists seller_email text;

create index if not exists appointments_seller_email_idx
  on public.appointments (company_id, seller_email);

create index if not exists appointments_laudo_result_idx
  on public.appointments (company_id, laudo_result);

create index if not exists appointments_created_by_idx
  on public.appointments (company_id, created_by);

comment on column public.appointments.is_voucher is 'Quando true, apenas o vendedor e nome sao obrigatorios; requer aprovacao do gerente.';
comment on column public.appointments.voucher_approved_at is 'Momento em que o gerente aprovou o uso do voucher.';
comment on column public.appointments.voucher_approved_by is 'Perfil do gerente que aprovou o voucher.';
comment on column public.appointments.laudo_result is 'Resultado final do laudo (aprovado ou reprovado).';
comment on column public.appointments.laudo_rejection_reason is 'Motivo da reprovacao, obrigatorio quando laudo_result = rejected.';
comment on column public.appointments.laudo_file_url is 'URL publica do arquivo PDF do laudo cautelar anexado.';
comment on column public.appointments.laudo_file_name is 'Nome original do arquivo anexado.';
comment on column public.appointments.laudo_finalized_at is 'Momento da finalizacao do laudo com resultado.';
comment on column public.appointments.laudo_finalized_by is 'Perfil que finalizou o laudo (gerente ou avaliador).';
comment on column public.appointments.original_appointment_date is 'Data original antes de qualquer reagendamento.';
comment on column public.appointments.original_appointment_time is 'Horario original antes de qualquer reagendamento.';
comment on column public.appointments.rescheduled_count is 'Quantas vezes esse agendamento foi reagendado.';
comment on column public.appointments.seller_email is 'Email do vendedor criador do agendamento, para vincular indicadores individuais.';

drop policy if exists "appointments_sellers_see_own" on public.appointments;
create policy "appointments_sellers_see_own"
  on public.appointments
  for select
  using (
    company_id = public.get_my_company_id()
    and (
      (select role from public.profiles where id = auth.uid()) in ('admin', 'evaluator')
      or created_by = auth.uid()
    )
  );

drop policy if exists "appointments_admin_delete" on public.appointments;
create policy "appointments_admin_delete"
  on public.appointments
  for delete
  using (
    company_id = public.get_my_company_id()
    and (select role from public.profiles where id = auth.uid()) = 'admin'
  );

drop policy if exists "profiles_admin_manage" on public.profiles;
create policy "profiles_admin_manage"
  on public.profiles
  for insert
  with check (
    company_id = public.get_my_company_id()
    and (select role from public.profiles where id = auth.uid()) = 'admin'
  );

drop policy if exists "profiles_admin_update_any" on public.profiles;
create policy "profiles_admin_update_any"
  on public.profiles
  for update
  using (
    company_id = public.get_my_company_id()
    and (select role from public.profiles where id = auth.uid()) = 'admin'
  )
  with check (
    company_id = public.get_my_company_id()
  );

create or replace function public.is_current_user_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
  );
$$;

create or replace function public.get_profiles_of_my_company()
returns table (
  id uuid,
  full_name text,
  role text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name, p.role, p.created_at
  from public.profiles p
  where p.company_id = public.get_my_company_id()
  order by p.full_name;
$$;

grant execute on function public.is_current_user_admin() to authenticated;
grant execute on function public.get_profiles_of_my_company() to authenticated;
