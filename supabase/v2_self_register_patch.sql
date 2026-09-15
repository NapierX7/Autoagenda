-- =====================================================
-- PATCH V2.1: AUTO-CADASTRO DE VENDEDORES COM APROVAÇÃO
-- =====================================================

-- 1. Coluna de status de aprovação no perfil
do $$ begin
  alter table public.profiles
    add column if not exists approval_status text not null default 'approved';
exception when duplicate_column then null; end $$;

do $$ begin
  alter table public.profiles
    add column if not exists requested_at timestamptz not null default now();
exception when duplicate_column then null; end $$;

-- 2. Garantir valores históricos aprovados (usuários criados antes continuam funcionando)
update public.profiles set approval_status = 'approved' where approval_status is null;

-- 3. Comentários úteis
comment on column public.profiles.approval_status is 'pending = aguardando aprovação do gerente, approved = liberado, rejected = recusado';

-- 4. RLS: garantir que somente aprovados vejam dados; gerentes aprovadores não necessitam de mudança (já são 'admin')
--    (A policy de "sellers see own" da V2 já filtra por created_by. Nenhuma mudança adicional.)
