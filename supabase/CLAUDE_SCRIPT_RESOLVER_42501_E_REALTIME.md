================================================================================
SCRIPT / PROMPT PRONTO PARA COLAR NO CLAUDE (Anthropic) — AutoAgenda Resolver 42501 + Realtime
================================================================================
LÍNGUA: Português do Brasil (pt-BR)
CONTEXTO: Sou dono do projeto AutoAgenda (SaaS multi-tenant laudos cautelares, 
React 19 + Vite 7 + Supabase PostgreSQL). Tenho ERROS GRAVES de permissão 
(PostgreSQL 42501 "permission denied") e Realtime não sincroniza entre perfis.

O QUE EU QUERO QUE VOCÊ (CLAUDE) FAÇA:
1. Ler TODO este prompt com atenção, NA ORDEM.
2. Entender EXATAMENTE os erros.
3. EXECUTAR o script SQL FINAL fornecido (SOS_42501_V3_DEFINITIVO) NO BANCO
   DO SUPABASE DO PROJETO AutoAgenda — via SQL Editor do painel Supabase OU
   através da MCP do Supabase que você tiver acesso.
4. APÓS rodar o SQL: executar as 3 queries de VALIDAÇÃO POST-EXECUÇÃO e 
   confirmar para MIM o resultado de CADA UMA (1, 2, 3).
5. DEPOIS: fornecer um checklist FINAL de 5 itens para eu validar no navegador.

================================================================================
## 1. DIAGNÓSTICO CONFIRMADO DOS ERROS (NÃO PRECISA INVESTIGAR NOVAMENTE)
================================================================================

ERRO 1 — PostgreSQL 42501 "permission denied" EM TODAS AS AÇÕES ADMIN/AVALIADOR:
- Causa RAIZ confirmada 100%: O projeto usava RLS policies baseadas em 
  `auth.jwt() -> 'app_metadata' ->> 'role'` para descobrir se o usuário era
  'admin'/'evaluator'/'seller'.
- PORÉM: O role dos usuários ESTÁ APENAS na tabela `public.profiles.role`, 
  NÃO ESTÁ gravado no `auth.users.app_metadata` do Supabase Auth!
- Resultado: `coalesce(auth.jwt()->'app_metadata'->>'role', '')` retorna 
  STRING VAZIA para TODOS os usuários → as condições de admin/evaluator 
  NUNCA são verdadeiras → queda para a regra de seller (created_by = auth.uid())
  → qualquer ação de editar/deletar agendamento feito por outra pessoa 
  (incluindo admin editando seller) DÁ 42501.
- SOLUÇÃO JÁ PRONTA (abaixo no script SQL): CRIAR UMA SEGUNDA RPC 
  `public.get_my_role()` do tipo **SECURITY DEFINER** (igual a get_my_company_id)
  que busca `profiles.role` DIRETO no banco (bypass RLS porque executa como
  OWNER). Isso NUNCA dá recursão porque a função executa SEM passar por RLS.
  Todas as policies de `appointments` são refatoradas para usar `get_my_role()`
  no lugar de `auth.jwt() -> ...`.

ERRO 2 — REALTIME NÃO SINCRONIZA "não atualiza para os outros o que preenche 
em um perfil":
- Causa RAIZ confirmada 100%: a tabela `public.appointments` NÃO ESTÁ marcada
  na publication `supabase_realtime` do PostgreSQL (WAL do Supabase).
- O frontend CONECTA no websocket Realtime (phx_join ok, heartbeats a cada 30s)
  mas o Supabase NUNCA envia eventos porque a tabela não está na lista WAL.
- Também falta `ALTER TABLE public.appointments REPLICA IDENTITY FULL` para que
  UPDATE/DELETE enviem payload OLD+NEW COMPLETO, não apenas a PK.
- SOLUÇÃO JÁ PRONTA (script SQL bloco 9 DO $$ checagem + ADD TABLE).

ERRO 3 — UX CONFLITO 23505: "Este horário acabou de ser ocupado por outro usuário"
- Causa: PostgreSQL UNIQUE key violation 23505 em (appointment_date, 
  appointment_time, company_id) quando 2 clients clicam no mesmo slot ANTES do 
  polling sincronizar.
