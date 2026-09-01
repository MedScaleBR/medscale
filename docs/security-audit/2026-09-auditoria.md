# Auditoria de Segurança — MedScale (2026-09-01)

Revisão manual de código no branch `dev` (base `7678abc`), em cinco categorias:
isolamento de inquilino, autorização decidida no navegador, IDOR, segredos
expostos / defaults inseguros, tratamento de input / XSS.

**Escopo:** todos os route handlers em `app/api/**`, o schema e as migrações de
RLS em `supabase/`, os helpers de sessão/autorização em `lib/session/` e `lib/*`,
os templates de e-mail, o middleware, a CI e o histórico do git.

**Stack:** Next.js 16 (App Router) + TypeScript · Supabase/PostgreSQL (RLS +
camada de API) · Supabase Auth (papéis owner/admin/member) · React 19 ·
Vercel + GitHub Actions + Supabase `pg_cron`.

## Resultado

7 achados verificados — **todos corrigidos nesta rodada** (mesmo branch).

| ID | Sev. | Categoria | Título | Status |
|----|------|-----------|--------|--------|
| F5 | Alta | Chaves expostas | `CRON_SECRET` sem validação de startup → `Bearer undefined` autentica os jobs | ✅ corrigido |
| F1 | Média | Isolamento de inquilino | RLS das tabelas operacionais só testa `workspace_id`; `account_id` não é autoritativo | ✅ corrigido (migração) |
| F3 | Média | Permissão no navegador | `PATCH /api/bot/config` e conexão Google Calendar sem checagem de papel no servidor | ✅ corrigido |
| F4 | Média | IDOR / mass assignment | Handlers `PATCH` repassam o corpo cru para `.update(body)` sem allow-list | ✅ corrigido |
| F2 | Baixa | Isolamento de inquilino | Endpoints de receita usam service role (RLS off) com um único filtro manual | ✅ mitigado |
| F6 | Baixa | Chaves expostas | `GET /api/health/details` público vaza erro de banco, contagem global e presença de segredos | ✅ corrigido |
| F7 | Baixa | XSS / input | Assunto do e-mail de convite interpola nome do usuário sem sanitização | ✅ corrigido |

### Ações pendentes fora do código
1. Rodar `supabase/migration_tenant_hardening.sql` no SQL Editor do Supabase (F1).
2. Garantir `CRON_SECRET` (≥ 16 caracteres) definido no ambiente (F5).

---

## Achados e correções

### F5 — [ALTA] `CRON_SECRET` sem validação de startup
`app/api/cron/*` (6 rotas) + `app/api/transcriptions/process` +
`app/api/transcriptions/generate-record` autenticavam com
`authHeader !== \`Bearer ${process.env.CRON_SECRET}\``. Sem a variável no
ambiente a comparação virava `!== 'Bearer undefined'` e um
`Authorization: Bearer undefined` autenticava qualquer chamador (marcar no-show
em massa, disparar WhatsApp para todos os pacientes, apagar gravações, rodar o
pipeline de transcrição contra IDs arbitrários). Comparação também não era
constante no tempo.

**Correção:** novo `lib/cron-auth.ts` com `requireCronAuth()` — comparação em
tempo constante (`crypto.timingSafeEqual`) e `CRON_SECRET` ausente/curto (< 16)
tratado como "nega tudo" (HTTP 500). As 8 rotas passaram a usar o helper.
`instrumentation.ts` chama `assertCronSecretConfigured()` no boot (log alto,
sem derrubar o processo).

### F1 — [MÉDIA] `account_id` não é autoritativo no RLS
`appointments`, `conversations`, `waitlist`, `ad_campaigns`, `transcriptions`
carregam `workspace_id` **e** `account_id`, mas as policies só testavam
`workspace_id`. Sem `WITH CHECK` explícito, o Postgres reutiliza o `USING` como
`WITH CHECK` — o `account_id` novo de um `UPDATE` não era validado. Com F4 (corpo
cru), dava para gravar um `account_id` de outra conta na própria linha, poluindo
agregações feitas por `.eq('account_id', X)`.

**Correção** (`supabase/migration_tenant_hardening.sql`, incorporada em
`schema.sql`):
1. Trigger `enforce_workspace_account()` `BEFORE INSERT/UPDATE` em
   `appointments`, `conversations`, `waitlist`, `ad_campaigns`, `transcriptions`,
   `revenue_entries`, `revenue_settings` — **deriva `account_id` de
   `workspace_id`**.
2. `WITH CHECK` explícito (`workspace_id` AND `account_id`) nas policies de
   `appointments`, `waitlist`, `ad_campaigns`, `transcriptions`.

