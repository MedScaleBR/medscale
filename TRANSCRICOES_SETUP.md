# Transcrição de Consultas — setup

> Como funciona o módulo por dentro? Veja **[TRANSCRICOES_COMO_FUNCIONA.md](TRANSCRICOES_COMO_FUNCIONA.md)**.
> Este guia assume que o resto do projeto já está rodando — se ainda não seguiu o
> **[SETUP.md](SETUP.md)** principal (Supabase, Google, Meta, Anthropic), faça isso primeiro.

Tempo estimado: 15–20 minutos.

---

## 1. Pré-requisitos

- Projeto MedScale já configurado e rodando (Supabase, `.env.local`, etc. — ver `SETUP.md`).
- `CRON_SECRET` já configurado tanto no `.env.local`/Vercel quanto salvo como o secret
  `cron_secret` no **Supabase Vault** (isso é feito rodando `supabase/cron.sql` — se você ainda
  não rodou aquele arquivo, rode antes de continuar; o módulo de transcrição reaproveita esse
  mesmo secret via `public.cron_secret()`). Confirme com `select public.cron_secret();` no SQL
  Editor — deve retornar o mesmo valor do `.env.local`, não vazio.
  > Se `supabase/cron.sql` der erro `permission denied to set parameter "app.cron_secret"`: uma
  > versão antiga deste arquivo usava `alter database ... set`, que a Supabase não permite mais.
  > Pegue a versão atual do repositório (usa Supabase Vault em vez disso) e rode de novo.