- SOLUÇÃO JÁ APLICADA NO FRONTEND (já está no build): AppointmentModal recebe 
  prop onForceRefresh, detecta erro 23505 por texto, chama refreshWeek em 
  background, exibe botões "🔄 Atualizar agenda agora" + "Tentar novamente".
- Polling fallback reduzido de 10s → 3s (ja esta no build).

================================================================================
## 2. RESTRIÇÕES ABSOLUTAS (NÃO PODE DESCUMPRIR EM NENHUMA HIPÓTESE):
================================================================================
✅ NÃO pode ALTERAR ESTRUTURA do banco public.* (NÃO cria coluna NOVA, NÃO 
   dropa tabela, NÃO muda tipo de coluna, NÃO cria constraint/triggers NOVOS).
✅ APENAS permitido: DROP/RECriar POLICIES RLS; DROP/RECriar FUNÇÕES (RPCs) 
   get_my_company_id e get_my_role (E SÓ ESSAS DUAS); UPDATE em profiles para 
   sincronizar email/approval_status/is_active (E SÓ ESSES CAMPOS); ALTER 
   PUBLICATION e ALTER TABLE ... REPLICA IDENTITY (não altera estrutura).
✅ Script deve rodar de FORMA ATÔMICA e IDEMPOTENTE: se rodar 2x NÃO QUEBRA.
✅ Todas policies de appointments devem usar as 2 RPCs SECURITY DEFINER:
   public.get_my_company_id() e public.get_my_role().
   NÃO PODE USAR MAIS auth.jwt() -> 'app_metadata' ->> 'role' EM NENHUMA POLICY.

================================================================================
## 3. SCRIPT SQL COMPLETO QUE VOCÊ DEVE EXECUTAR NO SUPABASE:
================================================================================

Cole TODO este conteúdo de "---------------- INÍCIO DO SQL ----------------" 
até "---------------- FIM DO SQL ----------------" no SQL Editor do projeto
AutoAgenda no Supabase (Dashboard → SQL Editor → New Query) e clique RUN.

---------------- INÍCIO DO SQL ----------------
-- =============================================================================
-- SCRIPT FINAL AUTOAGENDA - TUDO EM UM (V3 DEFINITIVO)
-- RESOLVE: 42501 (role via SECURITY DEFINER) + Realtime publication + REPLICA
-- NÃO ALTERA ESTRUTURA DE TABELAS (nenhuma coluna nova, nenhuma tabela drop)
-- =============================================================================

-- =============================================================================
-- 0) DROP DE TODAS POLICIES ANTIGAS EM TODAS AS TABELAS
-- =============================================================================

-- company_settings
drop policy if exists "company_settings_select_own" on public.company_settings;
drop policy if exists "company_settings_update_own" on public.company_settings;
drop policy if exists "company_settings_insert_own" on public.company_settings;
drop policy if exists "company_settings_v2_select" on public.company_settings;
drop policy if exists "company_settings_v2_insert" on public.company_settings;
drop policy if exists "company_settings_v2_update" on public.company_settings;
drop policy if exists "company_settings_admin" on public.company_settings;
drop policy if exists "company_settings_all_own" on public.company_settings;

-- companies
drop policy if exists "companies_select_own" on public.companies;
drop policy if exists "companies_update_own" on public.companies;
drop policy if exists "companies_v2_select" on public.companies;
drop policy if exists "companies_v2_update" on public.companies;
drop policy if exists "companies_admin" on public.companies;
drop policy if exists "companies_all_own" on public.companies;

-- appointments
drop policy if exists "apt_select_final" on public.appointments;
drop policy if exists "apt_insert_final" on public.appointments;
drop policy if exists "apt_update_final" on public.appointments;
drop policy if exists "apt_delete_final" on public.appointments;
drop policy if exists "appointments_select_own_company" on public.appointments;
drop policy if exists "appointments_insert_own_company" on public.appointments;
drop policy if exists "appointments_update_own_company" on public.appointments;
drop policy if exists "appointments_sellers_see_own" on public.appointments;
drop policy if exists "appointments_admin_delete" on public.appointments;
drop policy if exists "appointments_select_self_or_company" on public.appointments;
drop policy if exists "appointments_admin_cancel_delete" on public.appointments;
drop policy if exists "appointments_v2_select" on public.appointments;
drop policy if exists "appointments_v2_insert" on public.appointments;
drop policy if exists "appointments_v2_update" on public.appointments;
drop policy if exists "appointments_v2_delete" on public.appointments;
drop policy if exists "appointments_all_read" on public.appointments;
drop policy if exists "appointments_all_write" on public.appointments;

