# Credenciamento de professores (Trust Engine V1)

## Fonte de verdade e estados

O perfil público continua em `public.teacher_profiles`; o dossiê de credenciamento está em
`private.teacher_verifications`, separado deliberadamente para não expor dados sensíveis pela Data
API. Estados do dossiê:

| Estado | Significado | Quem leva até ele |
| --- | --- | --- |
| `draft` | dossiê em preenchimento | professor |
| `submitted` | na fila do Trust Engine | professor (envio) / Admin (reprocessar) |
| `pending_external` | requisitos que dependem de fonte externa não comprovados | Trust Engine |
| `changes_requested` | correção necessária (documento ausente/ inválido, termos desatualizados…) | Trust Engine / revisão humana |
| `under_review` | contestação aberta ou suspeita de fraude (auditoria excepcional) | professor (contestação) / Trust Engine |
| `approved` | todos os requisitos obrigatórios comprovados | **somente** Trust Engine |
| `rejected` | não aprovado após revisão humana | **somente** revisão humana |

O motor nunca rejeita sozinho; um humano nunca aprova. A aprovação manual não é etapa do fluxo.

## Arquitetura

```text
Professor ──► API (FastAPI) ──► Storage privado (upload pelo próprio titular)
                │  registro do documento: download com o token do titular, tipo pela assinatura
                │  binária, SHA-256, limite de 10 MiB, PDF sem criptografia/scripts/anexos
                ▼
     private.teacher_verifications ── submit ──► private.teacher_verification_jobs (fila)
                                                        ▲
Cloudflare Cron (edusearch-trust-cron, */5) ──► POST /v1/internal/trust/dispatch (segredo dedicado)
                                                        │
          VerificationDispatcher: claim com lease ─► contexto sem PII ─► validadores ─► decisão
                                                        │
          private.teacher_verification_record_decision: grava evidências e RECONFERE as regras
```

Componentes (`apps/api/app/trust/`): `RegistrationValidator`, `IdentityValidator`,
`DocumentValidator`, `AcademicValidator`, `CurriculumAnalyzer`, `FraudDetectionService`,
`VerificationDecisionEngine` e `VerificationDispatcher`. Cada evidência registra validador,
requisito, resultado (`passed`/`failed`/`unavailable`/`inconclusive`), origem
(`self_declared`/`file_analysis`/`internal_registry`/`digital_signature`/`external_registry`),
motivo e data.

## Regras versionadas (`trust-rules-2026.11-v1`)

Requisitos obrigatórios ficam em `private.trust_rule_requirements`, com as origens aceitas:

| Requisito | Origem aceita | Estado na V1 |
| --- | --- | --- |
| `registration.terms_current` | declaração | ativo |
| `registration.profile_complete` | declaração | ativo |
| `registration.adult` | declaração ou registro externo | ativo (declarado) |
| `document.identity_valid` | análise do arquivo | ativo |
| `document.academic_valid` | análise do arquivo | ativo |
| `identity.verified` | registro externo ou assinatura validada | **pendente: sem provedor** |
| `academic.issuer_verified` | registro externo ou assinatura validada | **pendente: sem provedor** |
| `fraud.no_duplicate_documents` | registro interno (hash) | ativo |

O banco recalcula esses requisitos a partir das evidências antes de aceitar `approved`
(`trust_approval_requirements_unmet`). Formato/declaração de CPF ou CNPJ é informativo e não comprova
identidade. Presença de assinatura em PDF é registrada (`academic.digital_signature`), mas a cadeia
ICP-Brasil **não** é validada na V1. Nenhum documento é enviado a provedores de IA.

**Consequência honesta:** sem um provedor externo homologado, nenhum professor é aprovado; os
dossiês completos ficam em `pending_external`. Integrar um provedor = implementar
`IdentityProvider`/`AcademicRegistry` em `app/trust/providers.py` e habilitá-lo por configuração.

## Decisão

1. Requisito obrigatório com falha de fraude (arquivo usado por outra conta) → `under_review`.
2. Outra falha obrigatória → `changes_requested` com os motivos.
3. Requisito obrigatório não comprovado (fonte indisponível, inspeção pendente) → `pending_external`.
4. Todos comprovados → `approved`, documentos aceitos pelo serviço (`reviewed_by_service`), perfil
   aprovado e publicado.

Decisões automáticas: `actor_kind='service'`, `service_name='trust_engine'`, versão de regras.
Decisões humanas: `actor_kind='human'`, administrador real e justificativa. Não existe usuário
fictício para o robô.

## Fila

Idempotência por submissão (`unique(teacher_id, submitted_at)`), lease de 5 min com
`FOR UPDATE SKIP LOCKED`, recuperação de jobs interrompidos após o lease, retry com backoff
exponencial (30 s–1 h), no máximo 10 tentativas (`failed` + `error_code`) e verificação de que a
submissão ainda é vigente (`submission_superseded`). O dispatcher respeita um orçamento de tempo
(`API_TRUST_DISPATCH_BUDGET_SECONDS`, padrão 8 s, abaixo do limite de 10 s da Vercel Hobby): jobs
não processados mantêm o lease e são retomados.

