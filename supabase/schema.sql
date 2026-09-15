create extension if not exists pgcrypto;

create type public.appointment_status as enum ('scheduled', 'completed', 'cancelled');

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete restrict,
  full_name text not null,
  role text not null default 'admin' check (role in ('admin', 'seller', 'evaluator')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  created_by uuid not null references public.profiles (id) on delete restrict,
  appointment_date date not null,
  appointment_time time not null,
  customer_name text not null,
  customer_phone text not null,
  customer_cpf text,
  customer_zip_code text,
  customer_email text,
  customer_address text,
  seller_name text not null,
  vehicle_plate text not null,
  vehicle_model text not null,
  vehicle_year integer not null check (vehicle_year between 1900 and 2100),
  notes text,
  cancellation_requested_at timestamptz,
  cancellation_requested_by uuid references public.profiles (id) on delete set null,
  cancellation_request_reason text,
  cancellation_admin_approved_at timestamptz,
  cancellation_admin_approved_by uuid references public.profiles (id) on delete set null,
  cancellation_evaluator_approved_at timestamptz,
  cancellation_evaluator_approved_by uuid references public.profiles (id) on delete set null,
  status public.appointment_status not null default 'scheduled',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.company_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique references public.companies (id) on delete cascade,
  display_name text,
  timezone text not null default 'America/Sao_Paulo',
  contact_phone text,
  schedule_config jsonb not null default jsonb_build_object(
    'businessDays', jsonb_build_array('Segunda', 'Terca', 'Quarta', 'Quinta', 'Sexta'),
    'timeSlots', jsonb_build_array('09:00', '10:00', '11:00', '12:00', '14:00', '15:00', '16:00')
  ),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index appointments_active_slot_unique
  on public.appointments (company_id, appointment_date, appointment_time)
  where status in ('scheduled', 'completed');

create index appointments_company_date_idx
  on public.appointments (company_id, appointment_date);

create index appointments_company_status_idx
  on public.appointments (company_id, status);

create trigger set_companies_updated_at
before update on public.companies
for each row
execute function public.set_updated_at();

create trigger set_profiles_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

create trigger set_appointments_updated_at
before update on public.appointments
for each row
execute function public.set_updated_at();

create trigger set_company_settings_updated_at
before update on public.company_settings
for each row
execute function public.set_updated_at();

create or replace function public.get_my_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select profiles.company_id
  from public.profiles
  where profiles.id = auth.uid();
$$;

alter table public.companies enable row level security;
alter table public.profiles enable row level security;
alter table public.appointments enable row level security;
alter table public.company_settings enable row level security;

create policy "companies_select_own"
  on public.companies
  for select
  using (id = public.get_my_company_id());

create policy "companies_update_own"
  on public.companies
  for update
  using (id = public.get_my_company_id())
  with check (id = public.get_my_company_id());

create policy "profiles_select_own_company"
  on public.profiles
  for select
  using (company_id = public.get_my_company_id());

create policy "profiles_update_own_record"
  on public.profiles
  for update
  using (id = auth.uid())
  with check (id = auth.uid() and company_id = public.get_my_company_id());

create policy "appointments_select_own_company"
  on public.appointments
  for select
  using (company_id = public.get_my_company_id());

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
  with check (company_id = public.get_my_company_id());

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

comment on table public.companies is 'Empresa cliente do AutoAgenda.';
comment on table public.profiles is 'Usuarios autenticados vinculados a uma empresa.';
comment on table public.appointments is 'Agendamentos de laudos cautelares de cada empresa.';
comment on table public.company_settings is 'Configuracoes basicas da empresa, incluindo agenda futura personalizavel.';

comment on column public.appointments.status is 'scheduled = ocupado, completed = finalizado, cancelled = cancelado.';
comment on column public.appointments.cancellation_requested_at is 'Quando o vendedor solicita o cancelamento e inicia o fluxo de aprovacao.';