-- profiles
drop policy if exists "profiles_select_self" on public.profiles;
drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_update_self" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "profiles_all_read" on public.profiles;
drop policy if exists "profiles_v2_select" on public.profiles;
drop policy if exists "profiles_v2_update" on public.profiles;
drop policy if exists "profiles_admin" on public.profiles;

-- =============================================================================
-- 1) DROP DAS RPCs ANTIGAS (agora SEM dependências, CASCADE por segurança)
-- =============================================================================
drop function if exists public.get_my_company_id() cascade;
drop function if exists public.get_my_role() cascade;

-- =============================================================================
-- 2) RECRIAÇÃO DAS RPCs - AMBAS SECURITY DEFINER (EXECUTAM COMO OWNER, SEM RLS)
-- =============================================================================

-- 2a) get_my_company_id()
create function public.get_my_company_id()
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

-- 2b) get_my_role() — NOVA FUNÇÃO. FONTE VERDADEIRA = public.profiles.role.
create function public.get_my_role()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  select lower(coalesce(p.role, 'seller'))
    into v_role
    from public.profiles p
   where p.id = auth.uid()
   limit 1;
  return coalesce(v_role, 'seller');
end;
$$;
revoke all on function public.get_my_role() from public;
grant execute on function public.get_my_role() to authenticated;

-- =============================================================================
-- 3) SINCRONIZAR emails / is_active / approval_status EM public.profiles
-- =============================================================================
update public.profiles p
   set email           = au.email,
       is_active       = coalesce(p.is_active, true),
       approval_status = coalesce(p.approval_status, 'approved')
  from auth.users au
 where p.id = au.id
   and (
     p.email is distinct from au.email
     or p.is_active is null
     or p.company_id is null
   );

update public.profiles
   set email = (select email from auth.users where id = profiles.id)
 where email is null or email = '';

-- =============================================================================
-- 4) GARANTE QUE RLS ESTÁ LIGADO EM TODAS TABELAS PRINCIPAIS
-- =============================================================================
alter table public.appointments       enable row level security;
alter table public.profiles           enable row level security;
alter table public.companies          enable row level security;
alter table public.company_settings   enable row level security;

-- =============================================================================
-- 5) POLICIES DE public.appointments (4) — USAM get_my_role() / get_my_company_id()
--    NÃO USA MAIS auth.jwt() -> 'app_metadata' EM NENHUMA LINHA
-- =============================================================================

create policy "apt_select_final"
  on public.appointments
  for select
  using (
    company_id = public.get_my_company_id()
    and (
      public.get_my_role() in ('admin', 'evaluator')
      or created_by = auth.uid()
      or seller_email = (select email from auth.users where id = auth.uid())
    )
  );

create policy "apt_insert_final"
  on public.appointments
  for insert
  with check (
    company_id = public.get_my_company_id()
    and created_by = auth.uid()
    and seller_email is not null
    and seller_email <> ''
  );

create policy "apt_update_final"
  on public.appointments
  for update
  using (company_id = public.get_my_company_id())
  with check (
    company_id = public.get_my_company_id()
    and (
      public.get_my_role() in ('admin', 'evaluator')
      or created_by = auth.uid()
      or seller_email = (select email from auth.users where id = auth.uid())
    )
  );

create policy "apt_delete_final"
  on public.appointments
  for delete
  using (
    company_id = public.get_my_company_id()
    and public.get_my_role() = 'admin'
  );

-- =============================================================================
-- 6) POLICIES public.profiles (2): SÓ O PRÓPRIO USUÁRIO LÊ/EDITA O SEU PERFIL
-- =============================================================================
create policy "profiles_select_self"
  on public.profiles
  for select
  using (id = auth.uid());

create policy "profiles_update_self"
  on public.profiles
  for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- =============================================================================
-- 7) POLICIES public.companies (2)
-- =============================================================================
create policy "companies_select_own"
  on public.companies
  for select
  using (id = public.get_my_company_id());

create policy "companies_update_own"
  on public.companies
  for update
  using (id = public.get_my_company_id())
  with check (id = public.get_my_company_id());

