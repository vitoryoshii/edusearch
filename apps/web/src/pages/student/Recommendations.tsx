import { useMemo } from "react";
import { Link, useLocation } from "react-router";
import { Badge, CheckIcon, EmptyState, SparkleIcon, buttonClasses } from "@edusearch/ui";
import { AsyncContent } from "../../components/AsyncContent";
import { DemoNotice } from "../../components/DemoNotice";
import { PageHeader } from "../../components/PageHeader";
import { TeacherCard } from "../../components/TeacherCard";
import type { MatchRequest } from "../../lib/api/types";
import { subjectName } from "../../lib/catalog";
import { dataSource, isDemo } from "../../lib/data/source";
import { useAsync } from "../../lib/hooks/useAsync";
import { MATCH_REQUEST_KEY } from "./Matching";

function readRequest(state: unknown): MatchRequest | null {
  const fromState = (state as { request?: MatchRequest } | null)?.request;
  if (fromState) return fromState;
  try {
    const raw = sessionStorage.getItem(MATCH_REQUEST_KEY);
    return raw ? (JSON.parse(raw) as MatchRequest) : null;
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
        <DemoNotice className="mb-6">
          Recomendação simulada com dados fictícios. A compatibilidade é uma estimativa ilustrativa, sem uso de IA.
        </DemoNotice>
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
