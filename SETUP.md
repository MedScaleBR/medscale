# MedScale — Guia completo de configuração

Este guia cobre a configuração do zero: criar as contas e credenciais necessárias, preencher
o `.env.local`, rodar localmente, conectar o primeiro médico de teste e publicar em produção.
Para uma visão geral de arquitetura e decisões técnicas, veja o [README.md](README.md).

Tempo estimado: 45–90 minutos na primeira vez (a maior parte é esperar aprovações e configurar
painéis externos, não escrever código).

---

## Sumário

1. [Pré-requisitos](#1-pré-requisitos)
2. [Instalar o projeto](#2-instalar-o-projeto)
3. [Criar o projeto no Supabase](#3-criar-o-projeto-no-supabase)
4. [Gerar as chaves de segurança do projeto](#4-gerar-as-chaves-de-segurança-do-projeto)
5. [Criar as credenciais Google (Login + Google Agenda)](#5-criar-as-credenciais-google-login--google-agenda)
6. [Criar o App na Meta for Developers (WhatsApp)](#6-criar-o-app-na-meta-for-developers-whatsapp)
7. [Criar a conta na Anthropic](#7-criar-a-conta-na-anthropic)
8. [Montar o `.env.local`](#8-montar-o-envlocal)
9. [Rodar localmente](#9-rodar-localmente)
10. [Primeiro acesso e onboarding do médico de teste](#10-primeiro-acesso-e-onboarding-do-médico-de-teste)
11. [Testar o fluxo ponta a ponta](#11-testar-o-fluxo-ponta-a-ponta)
12. [Publicar em produção (Vercel)](#12-publicar-em-produção-vercel)
13. [Checklist final](#13-checklist-final)
14. [Solução de problemas comuns](#14-solução-de-problemas-comuns)

---

## 1. Pré-requisitos

| Ferramenta | Versão mínima | Conferir com |
|---|---|---|
| Node.js | 20.x (22.x recomendado) | `node -v` |
| npm | 10.x | `npm -v` |
| Git | qualquer recente | `git --version` |

Contas que você vai precisar criar (todas têm plano gratuito suficiente para começar):

- [Supabase](https://supabase.com) — banco de dados e autenticação
- [Google Cloud Console](https://console.cloud.google.com) — login com Google + Google Agenda
- [Meta for Developers](https://developers.facebook.com) — WhatsApp Cloud API
- [Anthropic Console](https://console.anthropic.com) — API do Claude (o cérebro do bot)
- [Vercel](https://vercel.com) — hospedagem (só necessário para produção, não para rodar local)

---

## 2. Instalar o projeto

```bash
npm install
```

Isso instala Next.js, Supabase, Anthropic SDK, Google APIs, componentes de UI e tudo mais
listado em `package.json`. Não é necessário instalar nada manualmente além disso.

---

## 3. Criar o projeto no Supabase

1. Acesse [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**.
2. Escolha um nome (ex: `medscale-prod` ou `medscale-dev`), uma senha forte para o banco
   (guarde-a — só é pedida uma vez) e a região mais próxima dos seus usuários (ex: `São Paulo`).
3. Espere o projeto terminar de provisionar (1–2 minutos).
4. Vá em **SQL Editor** (menu lateral) → **New query**.
5. Abra o arquivo [`supabase/schema.sql`](supabase/schema.sql) deste repositório, copie o
   conteúdo **inteiro** e cole no editor.
6. Clique em **Run**. O script cria, nesta ordem: extensões, todas as tabelas (`profiles`,
   `patients`, `appointments`, `conversations`, `messages`, `ad_campaigns`, `revenue_entries`,
   `webhook_logs`, `google_tokens`, `availability_rules`, `availability_exceptions`,
   `bot_config`, `handoff_logs`, `handoff_hours`), políticas de RLS, índices e triggers.
   - Se aparecer erro, confira se colou o arquivo inteiro de uma vez — os blocos dependem uns
     dos outros na ordem em que aparecem.
7. Vá em **Project Settings → API** e anote três valores, que vão para o `.env.local` depois:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role** key (em "Project API keys", clique em "Reveal") → `SUPABASE_SERVICE_ROLE_KEY`
     — **nunca** exponha essa chave no client ou em repositórios públicos; ela ignora RLS.
8. Vá em **Authentication → Providers → Google** e deixe a tela aberta — você volta aqui no
   passo 5 depois de criar as credenciais no Google Cloud Console.

> **Por que rodar o SQL manualmente em vez de migrations automáticas?** Este projeto ainda não
> usa o Supabase CLI/migrations — é um único arquivo `schema.sql` para manter o setup simples.
> Se o projeto crescer e passar a ter múltiplos ambientes, vale migrar para
> `supabase migration new` e `supabase db push`.

---

## 4. Gerar as chaves de segurança do projeto

Duas chaves são geradas localmente, não vêm de nenhum painel externo:

```bash
# TOKEN_ENCRYPTION_KEY — criptografa em repouso o token da Meta e os tokens OAuth do Google
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

```bash
# CRON_SECRET — protege /api/cron/reminders contra chamadas externas (qualquer string forte serve)
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

Guarde os dois valores gerados — eles vão para o `.env.local` no passo 8. Use o **mesmo**
`TOKEN_ENCRYPTION_KEY` em todos os ambientes (dev/staging/prod) onde você precisar descriptografar
os mesmos dados; se gerar uma chave nova, todos os tokens já salvos com a chave antiga páram de
funcionar e os médicos precisam reconectar WhatsApp e Google Agenda.

---

## 5. Criar as credenciais Google (Login + Google Agenda)

Um único projeto no Google Cloud Console cobre tanto o "Entrar com Google" (autenticação de
médicos no painel) quanto a integração com o Google Agenda.

### 5.1 Criar o projeto

1. Acesse [console.cloud.google.com](https://console.cloud.google.com) → seletor de projeto no
   topo → **New Project**.
2. Nome: `medscale-prod` (ou o que preferir). Crie.

### 5.2 Ativar a Google Calendar API

1. Menu lateral → **APIs & Services → Library**.
2. Busque **Google Calendar API** → **Enable**.

### 5.3 Configurar a tela de consentimento OAuth

1. **APIs & Services → OAuth consent screen**.
2. User Type: **External** (a menos que você tenha Google Workspace e queira restringir a
   organização).
3. Preencha nome do app (`MedScale`), e-mail de suporte e domínio autorizado.
4. Em **Scopes**, adicione:
   - `https://www.googleapis.com/auth/calendar`
   - `https://www.googleapis.com/auth/calendar.events`
   - `https://www.googleapis.com/auth/userinfo.email`
   - `.../auth/userinfo.profile` e `openid` (adicionados automaticamente para o login)
5. Em **Test users**, adicione os e-mails dos médicos que vão testar antes da verificação do
   app ir para produção (enquanto o app está em modo "Testing", só esses e-mails conseguem
   autorizar).
6. **Importante para produção real:** com mais de 100 usuários ou saindo do modo "Testing", a
   Google exige verificação do app (revisão manual, pode levar semanas). Comece esse processo
   com antecedência se for lançar publicamente.

### 5.4 Criar as credenciais OAuth 2.0

1. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
2. Tipo: **Web application**. Nome: `MedScale Web`.
3. **Authorized JavaScript origins**:
   - `http://localhost:3000`
   - `https://<seu-domínio-de-produção>`
4. **Authorized redirect URIs** — adicione **todas** estas (dev e produção, Supabase e Google
   Agenda usam callbacks diferentes):
   - `http://localhost:3000/api/google/callback`
   - `https://<seu-domínio-de-produção>/api/google/callback`
   - `https://<seu-projeto>.supabase.co/auth/v1/callback` (para o login com Google via Supabase
     Auth — pegue essa URL exata na tela do Supabase do passo 3.8)
5. Crie e copie **Client ID** e **Client Secret** — vão para o `.env.local`
   (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) e também para o Supabase no próximo passo.

### 5.5 Ligar o login com Google no Supabase

1. Volte para **Supabase → Authentication → Providers → Google** (deixado aberto no passo 3.8).
2. Ative o provider, cole o mesmo **Client ID** e **Client Secret** do passo anterior.
3. Salve. A URL de callback exibida ali (`https://<seu-projeto>.supabase.co/auth/v1/callback`)
   é a que você já deve ter adicionado no passo 5.4.

---

## 6. Criar o App na Meta for Developers (WhatsApp)

O MedScale suporta dois modelos — escolha um para começar (dá para ter médicos nos dois modelos
ao mesmo tempo depois):

- **Modelo A — App único da MedScale**: você cria um App Meta e todos os médicos usam o mesmo
  webhook com o mesmo `META_VERIFY_TOKEN`. Mais simples para operar, mas cada número dos médicos
  precisa ser adicionado manualmente a este App (ou ao WABA dele, se for Business Solution
  Provider).
- **Modelo B — cada médico traz seu próprio App**: o próprio médico segue o wizard em
  **Configurações → Bot WhatsApp** dentro do painel, que gera um Verify Token único por médico.
  Esse é o modelo recomendado para começar, pois não exige que a MedScale seja um Business
  Solution Provider da Meta — é só documentado aqui para você entender o que o médico vai ver.

Os passos abaixo cobrem o **Modelo A** (setup único, feito por você agora). O Modelo B é feito
pelo próprio médico depois, dentro do produto — veja a seção 10.

### 6.1 Criar o App

1. Acesse [developers.facebook.com/apps](https://developers.facebook.com/apps) → **Create App**.
2. Tipo: **Business**.
3. Depois de criado, no painel do App, adicione o produto **WhatsApp**.

### 6.2 Configurar o webhook

1. No produto WhatsApp → **Configuration**.
2. **Callback URL**: `https://<seu-domínio>/api/whatsapp/webhook`
   (em desenvolvimento local isso não é acessível pela Meta — use um túnel como `ngrok` ou
   `cloudflared` apontando para `localhost:3000` se precisar testar o webhook antes do deploy).
3. **Verify Token**: qualquer string que você escolher — esse é o valor de `META_VERIFY_TOKEN`
   no `.env.local`.
4. Clique em **Verify and Save**. O Next.js responde ao desafio GET automaticamente
   (`app/api/whatsapp/webhook/route.ts`).
5. Em **Webhook fields**, assine o campo **messages**.

### 6.3 Obter o Phone Number ID e o token permanente

1. No produto WhatsApp → **API Setup**, você vê um número de teste da Meta já disponível — dá
   para usar esse número para testar antes de portar um número real.
2. Copie o **Phone Number ID** exibido ali.
3. **Token temporário vs. permanente**: a tela mostra um token de 24h por padrão — **não use
   esse para produção**. Gere um token permanente:
   - **Business Settings → Users → System Users** → criar um System User com papel Admin.
   - **Add Assets** → vincule o App do WhatsApp a esse System User.
   - **Generate New Token** → selecione o App, marque o escopo `whatsapp_business_messaging` e
     `whatsapp_business_management`, e gere. Esse token não expira automaticamente (só se você
     revogar). Copie e guarde com segurança — ele só é mostrado uma vez.
4. O Phone Number ID e o token permanente **não vão direto no `.env.local`** — eles são inseridos
   pelo médico dentro do produto, em **Configurações → Bot WhatsApp**, que valida ambos contra a
   Meta Graph API antes de salvar (criptografados) em `profiles`. Guarde os dois valores à mão
   para o passo 10.

---

## 7. Criar a conta na Anthropic

1. Acesse [console.anthropic.com](https://console.anthropic.com) e crie uma conta.
2. Adicione um método de pagamento (a API é paga por uso — não tem tier gratuito perpétuo, mas
   o custo por conversa do bot é baixo).
3. **API Keys → Create Key**. Copie o valor (começa com `sk-ant-...`) — vai para
   `ANTHROPIC_API_KEY`.

---

## 8. Montar o `.env.local`

Copie o exemplo e preencha com os valores coletados nos passos anteriores:

```bash
cp .env.local.example .env.local
```

Referência de onde cada variável vem:

| Variável | De onde vem | Obrigatória para rodar local? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API (passo 3.7) | Sim |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API (passo 3.7) | Sim |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API (passo 3.7) | Sim |
| `META_APP_SECRET` | Meta App → Settings → Basic → App Secret | Só para receber mensagens reais |
| `META_VERIFY_TOKEN` | Você escolhe (passo 6.2) | Só para receber mensagens reais |
| `ANTHROPIC_API_KEY` | Anthropic Console (passo 7) | Sim, para o bot responder |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` em dev | Sim |
| `CRON_SECRET` | Gerado no passo 4 | Só para lembretes automáticos |
| `TOKEN_ENCRYPTION_KEY` | Gerado no passo 4 | Sim, antes de conectar WhatsApp/Google |
| `GOOGLE_CLIENT_ID` | Google Cloud Console (passo 5.4) | Só para Google Agenda |
| `GOOGLE_CLIENT_SECRET` | Google Cloud Console (passo 5.4) | Só para Google Agenda |
| `GOOGLE_REDIRECT_URI` | `http://localhost:3000/api/google/callback` em dev | Só para Google Agenda |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | Provedor SMTP de sua escolha (Gmail, provedor do seu domínio, etc.) | Opcional — sem elas, o convite de `/admin` é criado normalmente e a tela mostra um link para copiar/colar manualmente |
| `NEXT_PUBLIC_POSTHOG_KEY` / `NEXT_PUBLIC_POSTHOG_HOST` | [posthog.com](https://posthog.com) → Project Settings | Opcional |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` / `SENTRY_ORG` / `SENTRY_PROJECT` | [sentry.io](https://sentry.io) → novo projeto Next.js | Opcional |

Sentry e PostHog são inicializados condicionalmente — deixe as variáveis em branco para
desativá-los sem quebrar nada.

---

## 9. Rodar localmente

```bash
npm run dev
```

Acesse [http://localhost:3000](http://localhost:3000). Você deve ser redirecionado para
`/login`. Clique em **Continuar com Google** — isso testa se o passo 5 (login) está correto.

Outros comandos úteis:

```bash
npm run build   # build de produção — bom para pegar erros de tipo antes de dar deploy
npm run lint    # ESLint
npm run start   # roda o build de produção localmente (depois de `npm run build`)
```

---

## 10. Primeiro acesso, virar admin MedScale e criar a primeira account

O MedScale é multi-tenant: uma **account** (contrato/cliente) pode ter várias **workspaces**
(unidades/clínicas), e cada pessoa é **membro** de uma account com um papel (owner/admin/member).
Nada disso existe até você criar manualmente — o schema não vem com nenhuma account de exemplo.

1. Logue uma vez pela tela normal (`/login` → Continuar com Google, ou e-mail/senha). O Supabase
   cria automaticamente uma linha em `profiles` (via trigger `on_auth_user_created`), mas como
   você ainda não é membro de nenhuma account, você cai em **`/sem-acesso`** — isso é esperado.
2. No SQL Editor do Supabase, torne esse usuário admin da MedScale (o painel `/admin` é separado
   de qualquer account/workspace — é a visão interna da MedScale sobre todos os clientes):
   ```sql
   insert into public.medscale_admins (user_id)
   values ('COLE_AQUI_O_UUID_DO_SEU_USUÁRIO'); -- Authentication → Users, na tabela do Supabase
   ```
3. Acesse **`/admin`** e crie sua primeira account em **Accounts → Nova account** (nome, plano,
   módulos, e o e-mail do owner — pode ser o seu próprio e-mail). Isso cria a account, uma
   workspace padrão com o mesmo nome, e um convite pendente para o owner.
4. Se as variáveis `SMTP_*` estiverem configuradas, o convite chega por e-mail; senão, a própria tela
   mostra um link `/invite/<token>` para copiar e abrir. Abra o link, clique em **Aceitar
   convite** (já logado com o e-mail convidado) — isso cria sua `membership` e te dá acesso ao
   painel normal em `/dashboard`.
A partir daí, com acesso normal ao workspace:

5. **Configurações → Perfil**: preencha nome, especialidade, CRM.
6. **Configurações → Bot WhatsApp**:
   - Escolha **"Já tenho um número"**.
   - Cole o **Phone Number ID** e o **token permanente** que você guardou no passo 6.3.
   - Clique em **Verificar conexão** — isso chama a Meta Graph API de verdade; se os valores
     estiverem corretos, o número aparece salvo e o bot fica marcado como ativo.
   - Se você está usando o Modelo B (App próprio do médico), a tela também mostra a **Callback
     URL** e o **Verify Token único** desse médico para colar no App Meta dele.
   - Preencha nome do bot, procedimentos, convênios, mensagens automáticas e o número de
     handoff humano. O preview no lado direito atualiza em tempo real.
   - O bot em si conversa e agenda **24 horas por dia, todos os dias** — não existe "horário de
     atendimento do bot". Quem tem horário próprio é a transferência para um humano: cadastre em
     **Horário de atendimento humano**, na mesma tela, os dias/horas em que alguém de verdade
     responde o número de handoff. Fora desse horário (ou sem nada cadastrado — nesse caso o
     handoff fica disponível 24/7 por padrão), o bot avisa o paciente com a mensagem "quando
     ninguém está disponível" e continua ajudando sozinho, em vez de fingir transferir a conversa.
   - Use **Enviar mensagem de teste** com seu próprio WhatsApp para confirmar que o envio
     funciona antes de divulgar o número para pacientes de verdade.
7. **Configurações → Google Agenda**: clique em **Conectar Google Agenda** e autorize. Se o app
   Google ainda está em modo "Testing" (passo 5.3), só e-mails na lista de test users conseguem
   autorizar.
8. **Meu expediente** (item próprio no menu lateral, fora de Configurações): cadastre pelo menos um horário recorrente (ex: Segunda a
   sexta, 08:00–12:00, slots de 30min). **Sem isso, o bot nunca vai oferecer horário nenhum ao
   paciente** — `getFreeSlotsForBot` retorna lista vazia se não houver `availability_rules`
   ativas para aquele dia da semana (o bot segue respondendo normalmente, só não tem horário
   nenhum pra oferecer). Não confunda com a disponibilidade de handoff do passo anterior — são
   duas tabelas e duas telas diferentes, de propósito.

---

## 11. Testar o fluxo ponta a ponta

1. Mande uma mensagem de WhatsApp para o número conectado, de um número de paciente qualquer
   (pode ser o seu próprio celular, diferente do usado no "enviar mensagem de teste").
2. O bot deve responder de acordo com a mensagem de boas-vindas configurada.
3. Confirme um agendamento — verifique em **Agenda** no painel se a consulta apareceu com a tag
   **Bot**, e (se o Google Agenda estiver conectado) confira também no Google Calendar do
   médico se o evento foi criado.
4. Peça para "falar com um atendente" na conversa — confirme que o bot transfere e que a
   conversa aparece marcada como **Atenção humana** em **Bot WhatsApp** no painel (inbox).
5. Verifique **Configurações → Bot WhatsApp** se a conversa apareceu no histórico com status
   correto.

Se algo não funcionar, veja a seção [14. Solução de problemas](#14-solução-de-problemas-comuns).

---

## 12. Publicar em produção (Vercel)

1. Suba o repositório para o GitHub/GitLab (se ainda não estiver).
2. Em [vercel.com/new](https://vercel.com/new), importe o repositório. O Next.js é detectado
   automaticamente.
3. Em **Environment Variables**, cole **todas** as variáveis do seu `.env.local`, trocando os
   valores de `localhost` pelos de produção:
   - `NEXT_PUBLIC_APP_URL` → seu domínio final (ex: `https://app.medscalebr.com`)
   - `GOOGLE_REDIRECT_URI` → `https://<seu-domínio>/api/google/callback`
4. Deploy.
5. Volte no **Google Cloud Console** (passo 5.4) e no **App Meta** (passo 6.2) e adicione as
   URLs de produção que ainda não estavam lá (redirect URIs, callback do webhook).
6. **Cron de lembretes**: o arquivo [`vercel.json`](vercel.json) já declara
   `/api/cron/reminders` rodando a cada hora — nenhuma configuração extra é necessária além de
   `CRON_SECRET` estar nas env vars do projeto na Vercel (a própria Vercel envia esse valor no
   header `Authorization` automaticamente quando bate o horário).
7. Depois do primeiro deploy, repita o passo 10 (onboarding) para cada médico em produção — os
   dados de dev (Supabase local/projeto de teste) não migram automaticamente para produção a
   menos que você aponte para o mesmo projeto Supabase.

---

## 13. Checklist final

- [ ] `supabase/schema.sql` rodado sem erros no projeto Supabase
- [ ] Login com Google funcionando em `/login`
- [ ] `.env.local` (ou env vars da Vercel) com todas as chaves obrigatórias preenchidas
- [ ] `TOKEN_ENCRYPTION_KEY` gerado e **igual** em todos os ambientes que compartilham dados
- [ ] Webhook do WhatsApp verificado com sucesso na Meta (ícone verde no painel da Meta)
- [ ] Número conectado e validado em Configurações → Bot WhatsApp
- [ ] Pelo menos uma `availability_rule` cadastrada
- [ ] Google Agenda conectado (se for usar disponibilidade real)
- [ ] Mensagem de teste recebida no WhatsApp do médico
- [ ] Agendamento de teste criado via bot e visível em `/agenda`
- [ ] Handoff testado (conversa marcada como "Atenção humana")
- [ ] (Produção) Cron de lembretes com `CRON_SECRET` configurado na Vercel
- [ ] (Produção) Todas as redirect URIs de produção adicionadas no Google e na Meta

---

## 14. Solução de problemas comuns

**Login com Google não funciona / redireciona para uma tela de erro do Google**
Confira se a redirect URI `https://<seu-projeto>.supabase.co/auth/v1/callback` está cadastrada
exatamente igual no Google Cloud Console (passo 5.4) — um `/` a mais ou a menos já quebra.

**Webhook da Meta não verifica ("The callback URL or verify token couldn't be validated")**
- Confirme que `META_VERIFY_TOKEN` no `.env.local`/Vercel é **idêntico** ao que você digitou no
  painel da Meta.
- Em desenvolvimento local, a Meta não alcança `localhost` — use `ngrok http 3000` (ou similar)
  e cole a URL pública temporária como Callback URL só para testar a verificação.

**Bot não responde a nenhuma mensagem**
- Confira em **Configurações → Bot WhatsApp** se o status está "Bot ativo" (verde). Sem
  `bot_config.is_active = true`, `processIncomingMessage` ignora a mensagem silenciosamente.
- Veja a tabela `webhook_logs` no Supabase — toda mensagem recebida é logada ali, mesmo que o
  processamento falhe depois. Um `error` preenchido na linha mais recente indica o motivo.

**Bot nunca oferece nenhum horário disponível**
Cadastre pelo menos uma regra em **Configurações → Disponibilidade**. Sem `availability_rules`
para o dia da semana em questão, `getFreeSlotsForBot` retorna lista vazia por design.

**"Refresh token não recebido" ao conectar o Google Agenda**
Acontece quando o médico já autorizou o app antes e a Google não reemite o refresh token na
segunda vez. Peça para revogar o acesso em
[myaccount.google.com/permissions](https://myaccount.google.com/permissions) (procurar "MedScale")
e conectar de novo.

**Erro `TOKEN_ENCRYPTION_KEY ausente ou inválida`**
A chave precisa ter exatamente 64 caracteres hexadecimais (32 bytes). Gere de novo com o comando
do passo 4 — não digite a chave manualmente.

**`next build` falha, mas `next dev` funciona**
Rode `npm run lint` e `npx tsc --noEmit` separadamente para isolar se é erro de tipo ou de
ESLint; o build roda os dois e para no primeiro erro.

**Lembretes automáticos não estão sendo enviados**
- Confirme que o projeto está na Vercel (o cron declarado em `vercel.json` só roda lá, não em
  outros hosts) e que `CRON_SECRET` está nas env vars de produção.
- O lembrete só é enviado para consultas entre 23h e 25h no futuro (janela de ~1h em torno de
  24h antes) — não espere um envio imediato ao criar a consulta.
- O template `appointment_reminder` precisa estar **aprovado** pela Meta antes de poder ser
  usado — templates novos ficam em revisão por até 24h.