### F3 — [MÉDIA] Config da Maria / Google Calendar sem checagem de papel
`requireWorkspaceSession` só garante "é membro ativo". `PATCH /api/bot/config`
(pricing_info, policies, handoff_instructions, faq…), `GET /api/google/connect`
e `DELETE /api/google/disconnect` não checavam papel — um `member` podia
reescrever o script do bot ou desconectar o calendário da conta. As rotas irmãs
`bot/onboarding/verify-meta` e `.../disconnect` já rejeitavam `member`.

**Correção:** novo helper `requireRole(session, roles)` em `lib/session/api.ts`.
As três rotas exigem `owner`/`admin`. Frontend: `configuracoes/bot` faz
`redirect` para quem não for owner/admin; o card da Maria e o bloco do Google
Agenda em `SettingsClient` só aparecem para quem pode gerenciar.

### F4 — [MÉDIA] Mass assignment em `PATCH`
`patients/[id]`, `appointments/[id]`, `availability/rules/[id]`,
`waitlist/[id]` faziam `.update(body)` com o corpo cru — dava para injetar
`account_id`, `workspace_id`, `doctor_id`, `patient_id`, `price`, `status`,
`gcal_event_id`, etc.

**Correção:** allow-list de campos por rota (objeto tipado
`Database[...]['Update']`, cópia campo-a-campo). O corpo cru nunca vai para
`.update()`.

### F2 — [BAIXA] Endpoints de receita com service role
`/api/revenue`, `/api/revenue-entries`, `/api/revenue-entries/[id]/confirm`
consultam `revenue_entries` (RLS owner-only) com `createAdminClient()` e um único
`.eq('workspace_id', session.workspaceId)`. Sem bypass ativo, mas frágil.

**Mitigação:** segundo filtro de tenant independente
(`.eq('account_id', session.accountId)`) encadeado nas três rotas. A troca maior
(estender a RLS a admin e voltar ao client autenticado) ficou registrada como
decisão de produto.

### F6 — [BAIXA] `/api/health/details` público
Endpoint sem auth devolvia `err.message` cru do Supabase, contagem global de
`bot_config` ativos (cross-tenant) e presença de `ANTHROPIC_API_KEY` /
`FINANCE_PHONE_NUMBER_ID`.

**Correção:** `/api/health/details` exige sessão de `is_medscale_admin`.
`/api/health` (público, UptimeRobot) devolve só booleans — sem `error` string,
sem contagens, sem presença de env vars.

### F7 — [BAIXA] Assunto de e-mail sem sanitização
`lib/email/templates/invite.ts` monta o `subject` com `inviterName` cru
(`profiles.full_name`, editável). O corpo HTML já escapa; o Nodemailer bloqueia
CRLF em headers, então o impacto é spoofing cosmético do assunto.

**Correção:** `sanitizeText()` remove caracteres de controle (C0/C1/DEL, inclui
CR/LF) e limita o tamanho de `inviterName`/`accountName` antes de montar
`subject`/`preheader`. `PATCH /api/profile` aplica o mesmo saneamento + limite a
`full_name`/`specialty`/`crm`/`phone`/`avatar_url`.

---

## Pontos fortes verificados

- Override de workspace (`x-workspace-id` / query / cookie) validado contra
  `memberships` em `lib/session/api.ts`.
- Cookie `ms_account_id` forjado cai em fallback seguro
  (`resolveActiveSession`).
- RLS abrangente (29 tabelas); `revenue_entries`/`revenue_settings`/
  `finance_entries` restritas a `is_account_owner()`; `finance_sessions` e
  `rate_limit_log` com deny-all; `anon` sem grants.
- Rotas `/admin` gated em duas camadas (`layout.tsx` + cada handler).
- IDOR de linha bloqueado: todo handler `[id]`/`[token]` combina RLS +
  `.eq('id', id).eq('workspace_id'|'account_id', session.*)`.
- Webhook da Meta valida HMAC com `crypto.timingSafeEqual`; `account_id` só é
  resolvido após a assinatura ser aceita.
- Gestão de equipe e configurações de receita gated no backend **e** frontend.
- Tokens de terceiros criptografados em repouso (AES-256-GCM, `lib/crypto.ts`).
- Nenhum segredo no repositório ou no histórico do git; bundle do frontend só
  expõe chaves `NEXT_PUBLIC_*` (por design).
- Sem `dangerouslySetInnerHTML` / `innerHTML` / `eval` / render de markdown em
  todo o `app/` e `components/`; template de e-mail escapa todo valor
  interpolado no HTML.
