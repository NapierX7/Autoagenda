# ================================================================
# DIAGNOSTICO CADASTRO AUTOAGENDA - 19/08/2026
#
# Como usar (FORA DO TRAE, PowerShell normal do Windows):
#   cd "c:\Users\napie\Downloads\Projeto Ebook\AutoAgenda\supabase"
#   powershell -ExecutionPolicy Bypass -File .\DIAGNOSTICO_CADASTRO.ps1
#
# Ele chama a function user-admin-actions DIRETAMENTE via REST API
# (sem passar pelo frontend React) e mostra:
#   - Status code HTTP
#   - Headers importantes
#   - Corpo da resposta COMPLETO (com o erro REAL do backend)
# ================================================================

$ProjectRef   = 'adyzxvkrrdrpkqxjtrxj'
$AnonKey      = 'sb_publishable_JyoLlO6VYYvVhQtDAEL7VA_IH60KqK8'

$FunctionUrl  = "https://${ProjectRef}.supabase.co/functions/v1/user-admin-actions"

Write-Host "===============================================" -ForegroundColor Cyan
Write-Host "DIAGNOSTICO: user-admin-actions (request-seller-access)" -ForegroundColor Cyan
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host "URL: $FunctionUrl"
Write-Host ""

# Payload de teste: tenta cadastrar um e-mail OBVIAMENTE duplicado (geral@geral.com)
# para sabermos se a function está RODANDO MESMO e processando a requisicao.
$Body = @{
  action    = 'request-seller-access'
  email     = 'teste-diagnostico-' + [guid]::NewGuid().ToString('N').Substring(0, 8) + '@autoagenda-teste.com'
  password  = 'Senha123456'
  fullName  = 'Teste Diagnostico'
  companyId = 'af8c268c-504c-48df-8d82-c50d605992ec'   # GWM da lista mock
} | ConvertTo-Json

Write-Host "Payload de teste:"
Write-Host $Body
Write-Host ""

try {
  $Response = Invoke-WebRequest -Uri $FunctionUrl `
    -Method Post `
    -Headers @{
      'apikey'        = $AnonKey
      'Authorization' = "Bearer $AnonKey"
      'Content-Type'  = 'application/json'
      'User-Agent'    = 'AutoAgenda-Diagnostico/1.0'
    } `
    -Body $Body `
    -UseBasicParsing

  Write-Host "==================================================" -ForegroundColor Green
  Write-Host "SUCESSO HTTP (2xx)! A FUNCTION ESTA RODANDO." -ForegroundColor Green
  Write-Host "==================================================" -ForegroundColor Green
  Write-Host "Status Code: $($Response.StatusCode)"
  Write-Host "Content-Type:  $($Response.Headers['Content-Type'])"
  Write-Host ""
  Write-Host "Corpo da resposta:"
  Write-Host $Response.Content
  Write-Host ""
  Write-Host "PERFEITO! A function esta no ar. O problema do 'non-2xx' era:"
  Write-Host "  -> Ou Verify JWT ainda LIGADO (mas aqui passou, entao eh OFF)"
  Write-Host "  -> Ou o frontend antigo estava pegando a URL errada"
  Write-Host "  -> Ou companyId selecionado nao existe (teste com outra loja)"
}
catch {
  Write-Host "==================================================" -ForegroundColor Red
  Write-Host "FALHA HTTP (non-2xx)! AQUI ESTA O ERRO REAL:"      -ForegroundColor Red
  Write-Host "==================================================" -ForegroundColor Red

  if ($_.Exception.Response) {
    $resp = $_.Exception.Response
    Write-Host "Status Code : $([int]$resp.StatusCode) $($resp.StatusDescription)" -ForegroundColor Red

    try {
      $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
      $reader.BaseStream.Position = 0
      $reader.DiscardBufferedData()
      $body = $reader.ReadToEnd()
      Write-Host ""
      Write-Host "Corpo ERRO JSON (mensagem REAL do backend):" -ForegroundColor Yellow
      Write-Host $body -ForegroundColor Yellow
    }
    catch {
      Write-Host "Nao foi possivel ler o corpo do erro." -ForegroundColor Gray
    }
  } else {
    Write-Host "Tipo erro   : $($_.Exception.GetType().FullName)"
    Write-Host "Mensagem    : $($_.Exception.Message)"
    if ($_.Exception.InnerException) {
      Write-Host "Inner Msg   : $($_.Exception.InnerException.Message)"
    }
  }

  Write-Host ""
  Write-Host "---- O QUE FAZER AGORA ----"
  if ($_.Exception.Message -match '401|Unauthorized|403|Forbidden') {
    Write-Host "- Verify JWT esta LIGADO na function. Desative no Supabase." -ForegroundColor Yellow
  }
  if ($_.Exception.Message -match '404|NotFound') {
    Write-Host "- Function user-admin-actions NAO EXISTE. Faca o deploy dela primeiro." -ForegroundColor Yellow
  }
  if ($_.Exception.Message -match '500|InternalServerError') {
    Write-Host "- ERRO DENTRO do codigo TypeScript. Veja os logs em: Supabase Dashboard -> Edge Functions -> user-admin-actions -> Logs" -ForegroundColor Yellow
  }
  if ($_.Exception.Message -match 'SSL|TLS|certificate|name or service not known|DNS') {
    Write-Host "- Sem internet ou DNS. Confira sua conexao." -ForegroundColor Yellow
  }
}

Write-Host ""
Write-Host "Fim do diagnostico."
pause
