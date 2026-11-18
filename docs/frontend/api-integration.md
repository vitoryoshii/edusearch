# Integração com a API — necessidades do frontend

> **Status:** `docs/api-contract.md` **ainda não existe**. Este documento **não define contratos**. Ele lista o que as telas precisam para que a equipe de backend desenhe o contrato oficial. Quando o contrato existir, ele prevalece e o adapter `src/lib/data/http/adapter.ts` deve segui-lo.

## Arquitetura no frontend

```text
Telas ──▶ dataSource (interface DataSource, src/lib/data/source.ts)
              ├── mockDataSource  (padrão; dados fictícios em memória)
              └── httpDataSource  (API real; hoje só /health)
                       └── apiRequest() (src/lib/api/client.ts)
```

- As telas dependem apenas da interface `DataSource`, nunca de fixtures ou de `fetch`.
- `VITE_DATA_SOURCE=api` liga o adapter real. Métodos sem contrato lançam `ApiError("not_implemented")` e a tela mostra o estado de erro.
- `apiRequest` centraliza a URL base (`VITE_API_BASE_URL`), o timeout (15 s), o JSON, os erros no formato FastAPI (`{ "detail": ... }`) e um ponto de extensão para o token (`setAccessTokenProvider`).
- Segredos **nunca** vão para o frontend. Apenas variáveis `VITE_*` públicas.
- Os tipos em `src/lib/api/types.ts` são **modelos de tela**, não o contrato. Convenções adotadas: datas ISO 8601 e dinheiro em centavos (BRL).

## Já integrado

| Necessidade | Endpoint existente |
| ----------- | ------------------ |
| Verificar se a API está no ar | `GET /health` → `{ status, service, version }` |

## Necessidades por tela (a definir no contrato)

| # | Tela | Dados necessários | Método do `DataSource` |
| - | ---- | ----------------- | ---------------------- |
| 1 | Login / cadastro | **Fase 2.4:** o front obtém o ID token pelo Google Identity Services, cria a sessão com `signInWithIdToken` no Supabase Auth e envia o JWT **do Supabase** (nunca o ID token do Google) à API via `setAccessTokenProvider`. A API deve validar o JWT (JWKS) e obter o papel do banco — ver [auth-integration.md](auth-integration.md). | `setAccessTokenProvider` |
| 2 | Escolha de perfil | Registrar papel aluno/professor do usuário autenticado (hoje só preferência local em `/conta`); sugestão: `GET /me`, `PUT /me/profile` | — (novo) |
| 3 | Busca | Listar professores com filtros: texto, disciplina, nível, metodologia, período, valor máximo. Paginação. | `searchTeachers` |
| 4 | Catálogo | Lista oficial de disciplinas, níveis e metodologias | `listSubjects` |
| 5 | Perfil do professor | Dados públicos do professor | `getTeacher` |
| 6 | Horários | Horários livres de um professor em um intervalo de datas, com fuso | `listTeacherSlots` |
| 7 | Matching (Gemini) | Enviar objetivo, disciplina, nível, **dificuldades**, preferências e orçamento. Receber professores ordenados, pontuação, **motivos legíveis** e **pontos de atenção** (`reasons[]`, `cautions[]`). Definir tempo máximo de resposta e o comportamento em caso de falha da IA. | `matchTeachers` |
| 8 | Agendamento | Criar aula para um horário. Tratar conflito (horário ocupado ou aula sobreposta do aluno, **409**; regras em [demo-journey.md](demo-journey.md)). Retornar a aula criada e o status do pagamento. | `createBooking` |
| 9 | Pagamento Pix | QR Code / copia-e-cola, expiração e status (AbacatePay). Definir se o agendamento só é confirmado após o pagamento. | — (novo) |
| 10 | Minhas aulas | Aulas do aluno e do professor, com status e `meetingUrl` (Google Meet) | `listStudentLessons`, `listTeacherLessons` |
| 11 | Cancelamento | Cancelar a aula, com política de prazo e reembolso | `cancelLesson` |
| 12 | Progresso | Metas, aulas concluídas, minutos estudados e anotações dos professores | `getStudentProgress` |
| 13 | Dashboard do professor | Agregados: aulas na semana, próxima aula, valor previsto, checklist do perfil | `getTeacherDashboard` |
| 14 | Perfil profissional | Ler e salvar perfil, valor por aula e duração | `getTeacherProfile`, `saveTeacherProfile` |
| 15 | Especialidades | Ler e salvar disciplinas × níveis | `listSpecialties`, `saveSpecialties` |
| 16 | Disponibilidade | Ler e salvar a grade semanal; sincronizar com o Google Calendar | `getAvailability`, `saveAvailability` |
| 17 | Recebimentos | Bruto, comissão, líquido e situação do repasse por aula (split AbacatePay) | `getEarnings` |

