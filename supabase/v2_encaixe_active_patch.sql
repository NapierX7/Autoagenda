-- =====================================================
-- PATCH V2.2: DESATIVAR LOGIN (is_active) + ENCAIXE
-- =====================================================

-- 1. is_active: desativa login de funcionario desligado / suspenso
do $$ begin
  alter table public.profiles
    add column if not exists is_active boolean not null default true;
exception when duplicate_column then null; end $$;

comment on column public.profiles.is_active is 'true = login liberado, false = usuario suspenso ou desligado (nao pode logar, mas permanece no historico)';

-- 2. is_encaixe: agendamento criado como encaixe por gerente em slot ocupado
do $$ begin
  alter table public.appointments
    add column if not exists is_encaixe boolean not null default false;
exception when duplicate_column then null; end $$;

do $$ begin
  alter table public.appointments
    add column if not exists encaixe_created_at timestamptz;
exception when duplicate_column then null; end $$;

do $$ begin
  alter table public.appointments
    add column if not exists encaixe_created_by uuid references public.profiles(id) on delete set null;
exception when duplicate_column then null; end $$;

comment on column public.appointments.is_encaixe is 'true = encaixe de ultima hora criado por gerente, mesmo que o slot ja esteja ocupado';
comment on column public.appointments.encaixe_created_at is 'Data/hora em que o encaixe foi inserido';
comment on column public.appointments.encaixe_created_by is 'ID do gerente que inseriu o encaixe';

-- 3. Garantir valores antigos (todos ativos / nao encaixe)
update public.profiles set is_active = true where is_active is null;
update public.appointments set is_encaixe = false where is_encaixe is null;

-- 4. Recriar UNIQUE INDEX da agenda para PERMITIR encaixes no mesmo horario
--    (o indice original bloqueia 2 agendamentos scheduled/completed no mesmo day/time,
--     mas queremos que ENCAIXE (is_encaixe=true) ultrapasse essa regra.)
drop index if exists public.appointments_active_slot_unique;

create unique index appointments_active_slot_unique
  on public.appointments (company_id, appointment_date, appointment_time)
  where status in ('scheduled', 'completed') and is_encaixe = false;

 5. Atualizar a funcao RPC get_profiles_of_my_company (se existir) para incluir is_active
    (O Supabase nao permite CREATE OR REPLACE via DO anonymous por padrao,
    entao se voce precisar recriar a funcao, execute o trecho abaixo manualmente no SQL Editor:)


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

revoke all on function public.get_profiles_of_my_company() from public;
grant execute on function public.get_profiles_of_my_company() to authenticated;
