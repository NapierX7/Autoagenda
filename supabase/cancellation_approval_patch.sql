alter table public.appointments
  add column if not exists cancellation_requested_at timestamptz,
  add column if not exists cancellation_requested_by uuid references public.profiles (id) on delete set null,
  add column if not exists cancellation_request_reason text,
  add column if not exists cancellation_admin_approved_at timestamptz,
  add column if not exists cancellation_admin_approved_by uuid references public.profiles (id) on delete set null,
  add column if not exists cancellation_evaluator_approved_at timestamptz,
  add column if not exists cancellation_evaluator_approved_by uuid references public.profiles (id) on delete set null;

comment on column public.appointments.cancellation_requested_at is
  'Quando o vendedor solicita o cancelamento e inicia o fluxo de aprovacao.';