- Conta na [OpenAI Platform](https://platform.openai.com) com um método de pagamento cadastrado
  (a API do Whisper é paga por uso).

---

## 2. Rodar o SQL do módulo

1. Abra o **SQL Editor** do seu projeto Supabase.
2. Copie o conteúdo inteiro de [`supabase/transcriptions.sql`](supabase/transcriptions.sql) e
   rode de uma vez.
3. Isso cria: o enum `transcription_status`, a tabela `transcriptions`, os índices, o trigger de
   `updated_at`, as policies de RLS, os grants explícitos, as policies de `storage.objects` para
   o bucket `recordings` (criado no próximo passo), as funções
   `trigger_transcription_process`/`trigger_transcription_generate`, e registra a tabela na
   publicação `supabase_realtime`.
   - Se dar erro em `create policy "recordings: ..."`, confira se o bucket `recordings` (passo 3)
     já existe — as policies de storage exigem que o bucket exista, mas a ordem no arquivo não
     cria o bucket automaticamente (isso só dá pra fazer pelo Dashboard, não por SQL).

## 3. Criar o bucket de áudio no Storage

1. No Supabase Dashboard, vá em **Storage → New bucket**.
2. Preencha:
   - **Name**: `recordings` (exatamente esse nome — as policies do passo 2 são hardcoded para ele)
   - **Public**: **desmarcado** (bucket privado — o áudio nunca é servido publicamente, só via
     signed URL de curta duração gerada pelo backend)
   - **File size limit**: `150 MB`
   - **Allowed MIME types**: `audio/webm, audio/ogg, audio/mp4, audio/wav`
3. Se você rodou o SQL do passo 2 **antes** de criar o bucket e ele deu erro nas policies de
   `storage.objects`, volte no SQL Editor e rode só essa parte do arquivo de novo (seção "3.
   STORAGE" de `transcriptions.sql`) depois de criar o bucket.

## 4. Registrar o cron de limpeza

Se você já rodou `supabase/cron.sql` **depois** desta atualização (que já inclui o job
`cleanup-old-recordings`), pode pular este passo. Senão, rode `supabase/cron.sql` de novo — o
`cron.schedule` é idempotente (atualiza o job existente pelo nome, não duplica).

Confira que o job foi registrado:

```sql
select jobname, schedule, active from cron.job where jobname = 'cleanup-old-recordings';
```

Deve retornar uma linha, `schedule = '0 3 * * *'`, `active = true`.

## 5. Variáveis de ambiente

Adicione ao `.env.local` (já foram deixadas em branco lá, só preencher) e ao painel da Vercel:

| Variável | De onde vem | Obrigatória? |
|---|---|---|
| `OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com/api-keys) → Create new secret key | Sim — sem ela, `transcribeAudio()` falha na primeira chamada |
| `WHISPER_LANGUAGE` | Fixo em `pt` | Recomendada (evita o Whisper detectar idioma errado em áudios curtos/ruidosos) |
| `RECORDING_RETENTION_DAYS` | Dias até o cron apagar o áudio de uma transcrição já assinada | Opcional, default `90` |

Não existe uma variável de limite de tamanho de arquivo — o teto real é o **File size limit** do
bucket `recordings` configurado no passo 3 (150MB). O upload é direto ao Storage (ver
`TRANSCRICOES_COMO_FUNCIONA.md`), então não há limite de corpo de rota do Next.js a se preocupar.

`ANTHROPIC_API_KEY` e `NEXT_PUBLIC_APP_URL` já devem estar configuradas pelo setup principal — a
geração do prontuário (Claude) e o disparo do pipeline (`pg_net` chamando de volta o seu domínio)
reaproveitam essas mesmas variáveis, não precisa duplicar nada.

Depois de editar o `.env.local`, reinicie `npm run dev` para as novas variáveis serem lidas.

## 6. Ativar o módulo para uma account

O módulo vem **inativo por padrão** (mesmo padrão de `waitlist`, `financial`, etc.) e é
gerenciado pelo admin MedScale do mesmo jeito que os demais — não precisa SQL manual:

1. Acesse **`/admin/accounts`** (como usuário admin MedScale — ver `SETUP.md` seção 10 se ainda
   não é admin) → escolha a account de teste.
2. Em **Plano e módulos**, marque **Transcrições** na lista de módulos e clique em **Salvar**.

Dê refresh na página do médico — o item **Transcrições** aparece no menu lateral, e o botão
**Gravar consulta** aparece na página de cada paciente.

Alternativa direto no banco, se preferir (equivalente ao que o botão acima faz):

```sql
update public.accounts
set modules = array_append(modules, 'transcriptions')
where id = 'COLE_AQUI_O_ID_DA_ACCOUNT';
```

## 7. Testar o fluxo ponta a ponta

1. Acesse **Pacientes → (um paciente qualquer)**.
2. Clique em **Gravar consulta** → confirme o consentimento → fale algumas frases simulando uma
   consulta (queixa, um medicamento, uma conduta) → **Encerrar gravação**.
3. Você deve ser redirecionado para `/transcricoes/{id}` com um spinner ("Na fila para
   transcrição...", depois "Transcrevendo...", depois "Gerando o prontuário..."). Se a página
   travar em "Na fila" por mais de alguns segundos sem mudar, veja a seção de problemas abaixo.
4. Quando o status virar **Aguardando revisão**, confira se o SOAP preenchido faz sentido com o
   que você falou, e se o painel de alertas (se aparecer) lista os campos que você não mencionou.
5. Edite algum campo, clique em **Assinar prontuário**, confirme no dialog.
6. Confira que o status virou **Assinado** e o editor ficou somente leitura.
7. Se a gravação estava vinculada a uma consulta (`appointment_id`), confira em **Agenda** que
   ela foi marcada como `realizado`.

## 8. Checklist final

- [ ] `supabase/transcriptions.sql` rodado sem erros
- [ ] Bucket `recordings` criado (privado, 150MB, MIME types configurados)
- [ ] `select * from cron.job where jobname = 'cleanup-old-recordings';` retorna 1 linha ativa
- [ ] `OPENAI_API_KEY` preenchida no `.env.local` e na Vercel
- [ ] Módulo `transcriptions` ativado em pelo menos uma account de teste
- [ ] Gravação de teste concluída ponta a ponta (fila → transcrito → rascunho → assinado)
- [ ] Realtime confirmado (a página muda de status sozinha, sem precisar dar refresh)

---

## 9. Solução de problemas comuns

**A página trava em "Na fila para transcrição..." e nunca muda**
- Confira os logs da rota `/api/transcriptions/process` (Vercel → seu projeto → Logs, ou
  `next dev` no terminal local). Erro mais comum: `OPENAI_API_KEY` ausente ou inválida.
- Confirme que a função RPC disparou: no SQL Editor,
  `select * from net._http_response order by created desc limit 5;` mostra as últimas chamadas
  HTTP feitas por `pg_net` — confira o `status_code` da chamada para `/api/transcriptions/process`.
- Se o `status_code` for `401`, o `CRON_SECRET` salvo no Supabase Vault (`select
  public.cron_secret();`) não bate com a env var `CRON_SECRET` do seu deploy — reconfirme os
  dois valores. Pra trocar o valor no Vault: `select vault.update_secret(id, 'novo_valor') from
  vault.secrets where name = 'cron_secret';`.

**A página não atualiza sozinha, preciso dar F5 pra ver o status novo**
Realtime não está entregando eventos. Confirme que a tabela está na publicação:
```sql
select * from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'transcriptions';
```
Se não retornar nada, rode `alter publication supabase_realtime add table public.transcriptions;`.

**Erro ao encerrar a gravação, algo como "The object exceeded the maximum allowed size"**
A gravação passou do **File size limit** configurado no bucket `recordings` (passo 3, 150MB por
padrão). Aumente o limite no Dashboard (Storage → recordings → Edit bucket) se precisar de
gravações maiores — o upload é direto ao Storage, então não existe limite de corpo de rota do
Next.js envolvido (ver `TRANSCRICOES_COMO_FUNCIONA.md`).

**Erro "Falha ao preparar o upload" antes mesmo de começar a subir o áudio**
`POST /api/transcriptions/upload-url` falhou. Confira se o módulo `transcriptions` está mesmo
ativado para a account (passo 6) e se o bucket `recordings` existe com esse nome exato — sem o
bucket, `createSignedUploadUrl` retorna erro imediatamente.

**"Consentimento do paciente é obrigatório" mesmo depois de confirmar o dialog**
Confira se o navegador não bloqueou o microfone silenciosamente — sem permissão de `getUserMedia`,
`startRecording()` cai no catch e mostra "Não foi possível acessar o microfone", não chega a
gravar nada. Veja o ícone de microfone na barra de endereço do navegador.

**Claude retorna erro "invalid JSON" e a transcrição vai para `error`**
Raro, mas acontece se a transcrição do Whisper vier vazia ou só ruído. O `error_message` da
transcrição guarda os primeiros 500 caracteres da resposta bruta do Claude — confira nos logs do
servidor (`generate-record/route.ts` loga isso via `console.error`) antes de tentar de novo.

**Áudio não aparece mais no Storage, mas a transcrição continua lá**
Comportamento esperado depois de `RECORDING_RETENTION_DAYS` dias com a transcrição já assinada —
o cron `cleanup-old-recordings` apaga só o arquivo de áudio, não o texto nem o prontuário.
`audio_path` vira `'[deleted]'` na linha correspondente.
