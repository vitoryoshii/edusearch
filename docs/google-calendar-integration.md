# Fase 3A: Google Agenda/Meet, disponibilidade e aulas de teste

Primeira versão da agenda real. Professores conectam a própria Google Agenda; alunos reservam
**aulas de teste** (sem preço, sem pagamento) em horários livres; cada aula vira um evento com
link do **Google Meet** na agenda do professor.

**Estado:** implementado e testado com Google falso (sem rede). **Desligado** em produção até a
configuração e a aprovação descritas em [Operação](#operação). A plataforma continua fechada
(controle de admissão) e os documentos jurídicos continuam pendentes.

## Escopo desta fase

| Incluído | Fora (continua desligado) |
| --- | --- |
| Conexão OAuth do professor com a Google Agenda (separada do login) | Aulas comerciais e preços na reserva |
| Disponibilidade semanal (fuso `America/Sao_Paulo`) | Pagamentos (Pix, cartão) |
| Reserva de aula de teste, idempotente, sem conflitos | Convites por e-mail do Google (`sendUpdates=none`) |
| Evento + Meet na agenda do professor; remoção ao cancelar | Leitura de outras agendas (free/busy do Google) |
| Revogação, expiração e reconexão | Abertura ao público |

## Arquitetura

```
Professor ──(1) POST /v1/me/google-calendar/authorization──▶ API ──▶ URL de consentimento
        ◀───────────────── authorization_url (state cifrado + PKCE) ─┘
        ──(2) consentimento no Google ──▶ redirect para /conta/agenda/google/retorno?code&state
App     ──(3) POST /v1/me/google-calendar/connection {code,state} + JWT do Supabase ──▶ API
API     ──(4) troca o código (client_secret + code_verifier) ──▶ oauth2.googleapis.com
        ──(5) grava o refresh token CIFRADO em private.google_calendar_credentials
Aluno   ──(6) POST /v1/lessons ──▶ API: valida + INSERT (RLS, EXCLUDE, idempotência) → COMMIT
API     ──(7) refresh → access token ──▶ Calendar API: cria evento com Meet (ID = ID da aula)
        ──(8) grava synced + meet_url (ou failed/not_connected) na aula
```

### Decisões

- **Mesmo projeto e cliente OAuth do login**, fluxo diferente. O login (GIS → ID token →
  Supabase) não muda. A agenda usa o fluxo de **código com PKCE**, `access_type=offline`,
  `prompt=consent` e `include_granted_scopes=true` (autorização incremental). O
  `client_secret` existe **só** na API.
- **Escopo mínimo:** `https://www.googleapis.com/auth/calendar.events.owned` (criar, alterar e
  remover eventos nas agendas do próprio professor). Sem leitura de outras agendas, contatos ou
  e-mail. Consentimento granular: se o professor desmarcar a permissão, a API recusa
  (`calendar_scope_denied`) e revoga o que recebeu.
- **CSRF/troca de conta:** o `state` é cifrado (AES-256-GCM, 10 min) e carrega o `sub` de quem
  iniciou e o `code_verifier`. A conclusão exige o JWT da sessão e `state.sub == sub`. Um link
  de autorização de outra pessoa não conecta a sua conta (`state_mismatch`).
- **Tokens só no backend, cifrados na aplicação.** Refresh token cifrado com AES-256-GCM, dados
  associados `edusearch:gcal-refresh:<professor>:v<versão>` (o texto cifrado não serve em outra
  linha/conta). A chave (`API_TOKEN_ENCRYPTION_KEY`) fica **fora do banco** (variável da
  API). Access tokens **não** são guardados: são renovados a cada operação.
  - Por que não Supabase Vault (plano da 2.6A): no Vault a chave de cifragem fica no próprio
    projeto Supabase; um acesso privilegiado ao banco obtém dado e chave. Com a chave na API, um
    vazamento só do banco não revela tokens.
- **Banco como última barreira:**
  - `EXCLUDE USING gist` impede aulas agendadas sobrepostas **por professor e por aluno**;
  - `UNIQUE (student_id, idempotency_key)` torna a reserva idempotente;
  - o trigger `private.lessons_before_insert` força os campos do servidor e confere janela,
    disponibilidade, duração oferecida e disciplina;
  - `lessons_test_only CHECK (is_test)` impede aula comercial.
- **Google fora da transação.** A aula é gravada e confirmada antes de chamar o Google. Falha
  no Google nunca desfaz a aula: fica `calendar_sync_status=failed` e o professor usa
  "Sincronizar agenda". Evento com ID determinístico (ID da aula): repetir nunca duplica.
- **Fuso único:** `America/Sao_Paulo` (sem horário de verão desde 2019). Janelas em minutos
  locais; o app exibe sempre em horário de Brasília, independentemente do aparelho.

## Segurança

| Camada | Garantia | Teste |
| --- | --- | --- |
| Schema `private` | anon/authenticated sem USAGE; credenciais só para `edusearch_api` | `test_client_roles_cannot_reach_tokens_or_busy_function`, `test_private_schema_not_usable_by_api_roles` |
| RLS das credenciais | `edusearch_api` só lê o próprio professor ou o professor de uma aula do aluno (`sub` das claims) | `test_booking_*` |
| RLS das aulas | só participantes veem; aluno só reserva para si, só professor **publicado**; participantes só mudam `status` | `test_rls_on_lessons` |
| Campos do servidor | `meet_url`, `google_event_id`, sincronização: GRANT só para `edusearch_api` | `test_rls_on_lessons`, `test_db_blocks_overlap_and_server_fields_even_without_api` |
| Conflitos | EXCLUDE por professor e aluno, mesmo com INSERT direto | `test_db_blocks_overlap_*`, `test_student_cannot_double_book_same_time` |
| Idempotência | mesma chave → mesma aula (200); mesma chave e outro horário → 409 | `test_booking_creates_meet_and_is_idempotent` |
| Cifragem | adulteração, outra conta, outra chave/versão e `state` expirado recusados | `tests/test_scheduling_units.py` |
| `SECURITY DEFINER` | `private.teacher_busy_ranges` só executável por `edusearch_api`; devolve só intervalos | `test_no_security_definer_callable_by_api_roles` |
| Perfis | visíveis: o próprio, professores publicados e a outra parte de uma aula | `test_profile_visibility_is_limited` |
| Aprovação | agenda/reserva não alteram aprovação/publicação | `test_teacher_profile_untouched_by_scheduling` |

Security Advisor (splinter fixado do CI) no banco migrado: **0 ERROR/WARN**.

## Expiração, revogação e reconexão

| Situação | Comportamento |
| --- | --- |
| Professor revoga em myaccount.google.com, troca a senha, ou o app OAuth está em **Testing** (refresh token expira em **7 dias**) | `invalid_grant` no refresh → credencial vira `revoked` (texto cifrado apagado), aula fica `failed`, o app mostra "Reconectar Google Agenda" |
| Calendar API responde 401/403 de permissão | Mesmo tratamento (reconexão) |
| Google fora do ar / 429 / 5xx | Aula mantida com `failed`; "Sincronizar agenda" tenta de novo |
| Professor clica em "Desconectar" | Revoga no Google (melhor esforço) e apaga a credencial |
| Chave de cifragem trocada (nova versão) | Credenciais da versão antiga ficam ilegíveis → `revoked` → reconectar |

Observação: com `include_granted_scopes=true`, revogar a concessão do app no Google também
pode retirar o consentimento do login com Google. O próximo login simplesmente pede o
consentimento de novo; nada quebra.

## Operação

Nada disto foi feito: depende de aprovação.

1. **Google Cloud (projeto do login):**
   - ativar a **Google Calendar API**;
   - na tela de consentimento OAuth, adicionar o escopo `.../auth/calendar.events.owned`
     (escopo **sensível**: em produção pública exige verificação do Google; em "Testing" vale só
     para os *test users*, com refresh token de 7 dias);
   - no cliente OAuth Web, cadastrar a URI de redirecionamento exata
     `https://app.edusearch.com.br/conta/agenda/google/retorno`.
2. **Migration** `supabase/migrations/20261121120000_scheduling_google_calendar.sql` no projeto
   remoto, com backup antes (rollback em `supabase/rollback/20261121_fase_3a_down.sql`).
3. **API (Vercel), segredos fora do Git:**
   - `API_GOOGLE_OAUTH_CLIENT_ID`, `API_GOOGLE_OAUTH_CLIENT_SECRET`;
   - `API_GOOGLE_OAUTH_REDIRECT_URI=https://app.edusearch.com.br/conta/agenda/google/retorno`;
   - `API_TOKEN_ENCRYPTION_KEY`, gerada com
     `python -c "from app.crypto import generate_key; print(generate_key())"`;
   - `API_TOKEN_ENCRYPTION_KEY_VERSION=1`;
   - `API_SCHEDULING_STAGE=testing` por último.
4. **App (Cloudflare Pages):** `VITE_STAGE_SCHEDULING=testing`.
5. **Professor de teste visível para alunos:** reservar exige professor **publicado**, que
   exige aprovação. Não existe painel administrativo. A aprovação de uma conta de **teste** é
   um passo manual, aprovado e registrado:
   ```sql
   update public.teacher_profiles
      set verification_status = 'approved', verified_at = now(),
          is_published = true, published_at = now()
    where user_id = '<uuid do professor de teste>';
   ```

## Testes

- `apps/api/tests/test_scheduling_units.py`: cifragem, `state`, regras de horário, cliente do
  Google (PKCE, escopo, 409, Meet pendente, revogação, 5xx).
- `apps/api/tests/db/test_scheduling_db.py`: fluxo completo com banco real e Google falso, RLS,
  conflitos, idempotência, revogação, queda do Google, cancelamento e regressão do professor.
- `apps/web/scripts/unit.test.mjs` ("agenda real"): janelas, fuso, agrupamento, retorno do Google
  e URL de consentimento.
- `apps/web/scripts/agenda.mjs` (navegador, CI): conexão e retorno sem código na URL, código
  enviado uma vez (StrictMode), recusa, disponibilidade, desconexão, reserva com clique duplo,
  409, cancelamento, axe, 320–1440 px em claro e escuro.

## Limitações conhecidas

- O app OAuth em **Testing** expira o refresh token em 7 dias: o professor precisará reconectar
  semanalmente até a verificação do Google.
- Sem free/busy do Google: só aulas do EduSearch bloqueiam horários (compromissos pessoais do
  professor não aparecem). Exigiria outro escopo (`calendar.freebusy`).
- Sem convites por e-mail (`sendUpdates=none`) e sem convidados no evento: o aluno acessa o
  link do Meet pelo app. Evita compartilhar o e-mail do aluno com o Google Agenda do professor.
- Visibilidade do Meet: o link fica no evento do professor; o acesso do aluno segue as regras de
  entrada do Google Meet (o organizador pode precisar admitir).
