@echo off
chcp 65001 >nul
REM ================================================================
REM DEPLOY DAS EDGE FUNCTIONS - AutoAgenda (adyzxvkrrdrpkqxjtrxj)
REM
REM MODO MAIS SEGURO: JÁ CONFIGURADO NO config.toml (pasta supabase/)
REM   - user-admin-actions: verify_jwt = false (padrao, sempre)
REM   - create-seller:      verify_jwt = false (padrao, sempre)
REM
REM O comando abaixo tambem inclui --no-verify-jwt EXPLICITAMENTE
REM como CAMADA DUPLA DE SEGURANCA (nunca mais resetara para true).
REM
REM Execute este arquivo com: clique duplo OU PowerShell:
REM   cd "c:\Users\napie\Downloads\Projeto Ebook\AutoAgenda"
REM   .\supabase\DEPLOY_EDGE_FUNCTIONS.cmd
REM ================================================================

cd /d "%~dp0\.."

echo.
echo [1/4] Instalando Supabase CLI via npm...
call "C:\Program Files\nodejs\npm.cmd" install --no-save supabase@latest 2>nul

echo.
echo [2/4] Autenticando Supabase (vai abrir navegador se precisar)...
REM Se voce tem SUPABASE_ACCESS_TOKEN em variavel de ambiente, ele usa automaticamente.
REM Senao, faca: supabase login
call "C:\Program Files\nodejs\npx.cmd" --yes supabase@latest --version

echo.
echo [3/4] Deploy da function create-seller (criar vendedor/avaliador)...
call "C:\Program Files\nodejs\npx.cmd" --yes supabase@latest functions deploy create-seller --project-ref adyzxvkrrdrpkqxjtrxj --no-verify-jwt

echo.
echo [4/4] Deploy da function user-admin-actions (todas as acoes administrativas)...
call "C:\Program Files\nodejs\npx.cmd" --yes supabase@latest functions deploy user-admin-actions --project-ref adyzxvkrrdrpkqxjtrxj --no-verify-jwt

echo.
echo ================================================================
echo DEPLOY CONCLUIDO!
echo ================================================================
echo.
echo Validacao rapida (OPCIONAL):
echo   1) Abra o Supabase Dashboard - Edge Functions.
echo   2) Abra cada function e no botao "More" confira:
echo      - Verify JWT = DISABLED (desativado) para as duas.
echo   3) Logou e nao apareceu erro? Entao deu tudo certo.
echo.
echo Depois disso, teste:
echo   - Tela de login - cadastrar vendedor.
echo   - Menu Usuarios - criar vendedor/avaliador.
echo   - Cancelamento de agendamentos.
echo.
pause

