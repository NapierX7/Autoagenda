# Deploy no Netlify

## Objetivo

Publicar o `AutoAgenda` no Netlify com:

- build do Vite
- suporte a rotas do React Router
- variaveis do Supabase
- checklist de teste final

## 1. Subir o projeto para um repositorio

O caminho mais simples para publicar no Netlify e:

1. criar um repositorio no GitHub
2. subir a pasta `AutoAgenda`
3. conectar esse repositorio no Netlify

## 2. Configuracao de build

O projeto ja esta preparado com:

- [netlify.toml](file:///c:/Users/napie/Downloads/Projeto%20Ebook/AutoAgenda/netlify.toml)
- [public/_redirects](file:///c:/Users/napie/Downloads/Projeto%20Ebook/AutoAgenda/public/_redirects)

Esses arquivos resolvem:

- build automatico do Vite
- publicacao da pasta `dist`
- redirecionamento de SPA para o React Router

## 3. Variaveis de ambiente no Netlify

No painel do Netlify, adicione estas variaveis em:

- `Site configuration`
- `Environment variables`

Valores:

```env
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_ANON_KEY=sua_chave_publica_do_supabase
```

Referencia local:

- [.env.example](file:///c:/Users/napie/Downloads/Projeto%20Ebook/AutoAgenda/.env.example)

## 4. Ajuste importante no Supabase Auth

No Supabase, configure:

1. `Authentication`
2. `URL Configuration`

Preencha:

- `Site URL`: URL publica do Netlify
- `Redirect URLs`: URL publica do Netlify

Exemplo:

```text
https://autoagenda.netlify.app
```

Se depois usar dominio proprio, adicione tambem:

```text
https://app.seudominio.com.br
```

## 5. Aplicar os patches novos do banco

Como o schema inicial ja foi rodado antes, agora aplique no Supabase:

- [company_settings_patch.sql](file:///c:/Users/napie/Downloads/Projeto%20Ebook/AutoAgenda/supabase/company_settings_patch.sql)
- [roles_patch.sql](file:///c:/Users/napie/Downloads/Projeto%20Ebook/AutoAgenda/supabase/roles_patch.sql)
- [cancellation_approval_patch.sql](file:///c:/Users/napie/Downloads/Projeto%20Ebook/AutoAgenda/supabase/cancellation_approval_patch.sql)

Esses patches resolvem:

- criacao da tabela `company_settings`
- base para agenda personalizavel por empresa no futuro
- suporte ao papel `evaluator` para login de avaliadores
- fluxo de solicitacao e aprovacao dupla para cancelamentos feitos por vendedor

## 6. Inserir uma configuracao inicial da empresa

Depois do patch, voce pode registrar a configuracao inicial assim:

```sql
insert into public.company_settings (
  company_id,
  display_name,
  timezone,
  contact_phone,
  schedule_config
)
values (
  (select id from public.companies where slug = 'auto-prime-veiculos'),
  'Auto Prime Veiculos',
  'America/Sao_Paulo',
  '(61) 99999-0000',
  jsonb_build_object(
    'businessDays', jsonb_build_array('Segunda', 'Terca', 'Quarta', 'Quinta', 'Sexta'),
    'timeSlots', jsonb_build_array('09:00', '10:00', '11:00', '12:00', '14:00', '15:00', '16:00')
  )
)
on conflict (company_id) do update
set
  display_name = excluded.display_name,
  timezone = excluded.timezone,
  contact_phone = excluded.contact_phone,
  schedule_config = excluded.schedule_config;
```

## 7. Checklist de publicacao

Antes de considerar o deploy pronto, valide:

- login funcionando com usuario real do Supabase
- dashboard carregando
- agenda semanal aparecendo
- criacao de agendamento funcionando
- conflito de horario retornando mensagem amigavel
- cancelamento liberando o slot
- finalizacao movendo o status
- historico mostrando cancelados
- filtros da agenda funcionando
- filtros do historico funcionando
- refresh da pagina sem erro em rotas como `/agenda` e `/historico`

## 8. Se quiser publicar sem GitHub

Tambem da para:

1. rodar `npm run build`
2. gerar a pasta `dist`
3. arrastar a pasta no Netlify

Mas o fluxo com repositorio e melhor para:

- atualizacao continua
- rollback
- historico de versoes
- deploy automatico

## 9. Melhor caminho daqui para frente

Depois do primeiro deploy, a proxima prioridade recomendada e:

- testar fluxo real com 1 empresa
- validar uso com equipe real
- medir se a visao da agenda reduziu conflitos
- so depois abrir evolucoes como varios usuarios por empresa
