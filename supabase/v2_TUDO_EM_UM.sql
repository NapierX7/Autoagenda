-- =====================================================
-- SCRIPT FINAL - TODAS AS FUNCOES / TRIGGERS OBRIGATORIOS
-- AutoAgenda V2 - SQL Editor Supabase
-- Basta colar e rodar UMA VEZ. Nao tem conflito.
-- =====================================================

-- =====================================================
-- COLUNA email EM profiles (se nao existir)
-- =====================================================
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'email'
  ) then
    alter table public.profiles add column email text;
  end if;
end $$;

-- =====================================================
-- FUNCAO get_my_company_id (atualiza, sem apagar, sem CASCADE)
-- =====================================================
create or replace function public.get_my_company_id()
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
-- FUNCAO get_profiles_of_my_company (APAGA e RECRIA com cast seguro)
-- =====================================================
drop function if exists public.get_profiles_of_my_company();

create or replace function public.get_profiles_of_my_company()
returns table (
  id uuid,
  full_name text,
  email text,
  role text,
  approval_status text,
  requested_at timestamptz,
  created_at timestamptz,
  is_active boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
begin
  select p.company_id into v_company_id
    from public.profiles p
   where p.id = auth.uid()
   limit 1;

  if v_company_id is null then
    return;
  end if;

  return query
  select
    p.id::uuid                                    as id,
    coalesce(p.full_name, '(sem nome)')::text     as full_name,
    coalesce(au.email, '(sem email)')::text       as email,
    coalesce(p.role, 'seller')::text              as role,
    coalesce(p.approval_status, 'approved')::text as approval_status,
    p.requested_at::timestamptz                    as requested_at,
    p.created_at::timestamptz                      as created_at,
    coalesce(p.is_active, true)::boolean           as is_active
  from public.profiles p
  left join auth.users au on au.id = p.id
  where p.company_id = v_company_id
  order by p.created_at desc;
end;
$$;
revoke all on function public.get_profiles_of_my_company() from public;
grant execute on function public.get_profiles_of_my_company() to authenticated;

-- =====================================================
-- TRIGGER handle_new_user (rede de seguranca cadastro)
-- =====================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role       text;
  v_company_id uuid;
  v_full_name  text;
  v_email_text text;
begin
  v_email_text := new.email;
  v_full_name  := coalesce(new.raw_user_meta_data->>'full_name', '');
  v_role       := coalesce(new.raw_user_meta_data->>'role', 'seller');

  begin
    v_company_id := (new.raw_user_meta_data->>'company_id')::uuid;
  exception when others then
    v_company_id := null;
  end;

  if v_company_id is not null then
    insert into public.profiles (
      id, email, full_name, role, approval_status, is_active, company_id, requested_at, created_at
    )
    values (
      new.id,
      v_email_text,
      v_full_name,
      v_role,
      case when v_role in ('admin','evaluator') then 'approved' else 'pending' end,
      true,
      v_company_id,
      now(),
      now()
    )
    on conflict (id) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- =====================================================
-- CORRETIVO profiles para usuarios auth.users SEM profile
-- (so cria se tiver company_id valido no metadata)
-- =====================================================
insert into public.profiles (
  id, email, full_name, role, approval_status, is_active, company_id, created_at
)
select
  au.id,
  au.email,
  coalesce(au.raw_user_meta_data->>'full_name', ''),
  coalesce(au.raw_user_meta_data->>'role', 'seller'),
  case
    when coalesce(au.raw_user_meta_data->>'role', 'seller') in ('admin','evaluator') then 'approved'
    else 'pending'
  end,
  true,
  (au.raw_user_meta_data->>'company_id')::uuid,
  now()
from auth.users au
where not exists (select 1 from public.profiles p where p.id = au.id)
  and (au.raw_user_meta_data->>'company_id') is not null
  and exists (
    select 1 from public.companies c
    where c.id = (au.raw_user_meta_data->>'company_id')::uuid
  );

-- =====================================================
-- CORRETIVO ESPECIFICO DAYANE ALVES (Grupo Jorlan)
-- Se a empresa dela for outra, troque o UUID abaixo.
-- =====================================================
do $$
declare
  v_empresa uuid := '423aa88f-fbbb-4c9f-9cc6-d1adf14fc85b';
begin
  if exists (select 1 from public.companies where id = v_empresa) then
    insert into public.profiles (
      id, email, full_name, role, approval_status, is_active, company_id, created_at
    )
    select
      au.id,
      au.email,
      coalesce(au.raw_user_meta_data->>'full_name', 'Dayane Alves Pereira'),
      'seller',
      'approved',
      true,
      v_empresa,
      now()
    from auth.users au
    where au.email = 'dayane.alves@grupojorlan.com'
      and not exists (select 1 from public.profiles p where p.id = au.id);
  end if;
end $$;

-- FIM - SCRIPT COMPLETO
