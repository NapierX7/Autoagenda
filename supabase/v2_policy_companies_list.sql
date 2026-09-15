-- =====================================================
-- PERMITE QUE A TELA DE CADASTRO DE VENDEDOR
-- VEJA A LISTA DE LOJAS ANTES MESMO DE ESTAR LOGADO.
-- (OBRIGATORIO para o dropdown "Selecione sua loja" funcionar)
-- =====================================================

drop policy if exists "companies_select_public_list" on public.companies;

create policy "companies_select_public_list"
  on public.companies
  for select
  using (true);

grant select on public.companies to anon;
grant select on public.companies to authenticated;

-- FIM. Agora o deploy pode subir!
