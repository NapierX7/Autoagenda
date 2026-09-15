-- =====================================================
-- WILLIAM - GERENTE DA LOJA
-- SQL DIRETO, SEM RAISE, SEM FUNCOES, SEM ERROS!
-- =====================================================

-- PASSO 0 - Colunas que talvez ainda nao existam (sem erro):
alter table public.profiles add column if not exists approval_status text not null default 'approved';
alter table public.profiles add column if not exists requested_at timestamptz;
alter table public.profiles add column if not exists is_active boolean not null default true;

-- =====================================================
-- PASSO 1 - CRIE o usuário William primeiro NO PAINEL:
--   Authentication → Users → Add user → Create new user
--   Email: william.msilva@grupojorlan.com
--   Senha: (qualquer forte, ex: William@Jorlan2026!)
--   ✅ Auto confirm user → CRIAR
--
-- DEPOIS que criar o usuario no Auth, volte aqui e rode os 2 comandos ABAIXO.
-- =====================================================

-- PASSO 2 - Atualiza (ou cria) perfil como GERENTE ADMIN:
insert into public.profiles (id, company_id, full_name, role, approval_status, is_active, created_at)
select
  au.id,
  (select id from public.companies order by created_at asc limit 1),
  'William Silva - Gerente',
  'admin',
  'approved',
  true,
  now()
from auth.users au
where au.email = 'william.msilva@grupojorlan.com'
  and not exists (select 1 from public.profiles p where p.id = au.id);

-- PASSO 3 - Garante hierarquia GERENTE mesmo que ja existia perfil:
update public.profiles p
set
  company_id = (select id from public.companies order by created_at asc limit 1),
  full_name = 'William Silva - Gerente',
  role = 'admin',
  approval_status = 'approved',
  is_active = true
from auth.users au
where au.id = p.id
  and au.email = 'william.msilva@grupojorlan.com';

-- PASSO 4 - CONFIRMACAO (confira se deu certo):
select
  au.email,
  p.role as "Hierarquia",
  p.approval_status,
  p.is_active,
  p.full_name,
  p.company_id
from auth.users au
left join public.profiles p on p.id = au.id
where au.email = 'william.msilva@grupojorlan.com';
