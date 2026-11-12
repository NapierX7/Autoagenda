# Proposta — Storage privado + URL assinada (sandbox primeiro)

Status: **proposta apenas**. Nenhuma mudança de bucket/policy aplicada neste passo.

## Achado de homologação (12/11/2026)

- Upload autenticado de PDF fictício: OK.
- Leitura **anônima** do mesmo objeto via URL pública: **HTTP 200**.
- Cliente atual usa `getPublicUrl` (`laudosStorageService.getLaudoPublicUrl`).
- Laudos reais não devem ficar publicamente listáveis/baixáveis sem autenticação.

## Impacto se aplicarmos no sandbox

| Área | Mudança | Risco |
|------|---------|--------|
| Bucket `laudos` | `public = false` | URLs antigas `.../object/public/laudos/...` deixam de funcionar |
| Coluna `appointments.laudo_file_url` | Passa a guardar path ou URL assinada de curta duração | Links expirados na UI/histórico |
| Frontend | Trocar `getPublicUrl` por `createSignedUrl` (TTL, ex. 15–60 min) ao exibir/baixar | Precisa sessão válida; preview anônimo quebra |
| Policies `storage.objects` | SELECT/INSERT só `authenticated` + pasta `company_id` | Avaliar se Edge/service_role precisa de bypass |
| Produção | **Fora de escopo** até GO explícito | Não alterar `adyzxvkrrdrpkqxjtrxj` nesta proposta |

## Plano sugerido (sandbox → validação → só depois produção)

1. Inventariar quantos `laudo_file_url` já são `public` no sandbox.
2. Tornar bucket privado; manter path estável (`companyId/appointmentId/file`).
3. FE: `upload` retorna `storagePath`; UI pede signed URL sob demanda.
4. Testar: upload auth OK; GET anônimo 400/403; GET signed auth OK; limpar objetos de teste.
5. Só então abrir autorização para produção.

## Não fazer agora

- Não mudar policies de `appointments`.
- Não “abrir” Storage para fazer teste passar.
- Não deploy de produção.
