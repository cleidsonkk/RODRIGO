# Duplicar o sistema para outro cliente

Use este fluxo quando for criar uma instalacao nova para outro cliente, sem levar credenciais, banco, sessao do site ou projeto Vercel do cliente anterior.

## O que nao deve ser copiado

Nao copie estes itens para o novo cliente:

- `.env`
- `.env.local`
- `.env.*.local`
- `.vercel/`
- `.playwright-profile/`
- `node_modules/`
- `dist/`
- `data/logs/*.jsonl`
- `data/screenshots/*.png`

Esses arquivos podem conter tokens, sessoes, URLs privadas, banco Neon, link da Vercel e dados operacionais.

## Criar uma copia limpa

Na pasta do projeto atual, rode:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/create-client-copy.ps1 -ClientName rodrigo
```

Por padrao, a copia sera criada ao lado da pasta atual:

```text
..\rodrigo
```

Tambem da para escolher o destino:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/create-client-copy.ps1 -ClientName rodrigo -Destination "C:\Users\xlord\Downloads\Rodrigo"
```

Depois entre na nova pasta:

```powershell
cd ..\rodrigo
npm install
copy .env.example .env.local
```

## Variaveis que voce troca para o Rodrigo

Preencha no `.env.local` local e depois replique na Vercel do Rodrigo:

```env
PUBLIC_BASE_URL=https://novo-projeto-rodrigo.vercel.app
DATABASE_URL=

TARGET_URL=
TARGET_API_BASE_URL=
TARGET_AUTH_TOKEN=
TARGET_USER_ID=
TARGET_RTOKEN=
TARGET_DTOKEN=
TARGET_IP=

WHATSAPP_PROVIDER=meta
WHATSAPP_API_TOKEN=
META_PHONE_NUMBER_ID=
META_API_VERSION=v21.0
ADMIN_WHATSAPP_NUMBERS=

ADMIN_USERNAME=
ADMIN_PASSWORD=
WEBHOOK_SECRET=
```

Se for usar Telegram no cliente novo:

```env
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
```

## Banco e deploy

1. Crie um projeto novo na Vercel do Rodrigo.
2. Crie/provisione um Neon novo para esse projeto.
3. Configure as variaveis do Rodrigo na Vercel.
4. Rode a migracao apontando para o Neon do Rodrigo:

```powershell
npm run db:migrate
```

5. Capture a sessao do site do Rodrigo, se o site exigir login:

```powershell
npm run site:capture-session
```

6. Publique o projeto novo na Vercel do Rodrigo.

## Checklist antes de entregar

- `DATABASE_URL` aponta para o Neon do Rodrigo.
- `.vercel/` foi criado pelo projeto Vercel do Rodrigo, nao pelo cliente anterior.
- `PUBLIC_BASE_URL` e o webhook apontam para a URL do Rodrigo.
- Token Meta e `META_PHONE_NUMBER_ID` sao do Rodrigo.
- `ADMIN_WHATSAPP_NUMBERS` contem o WhatsApp do Rodrigo com DDI/DDD, se ele for receber alertas por WhatsApp.
- Tokens `TARGET_*` sao de uma sessao capturada no site do Rodrigo.
- Admin/senha foram trocados.
- Nenhum `.env.local` antigo foi copiado.
