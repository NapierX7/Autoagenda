create table if not exists public.company_settings (
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

drop trigger if exists set_company_settings_updated_at on public.company_settings;
create trigger set_company_settings_updated_at
before update on public.company_settings
for each row
execute function public.set_updated_at();

alter table public.company_settings enable row level security;

drop policy if exists "company_settings_select_own" on public.company_settings;
create policy "company_settings_select_own"
  on public.company_settings
  for select
  using (company_id = public.get_my_company_id());

drop policy if exists "company_settings_insert_own" on public.company_settings;
create policy "company_settings_insert_own"
  on public.company_settings
  for insert
  with check (company_id = public.get_my_company_id());

drop policy if exists "company_settings_update_own" on public.company_settings;
create policy "company_settings_update_own"
  on public.company_settings
  for update
  using (company_id = public.get_my_company_id())
  with check (company_id = public.get_my_company_id());

comment on table public.company_settings is 'Configuracoes basicas da empresa, incluindo agenda futura personalizavel.';
