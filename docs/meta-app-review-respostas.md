# Análise do App (Meta App Review) — respostas

> Preencha os campos marcados com `<<...>>` antes de enviar. O resto já está
> alinhado com o que o código faz hoje (`app/api/meta/*`, `lib/meta/*`,
> `components/configuracoes/*`).

---

## 1. Onde podemos encontrar este app?

```
https://medscalebr.com
```

> `<<Confirme a URL pública exata de produção — em SETUP.md ela aparece só como
> exemplo. Rode o Depurador de Compartilhamento da Meta nela antes de enviar,
> e garanta que não há Vercel Deployment Protection / senha na URL.>>`

O MedScale é um aplicativo web (SaaS) acessível por qualquer navegador. Não há
app em loja (iOS/Android), então não existem links de App Store ou Google Play.

---

## 2. Instruções de acesso e de teste

**Resumo:** o MedScale é um sistema de gestão para clínicas e consultórios
médicos no Brasil (agenda, pacientes, financeiro e atendimento por WhatsApp).
As integrações com a Meta ficam todas em uma única tela: **Configurações →
Integrações Meta**.

### Credenciais de teste

| Campo | Valor |
|---|---|
| URL de login | `https://medscalebr.com/login` |
| E-mail | `<<e-mail da conta de teste>>` |
| Senha | `<<senha da conta de teste>>` |
| Perfil da conta | Owner (acesso total, inclusive às integrações) |

A conta de teste já vem com dados de exemplo (pacientes, agendamentos e
campanhas) e permanecerá ativa por, no mínimo, um ano após este envio.

> `<<Crie essa conta antes de enviar: registre em /registrar, promova a owner e
> deixe dados de exemplo. Se for testar o fluxo de anúncios ponta a ponta,
> conceda também acesso de leitura a uma conta de anúncios de teste do
> Business Manager para o usuário de teste do Facebook.>>`

### Passo a passo

1. Acesse `https://medscalebr.com/login` e entre com o e-mail e a senha
   acima (o botão "Entrar com Google" é opcional e não é necessário para o
   teste).
2. No menu lateral, clique em **Configurações**.
3. Localize o card **Integrações Meta**. Ele contém duas conexões
   independentes:

   **a) Anúncios do Facebook (`ads_read`, `business_management`)**
   - Clique em **"Login com Facebook"**.
   - O app redireciona para o diálogo de OAuth do Facebook
     (`https://www.facebook.com/<versão>/dialog/oauth`), pedindo as permissões
     `ads_read` e `business_management`.
   - Aceite o consentimento. Você volta para
     `/configuracoes?meta_ads=connected` com o status "Facebook conectado com
     sucesso".
   - Ainda em Configurações, use o mapeamento **conta de anúncio → unidade**
     para escolher qual conta de anúncios alimenta cada unidade da clínica.
   - Abra **Tráfego** no menu lateral: a tela lista campanhas, gasto,
     impressões e resultados lidos via Marketing API (`ads_read`), com
     seletor de período de até 90 dias. A sincronização também roda
     periodicamente por cron (`/api/cron/meta-ads-sync`).

   **b) WhatsApp da assistente (Embedded Signup)**
   - Clique em **"Conectar WhatsApp"**. O fluxo usa o SDK JS do Facebook
     (`FB.login` com `config_id`, Login do Facebook para Empresas) para o
     Embedded Signup do WhatsApp Business.
   - Ao concluir, o app troca o `code` por um token de negócio, assina o app na
     WABA, registra o número e passa a enviar/receber mensagens pela Cloud API
     (`graph.facebook.com/v19.0`).
   - Depois de conectado, mensagens recebidas no número aparecem em
     **Atendimento**, respondidas pela assistente virtual (agendamento,
     confirmação e remarcação de consultas).

   > `<<Se a conta de teste não tiver um número WhatsApp Business disponível
   > para o analista, explique aqui que a etapa (b) pode ser validada em vídeo
   > e anexe a gravação do fluxo.>>`

4. Para desconectar, use **Desconectar** no mesmo card — o app revoga o vínculo
   e apaga os tokens armazenados.

