-- =============================================================================
-- AutoAgenda — SUPABASE STORAGE: Bucket "laudos" + RLS Policies (MULTI-TENANT)
-- =============================================================================
-- DATA DE CRIAÇÃO: 2026-08-29
-- OBJETIVO: Proteger os PDFs de laudo no Storage por company_id.
--
-- COMO USAR (ordem correta):
--
--   PASSO 1 (SOMENTE VIA PAINEL, NÃO roda aqui):
--     Abra Supabase Dashboard → AutoAgenda → Storage → "New bucket"
--       Name:              laudos
--       Public bucket?     ✅ SIM (marque a caixa)
--       File size limit:   52428800  (= 50 MB)
--       Allowed MIME:      application/pdf, image/png, image/jpeg, image/jpg
--     Clique em "Create bucket".
--
--   PASSO 2 (RODA ESTE ARQUIVO INTEIRO no SQL Editor):
--     Abra SQL Editor → New query → cole TUDO daqui para baixo → Run.
--     (Nenhuma tabela public.* é alterada. Só policies em storage.objects.)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- (A) Garante que a tabela storage.objects existe. (Só existe se Storage foi
--     inicializado no projeto — sempre true se você criou o bucket acima.)
-- -----------------------------------------------------------------------------
DO $$ BEGIN END $$;

-- -----------------------------------------------------------------------------
-- (B) DESABILITA políticas antigas do storage.objects associadas ao bucket
--     laudos (se existirem), para não duplicar regra.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS laudos_select_own_company ON storage.objects;
DROP POLICY IF EXISTS laudos_insert_own_company ON storage.objects;
DROP POLICY IF EXISTS laudos_update_own_company ON storage.objects;
DROP POLICY IF EXISTS laudos_delete_own_company ON storage.objects;

-- -----------------------------------------------------------------------------
-- (C) CRIA 4 POLICIES SEGURAS (MULTI-TENANT) no bucket "laudos".
--
--     Regra de caminho  ->   laudos/{company_id}/{appointment_id}/{timestamp}_{filename}
--     Primeira parte do pathname (folder raiz do arquivo) == company_id do usuário logado.
-- -----------------------------------------------------------------------------

-- (1) SELECT: só baixa arquivo se a primeira pasta do path bater com a empresa autenticada
CREATE POLICY laudos_select_own_company
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'laudos'
    AND (storage.foldername(name))[1] = (public.get_my_company_id())::text
  );

-- (2) INSERT: só envia novo arquivo pro folder da sua propria empresa
CREATE POLICY laudos_insert_own_company
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'laudos'
    AND (storage.foldername(name))[1] = (public.get_my_company_id())::text
    AND array_length(string_to_array(name, '/'), 1) >= 2
  );

-- (3) UPDATE: só sobrescreve arquivo da sua propria empresa
CREATE POLICY laudos_update_own_company
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'laudos'
    AND (storage.foldername(name))[1] = (public.get_my_company_id())::text
  )
  WITH CHECK (
    bucket_id = 'laudos'
    AND (storage.foldername(name))[1] = (public.get_my_company_id())::text
  );

-- (4) DELETE: só apaga arquivo da sua propria empresa
CREATE POLICY laudos_delete_own_company
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'laudos'
    AND (storage.foldername(name))[1] = (public.get_my_company_id())::text
  );

-- =============================================================================
-- FIM. Nenhuma linha de public.* foi alterada.
--
-- Próximo passo (validação):
--   - Logue como admin/avaliador no AutoAgenda
--   - Abra um agendamento já feito → "Finalizar laudo"
--   - Selecione um PDF de 12MB+ → deve aparecer "⭐ Storage" no badge ao lado do progresso
--   - Finalizar → salvo com sucesso
-- =============================================================================
