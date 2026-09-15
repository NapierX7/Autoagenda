-- =====================================================
-- WILLIAM MASTER - FIX - SQL 100% COMPATÍVEL COM SQL EDITOR DO SUPABASE
-- =====================================================
-- COMO USAR:
--   1. Abra o Supabase Dashboard → SQL Editor → New Query
--   2. COLE TODO esse arquivo
--   3. Aperte RUN (▶️)
--   4. Veja a saida na tabela RESULTADO no final
-- =====================================================

-- PASSO 0 - Cria colunas que talvez ainda nao existam (sem erro se já existir)
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='approval_status') then
    alter table public.profiles add column approval_status text not null default 'approved';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='requested_at') then
    alter table public.profiles add column requested_at timestamptz;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='is_active') then
    alter table public.profiles add column is_active boolean not null default true;
  end if;
end $$;

-- PASSO 1 - Descobre AUTOMATICAMENTE o company_id correto da empresa master.
--          (se tiver mais de uma empresa, use a que voce quer — a consulta abaixo ja lista)
do $$
declare
  v_company uuid;
  v_user_id uuid;
  v_profile_exists boolean;
  v_auth_exists boolean;
  v_company_count int;
begin

  select count(*) into v_company_count from public.companies;

  if v_company_count = 0 then
    raise notice '%%% NENHUMA EMPRESA CRIADA AINDA. Crie uma empresa primeiro em public.companies. %%%';
    return;
  end if;

  -- Pega a primeira empresa (a mais antiga / master). Se voce quiser outra, troque por SELECT id FROM companies WHERE name = 'NOME_EMPRESA'.
  select id into v_company from public.companies order by created_at asc limit 1;
  raise notice 'EMPRESA SELECIONADA (master): %', v_company;

  -- PASSO 2 - Verifica se william ja tem usuario em auth.users
  select exists (select 1 from auth.users where email = 'william.msilva@grupojorlan.com') into v_auth_exists;

  if not v_auth_exists then
    raise notice '%%% AVISO: william.msilva@grupojorlan.com NAO EXISTE no auth.users AINDA. %%%';
    raise notice 'Voce tem 2 opcoes:';
    raise notice 'OPCAO A (RECOMENDADA, MAIS SEGURA):';
    raise notice '   Menu Authentication > Users > Add user > Create new user';
    raise notice '   Email: william.msilva@grupojorlan.com    Senha: (qualquer forte)   ✅ Auto confirm user';
    raise notice '   E DEPOIS volte aqui e RODE esse mesmo SQL de novo para atualizar public.profiles';
    raise notice ' ';
    raise notice 'OPCAO B (rodar aqui mesmo via SQL, precisa de EXTENSION pgcrypto):';
    raise notice '   Descomente o trecho OPCAO B no FINAL desse arquivo e rode novamente';
    return;
  end if;

  -- PASSO 3 - Pega o id do usuario auth
  select id into v_user_id from auth.users where email = 'william.msilva@grupojorlan.com';
  raise notice 'ID auth William: %', v_user_id;

  -- PASSO 4 - Verifica / Cria perfil em public.profiles
  select exists (select 1 from public.profiles where id = v_user_id) into v_profile_exists;

  if not v_profile_exists then
    raise notice 'Criando registro em public.profiles...';
    insert into public.profiles (id, company_id, full_name, role, approval_status, is_active, created_at)
    values (v_user_id, v_company, 'William Silva - Master', 'admin', 'approved', true, now());
    raise notice 'OK: perfil criado.';
  else
    raise notice 'Perfil ja existia. Atualizando para MASTER ADMIN...';
    update public.profiles
    set
      company_id = v_company,
      full_name = 'William Silva - Master',
      role = 'admin',
      approval_status = 'approved',
      is_active = true
    where id = v_user_id;
    raise notice 'OK: perfil atualizado.';
  end if;

end $$;

-- =====================================================
-- PASSO FINAL - Mostra RESULTADO para voce confirmar
-- =====================================================
select
  p.id,
  p.full_name,
  p.role,
  p.approval_status,
  p.is_active,
  au.email,
  au.created_at as "Criado em",
  p.company_id
from public.profiles p
join auth.users au on au.id = p.id
where au.email = 'william.msilva@grupojorlan.com';

-- =====================================================
-- (OPCAO B - SOMENTE SE VOCE QUISER CRIAR auth.users POR SQL, NAO pelo dashboard)
-- para usar: descomente APENAS as linhas ABAIXO. De preferencia use a OPCAO A.
-- =====================================================
/*
create extension if not exists pgcrypto;

insert into auth.users (
  instance_id, id, aud, role, email,
  encrypted_password, email_confirmed_at,
  recovery_sent_at, last_sign_in_at,
  raw_app_meta_data, raw_user_meta_data,
  is_super_admin, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change, is_sso_user
) select
    '00000000-0000-0000-0000-000000000000',
    gen_random_uuid(),
    'authenticated',
    'authenticated',
    'william.msilva@grupojorlan.com',
    crypt('William@Jorlan2026!', gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"William Silva - Master"}',
    false, now(), now(),
    '', '', '', '', false
where not exists (select 1 from auth.users where email = 'william.msilva@grupojorlan.com');
*/
