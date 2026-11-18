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
| 1 | Login / cadastro | Sessão via Supabase Auth (Google). O front precisa obter o JWT e enviá-lo à API. Definir se o front fala direto com o Supabase Auth ou via API. | `setAccessTokenProvider` |
| 2 | Escolha de perfil | Registrar papel aluno/professor do usuário autenticado | — (novo) |
| 3 | Busca | Listar professores com filtros: texto, disciplina, nível, metodologia, período, valor máximo. Paginação. | `searchTeachers` |
| 4 | Catálogo | Lista oficial de disciplinas, níveis e metodologias | `listSubjects` |
| 5 | Perfil do professor | Dados públicos do professor | `getTeacher` |
| 6 | Horários | Horários livres de um professor em um intervalo de datas, com fuso | `listTeacherSlots` |
| 7 | Matching (Gemini) | Enviar objetivo, disciplina, nível, preferências e orçamento. Receber professores ordenados, pontuação e **motivos legíveis**. Definir tempo máximo de resposta e o comportamento em caso de falha da IA. | `matchTeachers` |
| 8 | Agendamento | Criar aula para um horário. Tratar conflito (horário ocupado, **409**). Retornar a aula criada e o status do pagamento. | `createBooking` |
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
