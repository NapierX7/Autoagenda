-- =====================================================
-- 1. GARANTE COLUNA email EM profiles (se faltar)
-- =====================================================
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'profiles'
      and column_name  = 'email'
  ) then
    alter table public.profiles add column email text;
  end if;
end $$;

-- =====================================================
-- 2. TRIGGER REDE DE SEGURANCA
--    OBS: company_id tem NOT NULL na tabela profiles,
--    entao SO insere se a empresa existir no metadata.
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

  -- company_id NOT NULL em profiles:
  if v_company_id is not null then
    insert into public.profiles (
      id,
      email,
      full_name,
      role,
      approval_status,
      is_active,
      company_id,
      requested_at,
      created_at
    )
    values (
      new.id,
      v_email_text,
      v_full_name,
      v_role,
      case when v_role in ('admin', 'evaluator') then 'approved' else 'pending' end,
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
-- 3. CORRETIVA: cria profiles SOMENTE se tiver company_id
--    valido no metadata (evita NOT NULL violation)
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
where not exists (
  select 1 from public.profiles p where p.id = au.id
)
  and (au.raw_user_meta_data->>'company_id') is not null
  and exists (
    select 1 from public.companies c
    where c.id = (au.raw_user_meta_data->>'company_id')::uuid
  );

-- =====================================================
-- 4. PATCH ESPECIFICO DAYANE ALVES (email @grupojorlan)
--    Vincula ao Grupo Jorlan (id 423aa88f-fbbb-4c9f-9cc6-d1adf14fc85b)
--    Ajuste o UUID abaixo se a empresa dela for outra.
-- =====================================================
do $$
declare
  v_empresa_grupo_jorlan uuid := '423aa88f-fbbb-4c9f-9cc6-d1adf14fc85b';
begin
  if exists (
    select 1 from public.companies where id = v_empresa_grupo_jorlan
  ) then
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
      v_empresa_grupo_jorlan,
      now()
    from auth.users au
    where au.email = 'dayane.alves@grupojorlan.com'
      and not exists (
        select 1 from public.profiles p where p.id = au.id
      );
  end if;
end $$;

-- FIM
