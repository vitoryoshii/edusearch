import { useMemo } from "react";
import { Link, useLocation } from "react-router";
import { AlertIcon, Badge, Card, CheckIcon, EmptyState, SparkleIcon, buttonClasses } from "@edusearch/ui";
import { AsyncContent } from "../../components/AsyncContent";
import { DemoNotice } from "../../components/DemoNotice";
import { PageHeader } from "../../components/PageHeader";
import { TeacherCard } from "../../components/TeacherCard";
import type { MatchRequest } from "../../lib/api/types";
import { subjectName } from "../../lib/catalog";
import { MATCH_WEIGHTS } from "../../lib/data/mock/adapter";
import { dataSource, isDemo } from "../../lib/data/source";
import { useAsync } from "../../lib/hooks/useAsync";
import { MATCH_REQUEST_KEY } from "./Matching";

function readRequest(state: unknown): MatchRequest | null {
  // Pedidos salvos antes do campo "dificuldades" continuam válidos.
  const normalize = (r: MatchRequest): MatchRequest => ({ ...r, difficulties: r.difficulties ?? [] });
  const fromState = (state as { request?: MatchRequest } | null)?.request;
  if (fromState) return normalize(fromState);
  try {
    const raw = sessionStorage.getItem(MATCH_REQUEST_KEY);
    return raw ? normalize(JSON.parse(raw) as MatchRequest) : null;
  } catch {
    return null;
  }
}

export default function Recommendations() {
  const location = useLocation();
  const request = useMemo(() => readRequest(location.state), [location.state]);
  const result = useAsync(() => (request ? dataSource.matchTeachers(request) : Promise.resolve([])), [request]);

  if (!request) {
    return (
      <>
        <PageHeader title="Professores recomendados" />
        <EmptyState
          icon={<SparkleIcon />}
          title="Ainda não há recomendações"
          description="Responda a três perguntas rápidas no assistente para receber sugestões."
          action={
            <Link to="/aluno/assistente" className={buttonClasses({ size: "sm" })}>
              Abrir assistente
            </Link>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        back={{ to: "/aluno/assistente", label: "Refazer busca" }}
        title="Professores recomendados"
        description={`Para: “${request.goal}”`}
        eyebrow={<Badge tone="primary">{subjectName(request.subject)}</Badge>}
      />

      {isDemo && (
        <Card tone="muted" padding="sm" className="mb-6 sm:px-5">
          <DemoNotice className="bg-transparent p-0">
            Recomendação de demonstração, calculada por regras simples no seu navegador. Não é uma análise de IA (Gemini).
          </DemoNotice>
          <details className="group mt-3 text-sm">
            <summary className="inline-flex min-h-9 cursor-pointer items-center font-medium text-link marker:content-none hover:underline">
              Como a compatibilidade é calculada
            </summary>
            <ul className="mt-2 grid gap-1 text-fg sm:grid-cols-2">
              <li>Disciplina (obrigatória): {MATCH_WEIGHTS.subject} pontos</li>
              <li>Nível de ensino: {MATCH_WEIGHTS.level} pontos</li>
              <li>Metodologia preferida: {MATCH_WEIGHTS.methodology} pontos</li>
              <li>Ajuda nas suas dificuldades: {MATCH_WEIGHTS.difficulties} pontos</li>
              <li>Horários compatíveis: {MATCH_WEIGHTS.periods} pontos</li>
              <li>Dentro do orçamento: {MATCH_WEIGHTS.budget} pontos</li>
            </ul>
            <p className="mt-2 text-fg-muted">Critérios sem preferência informada contam como compatíveis.</p>
          </details>
        </Card>
      )}

      <AsyncContent
        state={result}
        reload={result.reload}
        loadingLabel="Buscando professores compatíveis…"
        isEmpty={(d) => d.length === 0}
        empty={{
          title: "Nenhum professor compatível por enquanto",
          description: "Tente outra disciplina ou ajuste suas preferências de horário e orçamento.",
          action: (
            <Link to="/aluno/buscar" className={buttonClasses({ variant: "secondary", size: "sm" })}>
              Buscar manualmente
            </Link>
          ),
        }}
      >
        {(data) => (
          <ol className="grid gap-4">
            {data.map((m, i) => (
              <li key={m.teacher.id}>
                <TeacherCard
                  teacher={m.teacher}
                  footer={
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-sm font-medium text-fg-strong">
                          {i === 0 ? "Melhor combinação · " : ""}
                          Compatibilidade estimada: <span className="tabular-nums">{m.score}%</span>
                        </p>
                        <ul className="mt-2 space-y-1">
                          {m.reasons.map((r) => (
                            <li key={r} className="flex items-start gap-2 text-sm text-fg">
                              <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-success-text" />
                              {r}
                            </li>
                          ))}
                        </ul>
                        {m.cautions.length > 0 && (
                          <ul className="mt-2 space-y-1">
                            {m.cautions.map((c) => (
                              <li key={c} className="flex items-start gap-2 text-sm text-warning-text">
                                <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
                                {c}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <Link
                        to={`/aluno/professores/${m.teacher.id}/agendar`}
                        className={buttonClasses({ size: "sm", className: "sm:shrink-0" })}
                      >
                        Ver horários
                      </Link>
                    </div>
                  }
                />
              </li>
            ))}
          </ol>
        )}
      </AsyncContent>
    </>
  );
}
