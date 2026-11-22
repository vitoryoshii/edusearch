# Cache de consultas da conta real (Fase 4B)

O produto real (`/conta`) usa **TanStack Query v5** com um `QueryClient` único
(`apps/web/src/lib/query/client.ts`). A demonstração (`/aluno`, `/professor`) não usa este cache:
continua com dados fictícios isolados.

## Regras

| Regra | Onde |
| --- | --- |
| Só memória: sem persister, localStorage, IndexedDB ou Service Worker | `lib/query/client.ts` |
| Toda chave privada começa com `["edusearch", "user", <id da conta>]` | `lib/query/keys.ts` |
| Logout/troca de conta remove da memória o que não é da conta atual | `app/account.tsx` (`isForeignPrivateKey`) |
| Sem retry para 401/403/404/409/422; até 2 retries para rede/5xx/408/429; mutações nunca repetem | `lib/query/policy.ts` |
| 401 em `/v1/me` sempre bloqueia ("Sua sessão expirou"), mesmo com dados em cache | `app/account.tsx` |
| Com dados em cache: conteúdo na hora, "Atualizando…" discreto; falha mantém os dados com aviso | `components/QueryContent.tsx` |

O Service Worker (`public/sw.js`) continua sem guardar nada da API (outra origem, `Authorization`,
`no-store`). A API responde `Cache-Control: no-store` em `/v1/*`.

## Validade por recurso (`STALE_MS`)

| Recurso | Validade | Observação |
| --- | --- | --- |
| Disciplinas (público) | 30 min | catálogo oficial |
| Conta (`/v1/me`) | 60 s | |
| Minhas aulas | 30 s | |
| Catálogo de professores | 60 s | "próximo horário" |
| Perfil público | 5 min | |
| **Horários livres** | **15 s** + revalida ao abrir | o servidor garante (409 + EXCLUDE), não o cache |
| Google Agenda | 60 s | |
| Disponibilidade | 5 min | |

## Invalidação após escrita

| Ação | Cache atualizado com a resposta | Revalidado |
| --- | --- | --- |
| Reservar aula | aula entra em Minhas aulas | aulas, horários do professor, catálogo |
| Reserva recusada (409) | — | horários do professor, catálogo, aulas |
| Cancelar aula | aula marcada como cancelada | aulas, horários do professor, catálogo |
| Sincronizar agenda | aula | conexão do Google |
| Salvar disponibilidade | disponibilidade | horários |
| Conectar/desconectar Google | conexão | — |
| Salvar nome/foto | conta (`/v1/me`) | — |
| Salvar cadastro de aluno/professor | conta | perfil do aluno / perfil público e catálogo |

## Testes

- `scripts/unit.test.mjs` ("cache de consultas"): retries, validade, chaves por conta.
- `scripts/agenda.mjs` (seção "Cache"):
  - deduplicação e navegação repetida sem GET nem carregamento bloqueante;
  - rede lenta, falha de revalidação e "Tentar novamente";
  - invalidação após cancelar;
  - horário tomado em cache → 409 → lista corrigida;
  - troca de conta sem recarregar, sem vazar dados.