-- =============================================================================
-- 8) POLICIES public.company_settings (3)
-- =============================================================================
create policy "company_settings_select_own"
  on public.company_settings
  for select
  using (company_id = public.get_my_company_id());

create policy "company_settings_insert_own"
  on public.company_settings
  for insert
  with check (company_id = public.get_my_company_id());

create policy "company_settings_update_own"
  on public.company_settings
  for update
  using (company_id = public.get_my_company_id())
  with check (company_id = public.get_my_company_id());

-- =============================================================================
-- 9) REALTIME PUBLICATION + REPLICA IDENTITY FULL
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'appointments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.appointments;
  END IF;
END
$$;

ALTER TABLE IF EXISTS public.appointments REPLICA IDENTITY FULL;
---------------- FIM DO SQL ----------------

================================================================================
## 4. VALIDAÇÃO POST-EXECUÇÃO (VOCÊ DEVE RODAR E ME MOSTRAR RESULTADO DE CADA)
================================================================================
Depois que o script acima RODAR COM SUCESSO (sem erros), execute estas 3 queries
SEPARADAMENTE e me informe O RESULTADO DE CADA UMA (copy-paste o output):

--- Query 1 — appointments na publication Realtime
select pubname, schemaname, tablename 
from pg_publication_tables 
where pubname = 'supabase_realtime';
Resultado esperado: UMA LINHA = pubname=supabase_realtime, tablename=appointments

--- Query 2 — REPLICA IDENTITY FULL
select 
  c.relname,
  c.relreplident,
  CASE c.relreplident
    WHEN 'd' THEN 'FULL (default - OK)'
    WHEN 'f' THEN 'FULL (explicito - OK)'
    WHEN 'n' THEN 'NOTHING - RUIM'
    WHEN 'i' THEN 'INDEX - RUIM'
    ELSE 'DESCONHECIDO'
  END as replica_identity_status
from pg_class c 
join pg_namespace n on n.oid = c.relnamespace 
where n.nspname='public' and c.relname='appointments';
Resultado esperado: replica_identity_status = 'FULL (default - OK)' OU 'FULL (explicito - OK)'

--- Query 3 — Testa as RPCs (rode logado COMO UM USUÁRIO QUALQUER authenticated)
select 
  public.get_my_company_id() as minha_company_id, 
  public.get_my_role()       as meu_role;
Resultado esperado: 
  - minha_company_id = UUID NÃO NULO (ex: 123e4567-e89b-...)
  - meu_role = 'admin' OU 'evaluator' OU 'seller' (NÃO PODE SER NULO)

================================================================================
## 5. CHECKLIST FINAL PARA O USUÁRIO (EU) VALIDAR NO NAVEGADOR
================================================================================
Depois de tudo confirmado, me dê estes passos para eu seguir:

Passo 1: No Chrome, abrir 2 janelas — a normal + uma anônima (Ctrl+Shift+N).
Passo 2: Na janela normal → login com Admin (ex: admin@gwm.com).
        Na janela anônima → login com Vendedor (ex: william.msilva@...).
Passo 3: No Admin, criar um agendamento NOVO para o vendedor William em qualquer 
         slot.
PASSO CRÍTICO DE VALIDAÇÃO 4: O agendamento tem que APARECER AUTOMATICAMENTE 
         na janela do vendedor (anônima) em MENOS DE 5 SEGUNDOS, SEM eu precisar 
         dar F5 ou atualizar a página. A badge "⚡ Ao vivo • 1 evento" na página 
         do vendedor deve incrementar de 0 → 1.
Passo 5: No Vendedor, criar um agendamento em um horário vazio → admin vê 
         instantaneamente também.
Passo 6: Validação conflito 23505: Duas janelas clicam NO MESMO slot. O segundo 
         a confirmar vê o erro "⏱️ Horário acabou de ser reservado" E a agenda 
         recarrega sozinha, mostrando o slot ocupado.

SE QUALQUER UM DESTES PASSOS FALHAR, você (Claude) deve:
  - Investigar a falha.
  - NÃO inventar soluções que quebrem as restrições do item 2.
  - Me explicar exatamente qual o erro e corrigir no mesmo estilo do script V3.

================================================================================
FIM DO SCRIPT. Por favor, execute as etapas NA ORDEM e me informe tudo.
================================================================================
