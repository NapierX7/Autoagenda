-- =====================================================
-- WILLIAM MASTER - Login Admin (william.msilva@grupojorlan.com)
-- =====================================================
-- MÉTODO RECOMENDADO (2 passos, SEM DOR DE CABEÇA):
--
-- PASSO 1 - No DASHBOARD DO SUPABASE:
--   Menu Authentication → Users → "Add user" → "Create new user"
--   Email:    william.msilva@grupojorlan.com
--   Senha:    Defina uma senha forte temporaria (ex: William@Jorlan2026!)
--   ✅ Auto confirm user
--   Clique em Create user
--
-- PASSO 2 - Abra o SQL Editor e COLE o trecho ABAIXO.
--   (primeiro substitua o placeholder UUID pelo company_id da empresa MASTER do William.
--   Para descobrir o company_id:
--     SELECT id, name FROM public.companies ORDER BY created_at;
--
-- =====================================================

-- 👇👇👇 COLOQUE AQUI O UUID DA EMPRESA DO GRUPO JORLAN:
\set company_master 'SUBSTITUA_AQUI_UUID_EMPRESA'

-- Atualiza perfil do William para GERENTE ADMIN (master):
UPDATE public.profiles
SET
  role = 'admin',
  full_name = 'William Silva - Master',
  approval_status = 'approved',
  is_active = true
FROM auth.users au
WHERE public.profiles.id = au.id
  AND au.email = 'william.msilva@grupojorlan.com';

-- Se a linha acima nao encontrar nada (ainda nao existe profile → o trigger Supabase criou profiles automaticamente?)
-- Entao use o INSERT abaixo:
INSERT INTO public.profiles (id, company_id, full_name, role, approval_status, is_active, created_at)
SELECT
  au.id,
  :'company_master',
  'William Silva - Master',
  'admin',
  'approved',
  true,
  now()
FROM auth.users au
WHERE au.email = 'william.msilva@grupojorlan.com'
  AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = au.id);

-- Verifica se deu certo:
SELECT
  p.id,
  p.full_name,
  p.role,
  p.approval_status,
  p.is_active,
  au.email
FROM public.profiles p
JOIN auth.users au ON au.id = p.id
WHERE au.email = 'william.msilva@grupojorlan.com';

-- =====================================================
-- SE VOCÊ PREFERIR CRIAR TUDO VIA SQL MESMO (usando extensão pgcrypto):
-- (descomente as linhas abaixo se precisar, senha criptografada do Postgres)
-- =====================================================
/*
create extension if not exists pgcrypto;

-- Passo 1: inserir auth.users (SOMENTE SE NAO EXISTIR):
insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  recovery_sent_at,
  last_sign_in_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin,
  created_at,
  updated_at,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change,
  is_sso_user
) select
    '00000000-0000-0000-0000-000000000000',
    gen_random_uuid(),
    'authenticated',
    'authenticated',
    'william.msilva@grupojorlan.com',
    crypt('William@Jorlan2026!', gen_salt('bf')),
    now(),
    now(),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"William Silva - Master","role":"admin"}',
    false,
    now(),
    now(),
    '',
    '',
    '',
    '',
    false
  where not exists (select 1 from auth.users where email = 'william.msilva@grupojorlan.com');

-- Passo 2: public.profiles
INSERT INTO public.profiles (id, company_id, full_name, role, approval_status, is_active, created_at)
SELECT u.id,
       (select id from public.companies order by created_at limit 1),
       'William Silva - Master',
       'admin',
       'approved',
       true,
       now()
FROM auth.users u
WHERE u.email = 'william.msilva@grupojorlan.com'
  AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id);

UPDATE public.profiles p
SET role = 'admin',
    full_name = 'William Silva - Master',
    approval_status = 'approved',
    is_active = true
FROM auth.users u
WHERE u.email = 'william.msilva@grupojorlan.com';
*/
