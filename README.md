# Validador automático de bilhetes

Sistema Node.js/TypeScript para receber mensagens de WhatsApp, extrair código de bilhete, consultar `https://www.esportese.bet/bilhete3.aspx`, confirmar pré-bilhete quando encontrado e responder o cliente com texto e comprovante.

Arquitetura alvo: Vercel Functions + Neon PostgreSQL + WhatsApp API configurável ou Telegram Bot API.

## Instalação

```bash
npm install
npm run playwright:install
copy .env.example .env
```

Crie um banco Neon pelo Vercel Marketplace e preencha `DATABASE_URL`. Depois rode:

```bash
npm run db:migrate
```

Edite `.env` com o provedor de WhatsApp:

- `WHATSAPP_PROVIDER=none`: apenas registra no console/log.
- `WHATSAPP_PROVIDER=evolution`: usa Evolution API.
- `WHATSAPP_PROVIDER=zapi`: usa Z-API.
- `WHATSAPP_PROVIDER=meta`: usa Meta Cloud API.

Para o Rodrigo receber notificacoes administrativas pelo WhatsApp, configure o envio Meta e cadastre o numero dele com DDI/DDD:

```env
WHATSAPP_PROVIDER=meta
WHATSAPP_API_TOKEN=
META_PHONE_NUMBER_ID=
ADMIN_WHATSAPP_NUMBERS=55DDDNUMERO
```

Tambem da para ativar pelo proprio WhatsApp: envie `/admin sua-senha-do-painel` para o bot depois que o webhook estiver funcionando.
Na Meta Cloud API, alertas proativos fora da janela de atendimento do WhatsApp podem exigir template aprovado pela Meta.

Para Telegram, crie um bot no `@BotFather` e configure:

```env
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
PUBLIC_BASE_URL=https://seu-projeto.vercel.app
```

Depois registre o webhook:

```bash
npm run telegram:set-webhook
```

## Rodar

```bash
npm run dev
```

Webhook:

```text
POST http://localhost:3000/webhook/whatsapp
POST http://localhost:3000/webhook/telegram
```

Health check:

```text
GET http://localhost:3000/health
```

Teste manual:

```bash
curl -X POST http://localhost:3000/validate \
  -H "Content-Type: application/json" \
  -d "{\"numero\":\"5511999999999\",\"mensagem\":\"V072 ZHQW NZV9\"}"
```

Teste manual Telegram:

```bash
curl -X POST http://localhost:3000/validate \
  -H "Content-Type: application/json" \
  -d "{\"channel\":\"telegram\",\"chatId\":\"123456789\",\"mensagem\":\"V072 ZHQW NZV9\"}"
```

## Observações de produção

- Em Vercel, prefira `PLAYWRIGHT_WS_ENDPOINT` apontando para um navegador remoto seguro. Isso evita depender de Chromium local dentro da Function.
- Em ambiente local, `PLAYWRIGHT_USER_DATA_DIR=.playwright-profile` preserva cookies/sessão do navegador.
- Se o site exigir login, faça o login uma vez em ambiente seguro e use `STORAGE_STATE_PATH` ou um perfil persistente.
- Use `WEBHOOK_SECRET` e envie o header `x-webhook-secret` no provedor para rejeitar chamadas não autorizadas.
- Opcionalmente restrinja `WEBHOOK_ALLOWED_IPS` com IPs separados por vírgula.
- Nunca coloque tokens em variáveis `NEXT_PUBLIC_`; todos os segredos ficam em variáveis server-side na Vercel.
- O histórico de validações fica em `validation_jobs` no Neon. Prints são enviados ao WhatsApp e somente hash/tamanho ficam salvos no banco.
- Para Telegram, use `TELEGRAM_WEBHOOK_SECRET`; o Telegram envia esse valor no header `X-Telegram-Bot-Api-Secret-Token`.

## Deploy na Vercel

1. Crie o projeto na Vercel.
2. Instale Neon pelo Marketplace da Vercel para provisionar `DATABASE_URL`.
3. Configure as variáveis de WhatsApp ou Telegram, `WEBHOOK_SECRET`/`TELEGRAM_WEBHOOK_SECRET`, `ADMIN_WHATSAPP_NUMBERS`, `TARGET_URL` e, em produção, `PLAYWRIGHT_WS_ENDPOINT`.
4. Rode `vercel env pull .env.local --yes` para testar localmente com as mesmas variáveis.
5. Rode `npm run db:migrate`.
6. Publique com `vercel deploy --prod`.

## Duplicar para outro cliente

Para criar uma instalacao nova sem copiar credenciais, banco, sessao local, projeto Vercel ou dados operacionais do cliente atual, use:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/create-client-copy.ps1 -ClientName rodrigo
```

Depois configure um Neon, projeto Vercel, dominio/site alvo, token Meta API e credenciais `TARGET_*` novos. O passo a passo completo fica em [`docs/duplicar-cliente.md`](docs/duplicar-cliente.md).

## Login no site de apostas

Para confirmar pre-bilhetes, o site exige sessao autenticada. Capture a sessao em ambiente local:

```bash
npm run site:capture-session
```

Uma janela do navegador vai abrir. Faca login no site; o script salva `TARGET_AUTH_TOKEN`, `TARGET_USER_ID`, `TARGET_RTOKEN`, `TARGET_DTOKEN` e `TARGET_IP` em `.env.local`. O `TARGET_DTOKEN` pode ficar vazio, porque o proprio site trata esse campo como opcional. Depois replique as variaveis na Vercel.

## Painel administrativo

Configure `ADMIN_USERNAME` e `ADMIN_PASSWORD` nas variaveis de ambiente da Vercel. Depois acesse a home do sistema:

```text
https://SEU_DOMINIO/
```

Depois do login, o sistema redireciona para `/api/admin`. O painel mostra resumo por cliente, contato, quantidade de bilhetes, valor apostado, premio possivel, status, mensagem enviada e os jogos detalhados de cada bilhete. A tela consulta o backend automaticamente e recarrega quando algum bilhete novo entra ou muda de status. Para exportar os mesmos dados em JSON, use `/api/admin?format=json`.
