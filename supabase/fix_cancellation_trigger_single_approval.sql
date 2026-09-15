-- ================================================================
-- PATCH CORRETIVO: CANCELAMENTO EXIGINDO APENAS UMA APROVAÇÃO
-- ================================================================
-- Problema: o trigger de validação de cancelamento exigia
-- AMBAS as aprovações (admin E evaluator), bloqueando o
-- cancelamento mesmo quando um dos dois já havia aprovado.
--
-- Correção: BASTA UMA das duas aprovações (admin OU evaluator)
-- para permitir o status = 'cancelled'.
--
-- Também cria os campos cancelled_at, cancelled_by e
-- cancellation_reason se eles ainda não existirem na tabela.
-- ================================================================

-- 1) Garante colunas de cancelamento obrigatórias existem
alter table public.appointments
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.profiles (id) on delete set null,
  add column if not exists cancellation_reason text;

-- 2) Remove qualquer trigger antigo que possa estar bloqueando
drop trigger if exists appointments_validate_cancellation on public.appointments;
drop trigger if exists appointments_check_cancellation_approval on public.appointments;
drop trigger if exists appointments_require_approval_to_cancel on public.appointments;
drop function if exists public.validate_appointment_cancellation();
drop function if exists public.check_cancellation_approval();
drop function if exists public.appointments_require_approval_to_cancel_fn();

-- 3) Função corrigida: exige APENAS UMA das aprovações
create or replace function public.validate_appointment_cancellation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role text;
  v_actor_id uuid;
  v_is_admin boolean;
  v_is_evaluator boolean;
  v_is_seller boolean;
begin
  -- Só validar se a alteração está realmente mudando o status para cancelled
  if old.status = 'cancelled' or (new.status is not distinct from old.status) then
    return new;
  end if;

  if new.status <> 'cancelled' then
    return new;
  end if;

  -- Identifica o usuário que está executando a operação
  v_actor_id := auth.uid();

  -- Busca o papel do usuário (se existir profile)
  select p.role
    into v_actor_role
    from public.profiles p
   where p.id = v_actor_id
   limit 1;

  v_is_admin     := coalesce(v_actor_role = 'admin', false);
  v_is_evaluator := coalesce(v_actor_role = 'evaluator', false);
  v_is_seller    := coalesce(v_actor_role = 'seller', false);

  -- ==================================================================
  -- REGRA 1: ADMIN ou EVALUATOR cancelando DIRETAMENTE (sem solicitação)
  --         NÃO PRECISA de nenhuma aprovação adicional. O próprio ato
  --         do usuário privilegiado clicando em "Cancelar horário" já é
  --         a sua aprovação. O frontend preenche os campos de aprovação
  --         mas, como segurança extra, garantimos aqui que é permitido.
  -- ==================================================================
  if v_is_admin or v_is_evaluator then
    -- Preenche os campos de auditoria se o frontend não tiver feito
    new.cancelled_at    := coalesce(new.cancelled_at, timezone('utc', now()));
    new.cancelled_by    := coalesce(new.cancelled_by, v_actor_id);
    new.cancellation_reason := coalesce(
      nullif(new.cancellation_reason, ''),
      case
        when v_is_admin     then 'Cancelamento direto efetuado por gerente.'
        when v_is_evaluator then 'Cancelamento direto efetuado por avaliador.'
        else 'Cancelamento aprovado.'
      end
    );

    -- Preenche as aprovações correspondentes
    if v_is_admin then
      new.cancellation_admin_approved_at := coalesce(new.cancellation_admin_approved_at, timezone('utc', now()));
      new.cancellation_admin_approved_by := coalesce(new.cancellation_admin_approved_by, v_actor_id);
      if new.cancellation_evaluator_approved_at is null then
        new.cancellation_evaluator_approved_at := timezone('utc', now());
        new.cancellation_evaluator_approved_by := v_actor_id;
      end if;
    end if;

    if v_is_evaluator then
      new.cancellation_evaluator_approved_at := coalesce(new.cancellation_evaluator_approved_at, timezone('utc', now()));
      new.cancellation_evaluator_approved_by := coalesce(new.cancellation_evaluator_approved_by, v_actor_id);
      if new.cancellation_admin_approved_at is null then
        new.cancellation_admin_approved_at := timezone('utc', now());
        new.cancellation_admin_approved_by := v_actor_id;
      end if;
    end if;

    return new;
  end if;

  -- ==================================================================
  -- REGRA 2: SELLER (vendedor) ou usuário sem perfil
  --         EXIGE PELO MENOS UMA aprovação (admin OU evaluator).
  --         Não precisa das DUAS como era antes!
  -- ==================================================================
  if new.cancellation_admin_approved_at is not null
     or new.cancellation_evaluator_approved_at is not null then
    -- OK: pelo menos uma aprovação existe → cancela
    new.cancelled_at    := coalesce(new.cancelled_at, timezone('utc', now()));
    new.cancelled_by    := coalesce(new.cancelled_by, v_actor_id);
    new.cancellation_reason := coalesce(
      nullif(new.cancellation_reason, ''),
      coalesce(old.cancellation_request_reason, 'Cancelamento aprovado.')
    );
    return new;
  end if;

  -- ==================================================================
  -- Nenhuma aprovação encontrada e o usuário não é privilegiado → BLOQUEIA
  -- ==================================================================
  raise exception 'Cancelamento requer aprovacao de admin OU evaluator (basta um dos dois). O vendedor precisa solicitar o cancelamento primeiro para que o gerente ou avaliador aprove.'
    using hint = 'O vendedor deve clicar em "Solicitar cancelamento" e aguardar a aprovacao de um gerente OU avaliador.';
end;
$$;

-- 4) Instala o trigger de validação
create trigger appointments_validate_cancellation
before update of status on public.appointments
for each row
execute function public.validate_appointment_cancellation();

-- 5) Trigger auxiliar: preenche automaticamente cancelled_at/cancelled_by
--    quando status for alterado para cancelled e o usuário for privilegiado
create or replace function public.fill_cancellation_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    if new.cancelled_at is null then
      new.cancelled_at := timezone('utc', now());
    end if;
    if new.cancelled_by is null then
      new.cancelled_by := auth.uid();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists appointments_fill_cancellation_audit on public.appointments;
create trigger appointments_fill_cancellation_audit
before update of status on public.appointments
for each row
execute function public.fill_cancellation_audit();

comment on column public.appointments.cancelled_at is 'Momento em que o agendamento foi efetivamente cancelado (apos aprovacao).';
comment on column public.appointments.cancelled_by is 'Perfil que efetivou o cancelamento (apos aprovacao).';
comment on column public.appointments.cancellation_reason is 'Motivo final registrado no momento do cancelamento.';

-- ================================================================
-- SCRIPT TERMINOU. Para aplicar:
--   1) Abra o dashboard Supabase → Project: adyzxvkrrdrpkqxjtrxj
--   2) Vá em SQL Editor (lado esquerdo)
--   3) Abra uma nova query → cole TODO o conteúdo deste arquivo
--   4) Clique em "Run" (ou Ctrl+Enter)
-- Resultado esperado: retorna "Success. No rows returned."
-- ================================================================