### Observações para o analista

- Toda a interface está em **português do Brasil**.
- As integrações Meta só ficam visíveis para usuários com perfil **owner** ou
  **admin** da conta; a conta de teste fornecida já é owner.
- Os tokens são armazenados criptografados e vinculados a uma única conta
  (tenant); o fluxo de OAuth é protegido por cookie de nonce anti-CSRF.

---

## 3. Confirmação de uso das APIs da Meta / Login do Facebook

Sim, o MedScale utiliza o **Login do Facebook para Empresas** e as APIs da
Meta, mas **não** para autenticar usuários no produto. O login no MedScale é
feito por e-mail/senha ou Google — o Facebook nunca é usado como provedor de
identidade, e o app **não solicita** `email`, `public_profile`, `user_friends`,
`user_gender`, `user_birthday` nem qualquer permissão de dados pessoais do
perfil.

O Login do Facebook aparece apenas como porta de entrada para o consentimento
de ativos de negócio, em dois fluxos:

| Fluxo | Onde | Permissões | Para quê |
|---|---|---|---|
| Anúncios do Facebook | Configurações → Integrações Meta → "Login com Facebook" | `ads_read`, `business_management` | Ler métricas de campanhas (gasto, impressões, resultados) das contas de anúncio que o próprio cliente autoriza, e exibi-las na tela **Tráfego** junto com os dados de consultas agendadas. Somente leitura — o app não cria, edita nem pausa campanhas. |
| WhatsApp Business (Embedded Signup) | Configurações → Integrações Meta → "Conectar WhatsApp" | `whatsapp_business_management`, `whatsapp_business_messaging` (definidas na configuração do Login para Empresas) | Conectar a WABA do cliente, registrar o número e enviar/receber mensagens pela Cloud API, para o atendimento e a confirmação de consultas. |

Em ambos os casos, quem concede o consentimento é o próprio dono da clínica,
sobre os ativos dele, dentro da conta dele no MedScale. Nenhum dado obtido é
compartilhado com terceiros nem usado fora da conta que autorizou a conexão.

---

## 4. O Login do Facebook está integrado a esta plataforma?

**Sim.**

(Integrado como **Login do Facebook para Empresas**, usado apenas para obter
consentimento de acesso a ativos de negócio — contas de anúncio e WhatsApp
Business — e não como método de login de usuários no app. Ver a seção 3.)

---

## 5. Credenciais de teste para recursos pagos / assinatura

O MedScale é um SaaS por assinatura. Para que a análise cubra todos os
recursos, fornecemos abaixo uma conta de teste com **plano completo já
liberado**, sem necessidade de pagamento:

| Campo | Valor |
|---|---|
| URL | `https://medscalebr.com/login` |
| E-mail | `<<e-mail da conta de teste>>` |
| Senha | `<<senha da conta de teste>>` |
| Plano | Completo / sem cobrança (conta de análise) |
| Usuário de teste do Facebook | `<<e-mail do test user criado no painel do app, se aplicável>>` |
| Senha do usuário de teste | `<<senha>>` |

Essas credenciais permanecerão ativas por, no mínimo, um ano após o envio.
Não há compras dentro do app nem recursos adicionais bloqueados por pagamento
além do acesso à conta.

---

## 6. Códigos de presente para download do app

**Não se aplica.** O MedScale é um aplicativo web acessado pelo navegador; não é
distribuído por App Store, Google Play ou qualquer outra loja, e não há custo
de download. O acesso completo é feito com as credenciais da seção 5.

---

## 7. Restrições geográficas (geo-blocking / geo-fencing)

**Não há restrição geográfica.** O app não aplica geo-blocking nem geo-fencing:
`https://medscalebr.com` pode ser acessado de qualquer país, sem VPN ou
qualquer contorno.

Dois pontos apenas informativos, que não bloqueiam a análise:

- A interface está integralmente em **português do Brasil** (o produto atende
  clínicas brasileiras). Recomendamos o tradutor automático do navegador se
  necessário.
- Números de telefone e formatos de documento seguem o padrão brasileiro, mas
  nenhuma tela exige localização no Brasil para funcionar.