## Contestação e revisão humana

O professor contesta a decisão mais recente (`POST /v1/me/teacher-verification/contest`, 20–2000
caracteres; uma por decisão). O Admin (`teachers.reject`) resolve com `reprocess`,
`request_changes`, `reject` ou `uphold` — **não há "aprovar"**. Leitura do monitoramento exige
`teachers.read`; toda consulta de dossiê e resolução gera auditoria.

## Elegibilidade comercial

O gatilho `teacher_profiles_require_credential` impede `verification_status='approved'` ou
`is_published=true` sem credenciamento aprovado. Busca pública, disponibilidade, reservas e
cobranças exigem `is_published`; a ação "aprovar" do Admin (PR #36) devolve
`trust_credential_required` e só republica quem já foi aprovado pelo motor.

**Aprovados legados:** a migration registra em `private.teacher_credential_legacy_review` o estado
anterior e despublica professores aprovados sem credenciamento. Aulas, reservas e pagamentos
existentes não são alterados; o professor refaz o credenciamento. Reversão: os valores anteriores
estão na tabela. Aplicar em produção somente com aprovação operacional.

## Documentos e privacidade

Bucket privado `teacher-verification`; o titular só envia e lê objetos na pasta `<auth.uid()>/`
(sem update/delete). Tipos: PDF, PNG e JPEG; limite: 10 MiB. O endpoint e o Admin nunca retornam URL,
conteúdo, caminho de Storage, data de nascimento ou dígitos fiscais; o Admin vê só o prefixo do hash.
Sem `API_SUPABASE_PUBLISHABLE_KEY`, a inspeção fica pendente e o documento não satisfaz requisitos.

## Notificações (outbox Resend)

| Evento | Template | Variáveis |
| --- | --- | --- |
| `credential.received` | `edusearch-credenciamento-recebido-v1` | `NOME` |
| `credential.changes_requested` | `edusearch-credenciamento-correcao-v1` | `NOME`, `MOTIVO` |
| `credential.approved` | `edusearch-credenciamento-aprovado-v1` | `NOME` |
| `credential.rejected` | `edusearch-credenciamento-nao-aprovado-v1` | `NOME`, `MOTIVO` |
| `credential.contest_received` | `edusearch-credenciamento-contestacao-v1` | `NOME` |

`MOTIVO` é um código estável (ex.: `document.academic_proof_missing`); o template deve traduzi-lo.
Os templates precisam ser publicados no Resend antes de `API_NOTIFICATIONS_STAGE` sair de `off`. Os
testes apenas inspecionam a outbox; nenhum e-mail é enviado.

## Variáveis

| Variável | Onde | Valor |
| --- | --- | --- |
| `API_TRUST_DISPATCH_SECRET` | Vercel API (secret) | 32+ caracteres, exclusivo do Trust Engine |
| `TRUST_DISPATCH_SECRET` | Worker `edusearch-trust-cron` (secret) | mesmo valor acima |
| `API_TRUST_BATCH_SIZE` | Vercel API | `10` (1–25) |
| `API_TRUST_DISPATCH_BUDGET_SECONDS` | Vercel API | `8` (abaixo do maxDuration) |
| `API_TRUST_IDENTITY_PROVIDER` / `API_TRUST_ACADEMIC_REGISTRY` | Vercel API | `none` (único implementado) |
| `API_TEACHER_TERMS_VERSION` | Vercel API | `teacher-terms-2026-11` (igual ao app) |
| `API_SUPABASE_PUBLISHABLE_KEY` | Vercel API | chave publicável (não secreta) |

## Runbook

1. Validar as migrations em banco descartável (CI: lint, RLS, Security Advisor, testes de banco).
2. Aplicar no Supabase hospedado **somente com aprovação operacional** e backup verificável.
   Conferir `select count(*) from private.teacher_credential_legacy_review` antes de comunicar.
3. Configurar as variáveis acima na Vercel; gerar o segredo no gerenciador de senhas.
4. Publicar os templates no Resend (mantendo `API_NOTIFICATIONS_STAGE=off` até homologar).
5. `workers/trust-cron`: `npx wrangler secret put TRUST_DISPATCH_SECRET --config workers/trust-cron/wrangler.jsonc`
   e `npx wrangler deploy --config workers/trust-cron/wrangler.jsonc` (deploy autorizado à parte).
6. Monitorar `/admin` → Trust Engine: `failed_jobs`, falhas de validadores, contestações.
7. Rollback: pausar o cron (`wrangler triggers` / remover o Worker); a fila permanece segura em
   `pending`, e nenhum professor é aprovado sem o motor.
