-- =====================================================
-- URGENTE: Resolve problema da IRIS HELEN SILVA REIS
--         iris.silva@grupojorlan.com
-- 1. Confirma o email (ela nunca confirmou, login travava)
-- 2. Cria profile em public.profiles se ainda nao existir
-- 3. Atualiza senha temporaria diretamente (opcional)
-- =====================================================

-- Empresa Grupo Jorlan (se a Iris for de outra loja, troque pelo UUID certo)
-- GWM:     af8c268c-504c-48df-8d82-c50d605992ec
-- JORLAN:  423aa88f-fbbb-4c9f-9cc6-d1adf14fc85b
\set iris_company_id '''423aa88f-fbbb-4c9f-9cc6-d1adf14fc85b'''
\set iris_uid        '''8acde249-93aa-4c19-a854-ea63de91bbdd'''
\set iris_email      '''iris.silva@grupojorlan.com'''
\set iris_nome       '''IRIS HELEN SILVA REIS'''

-- PASSO 1: Confirmar email (bypass confirmacao)
update auth.users
set email_confirmed_at = coalesce(email_confirmed_at, now())
where id = :iris_uid
  and email_confirmed_at is null;

-- PASSO 2: Garante profile em public.profiles
insert into public.profiles (
  id, email, full_name, role, company_id, approval_status, is_active, requested_at, created_at
)
values (
  :iris_uid::uuid,
  :iris_email,
  :iris_nome,
  'seller',
  :iris_company_id::uuid,
  'approved',
  true,
  now(),
  now()
)
on conflict (id) do update
  set company_id = coalesce(excluded.company_id, public.profiles.company_id),
      approval_status = coalesce(public.profiles.approval_status, 'approved'),
      is_active = coalesce(public.profiles.is_active, true),
      full_name = coalesce(nullif(public.profiles.full_name, ''), excluded.full_name),
      email = coalesce(public.profiles.email, excluded.email);

-- PASSO 3: Confere se ficou tudo certo
select
  au.id,
  au.email,
  au.email_confirmed_at,
  p.full_name,
  p.role,
  p.approval_status,
  p.is_active,
  c.name as empresa
from auth.users au
left join public.profiles p on p.id = au.id
left join public.companies c on c.id = p.company_id
where au.id = :iris_uid::uuid;

-- --------------------------------------------
-- PARA TROCAR A SENHA DA IRIS TAMBEM VIA SQL:
-- (descomente as 3 linhas abaixo e rode)
-- update auth.users
-- set encrypted_password = crypt('Iris@Jorlan2026', gen_salt('bf'))
-- where id = :iris_uid::uuid;
--
-- Depois avise ela: senha temporaria = Iris@Jorlan2026!  (ela troca depois)
-- --------------------------------------------
