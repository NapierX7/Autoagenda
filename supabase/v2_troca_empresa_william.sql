-- =====================================================
-- PASSO 1: VEJA QUAIS EMPRESAS EXISTEM e ANOTE o ID DA EMPRESA CERTA
-- =====================================================
select
  id as company_id,
  name as nome_empresa,
  slug,
  created_at as criada_em
from public.companies
order by created_at;

-- =====================================================
-- PASSO 2: VEJA QUAL EMPRESA O WILLIAM ESTA HOJE (para conferir)
-- =====================================================
select
  au.email,
  p.company_id as empresa_atual_id,
  c.name as empresa_atual_nome,
  p.role as cargo,
  p.full_name
from auth.users au
join public.profiles p on p.id = au.id
left join public.companies c on c.id = p.company_id
where au.email = 'william.msilva@grupojorlan.com';

-- =====================================================
-- PASSO 3: TROQUE o William para a EMPRESA CERTA
-- =====================================================
-- -- INSTRUCAO:
--   Copie o UUID da empresa CERTA do PASSO 1
--   e cole no lugar de TROQUE_AQUI_PELO_ID_DA_EMPRESA_CERTA
--   DEPOIS apague os -- das 2 linhas ABAIXO e RODE.
--
-- update public.profiles p
-- set company_id = 'TROQUE_AQUI_PELO_ID_DA_EMPRESA_CERTA'
-- from auth.users au
-- where au.id = p.id
--   and au.email = 'william.msilva@grupojorlan.com';

-- =====================================================
-- PASSO 4 (DEPOIS DE RODAR O UPDATE): CONFIRMA se deu certo
-- =====================================================
-- select
--   au.email,
--   p.company_id,
--   c.name as nome_nova_empresa,
--   p.role,
--   p.full_name
-- from auth.users au
-- join public.profiles p on p.id = au.id
-- join public.companies c on c.id = p.company_id
-- where au.email = 'william.msilva@grupojorlan.com';
