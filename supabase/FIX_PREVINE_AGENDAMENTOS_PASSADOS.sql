-- ================================================================
-- BLOQUEIO DE AGENDAMENTOS EM HORARIOS QUE JA PASSARAM
-- Rodar no SQL Editor do Supabase (adyzxvkrrdrpkqxjtrxj)
--
-- Executa ANTES de INSERT ou UPDATE na tabela appointments e
-- NAO PERMITE gravar agendamentos no passado.
-- Apenas permite finalizar/cancelar agendamentos que JA EXISTIAM
-- com data/hora no passado (ex: finalizar um laudo do dia anterior
-- que voce esqueceu de marcar como feito).
-- ================================================================

create or replace function public.appointments_prevent_past_times()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate timestamptz;
begin
  -- Para UPDATE, nao consideramos alteracoes de data/hora PASSADAS
  -- (Apenas valida se a pessoa esta MUDANDO a data/hora para um valor passado)
  -- Para INSERT SEMPRE valida.
  -- Permitimos UPDATEs de campos de workflow (status, laudo, etc.) sem
  -- mudar data/hora, mesmo que o horario ja tenha passado.
  if tg_op = 'UPDATE' then
    -- Se a data OU hora NAO ESTAO sendo ALTERADAS, nao valida (permite workflow como finalizar laudo etc.)
    if new.appointment_date is not distinct from old.appointment_date
       and new.appointment_time is not distinct from old.appointment_time then
      return new;
    end if;
  end if;

  if new.appointment_date is null or new.appointment_time is null then
    return new;
  end if;

  -- Horario candidato (data + hora) em UTC local
  begin
    candidate := (new.appointment_date::text || ' ' || lpad(split_part(new.appointment_time::text, ':', 1), 2, '0') || ':' || lpad(split_part(new.appointment_time::text, ':', 2), 2, '0') || ':00')::timestamptz at time zone 'UTC';
  exception when others then
    candidate := null;
  end;

  if candidate is null then
    return new;
  end if;

  if candidate < (timezone('UTC', now())) then
    raise exception 'Nao e permitido agendar ou reagendar para um horario que ja passou. Horario informado: % as %.', new.appointment_date, new.appointment_time using errcode = '23000';
  end if;

  return new;
end;
$$;

drop trigger if exists appointments_prevent_past_times on public.appointments;
create trigger appointments_prevent_past_times
before insert or update of appointment_date, appointment_time on public.appointments
for each row
execute function public.appointments_prevent_past_times();
