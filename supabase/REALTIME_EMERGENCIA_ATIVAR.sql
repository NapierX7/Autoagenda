-- ============================================================
-- SCRIPT DE EMERGÊNCIA REALTIME AUTOAGENDA (V2 - CORRIGIDO)
-- COLE ISSO NO SQL EDITOR DO SUPABASE E CLIQUE EM "RUN"
--
-- CORREÇÃO: Postgres NÃO suporta "ADD TABLE IF NOT EXISTS"
-- em ALTER PUBLICATION. Usamos DO $$ com checagem manual.
-- ============================================================

-- PASSO 1: Garante que a publication supabase_realtime existe
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END
$$;

-- PASSO 2: Adiciona a tabela appointments NA publication (SE JÁ NÃO ESTIVER)
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

-- PASSO 3: Seta REPLICA IDENTITY FULL
-- Sem isto: UPDATE/DELETE enviam apenas PK, não o payload completo
ALTER TABLE IF EXISTS public.appointments REPLICA IDENTITY FULL;

-- ============================================================
-- (OPCIONAL) VERIFICAÇÃO — pode rodar separadamente depois:
-- ============================================================

-- Verifica publication + tabela cadastrada (deve aparecer appointments):
-- SELECT pubname, schemaname, tablename
-- FROM pg_publication_tables
-- WHERE pubname = 'supabase_realtime';

-- Verifica REPLICA IDENTITY (deve retornar relreplident = 'd' = FULL):
-- SELECT
--   c.relname,
--   CASE c.relreplident
--     WHEN 'd' THEN 'FULL (default)'
--     WHEN 'n' THEN 'NOTHING'
--     WHEN 'f' THEN 'FULL (explícito)'
--     WHEN 'i' THEN 'INDEX'
--     ELSE 'DESCONHECIDO'
--   END as replica_identity
-- FROM pg_class c
-- JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relname = 'appointments';
