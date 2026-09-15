-- =====================================================
-- TRIGGER REDE DE SEGURANÇA: cria automaticamente o registro em profiles
-- SEMPRE que um novo usuário for inserido em auth.users (qualquer origem)
-- Isso evita o erro: "Cannot coerce the result to a single JSON object"
-- =====================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role          text;
  v_company_id    uuid;
  v_full_name     text;
  v_email_text    text;
begin
  v_email_text := new.email;
  v_full_name  := coalesce(new.raw_user_meta_data->>'full_name', '');
  v_role       := coalesce(new.raw_user_meta_data->>'role', 'seller');

  begin
    v_company_id := (new.raw_user_meta_data->>'company_id')::uuid;
  exception when others then
    v_company_id := null;
  end;

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

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- =====================================================
-- CORRETIVA: cria profiles para usuarios auth.users
-- que ainda nao tem registro em profiles (Bug 2)
-- Se a empresa nao for identificada, deixa company_id NULL
-- para o gerente ajustar depois.
-- =====================================================

insert into public.profiles (
  id, email, full_name, role, approval_status, is_active, created_at
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
  now()
from auth.users au
where not exists (
  select 1 from public.profiles p where p.id = au.id
);

-- FIM
