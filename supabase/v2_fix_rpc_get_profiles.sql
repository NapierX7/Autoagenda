-- =====================================================
-- RECRIAR FUNCAO get_profiles_of_my_company()
--   (INCLUINDO approval_status, is_active, email)
-- =====================================================
-- OBS: a funcao antiga NAO retornava email/is_active/approval_status
-- por isso PRECISAMOS apagar primeiro e criar de novo.
-- =====================================================

-- 1. Apaga a funcao ANTIGA se existir
drop function if exists public.get_profiles_of_my_company();

-- 2. Cria a funcao NOVA com todas as colunas novas:
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
  where p.id = auth.uid();

  if v_company_id is null then
    return;
  end if;

  return query
  select
    p.id,
    p.full_name,
    au.email,
    p.role,
    p.approval_status,
    p.requested_at,
    p.created_at,
    p.is_active
  from public.profiles p
  left join auth.users au on au.id = p.id
  where p.company_id = v_company_id
  order by p.created_at desc;
end;
$$;

-- 3. Permissoes
revoke all on function public.get_profiles_of_my_company() from public;
grant execute on function public.get_profiles_of_my_company() to authenticated;

-- 4. Teste para confirmar que funcionou:
select count(*) as total_usuarios_empresa
from public.get_profiles_of_my_company();

-- (se vc quiser ver todos as colunas):
select * from public.get_profiles_of_my_company() order by created_at desc;