## Pontos a alinhar com o backend

- Formato de erro padrão: códigos e mensagens em português para exibir ao usuário.
- Paginação: cursor ou página/limite.
- Fuso horário: armazenar em UTC e exibir no fuso do navegador (o front já faz isso).
- Moeda: centavos inteiros.
- CORS: incluir as origens de produção do app.
- Rotas autenticadas: `Authorization: Bearer <jwt do Supabase>`. O front já tem o ponto de injeção.

## Fase 2.3 — Agenda, Meet, pagamentos e incentivos (necessidades, sem contrato definido)

Os métodos abaixo já existem na interface `DataSource`. No adapter HTTP eles lançam `not_implemented` até existir o contrato oficial. Comportamento esperado e regras de demonstração: [calendar-meet-payments.md](calendar-meet-payments.md).

| # | Necessidade | Método do `DataSource` | Observações para o contrato |
| - | ----------- | ---------------------- | --------------------------- |
| 18 | Detalhe de uma aula (aluno ou professor) | `getLesson` | Autorização pelo JWT: o aluno vê as próprias aulas, o professor as dele |
| 19 | Reserva nasce aguardando pagamento | `createBooking` | Status `pending_payment`; o horário fica reservado enquanto houver cobrança válida |
| 20 | Criar cobrança Pix | `createCheckout` | **Idempotente**. Devolve `expiresAt`, `pix.qrCodeImageUrl` e `pix.copyPasteCode` vindos da AbacatePay. A chave do gateway fica só no backend |
| 21 | Consultar cobrança | `getCheckout` | Status atualizado por webhook no backend; o front consulta a cada 3 s com a cobrança aberta (ou via push no futuro) |
| 22 | Expiração e cancelamento | `getCheckout`, `cancelLesson` | Expirar ou cancelar libera o horário. Pagamento confirmado + cancelamento exige política de reembolso |
| 23 | Recebimentos | `getEarnings` | Comissão em basis points; valores em centavos; `gatewayFeeCents` **separado** (null enquanto desconhecido); status financeiro sem "repassado" até existir repasse |
| 24 | Comissão e incentivos | `getCommissionProgram` | Comissão padrão e atual calculadas no backend; metas verificáveis; benefícios só com regras aprovadas |
| 25 | Indicações | `getReferralProgram` | Código e link gerados no backend; validação de qualificação, **bloqueio de autoindicação**, antifraude, estornos e elegibilidade |
| 26 | Bloqueios de agenda | `listBlockedDates`, `setDateBlocked` | Datas locais `YYYY-MM-DD` com fuso do professor; aulas já marcadas não são removidas |
| 27 | Google Agenda | `getCalendarConnection`, `syncLessonToCalendar` | OAuth e criação de eventos no backend; o front só exibe o estado (`not_synced`, `pending`, `synced`, `failed`) |
| 28 | Google Meet | (campo `meeting` da aula) | `joinUrl` criado pelo backend (Google Meet API). O front só exibe `https://meet.google.com/xxx-xxxx-xxx` |

**Somente demonstração (não existem na API):** `simulatePayment`, `setCalendarConnection` e `resetDemoData`. O frontend esconde as ações correspondentes quando o adapter não os oferece.
