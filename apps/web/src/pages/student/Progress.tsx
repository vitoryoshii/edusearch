import { Badge, BookIcon, Card, ClockIcon, ProgressBar, TargetIcon } from "@edusearch/ui";
import { AsyncContent } from "../../components/AsyncContent";
import { PageHeader, SectionTitle } from "../../components/PageHeader";
import { StatCard } from "../../components/StatCard";
import { subjectName } from "../../lib/catalog";
import { dataSource, isDemo } from "../../lib/data/source";
import { formatDateShort, formatMinutes } from "../../lib/format";
import { useAsync } from "../../lib/hooks/useAsync";

export default function Progress() {
  const progress = useAsync(() => dataSource.getStudentProgress(), []);

  return (
    <>
      <PageHeader
        title="Meu progresso"
        description="Suas metas e as anotações dos professores após cada aula."
        eyebrow={isDemo ? <Badge tone="demo">Dados de demonstração</Badge> : undefined}
      />
      <AsyncContent
        state={progress}
        reload={progress.reload}
        isEmpty={(d) => d.lessonsCompleted === 0 && d.goals.length === 0}
        empty={{ title: "Seu progresso aparecerá aqui", description: "Conclua sua primeira aula para começar a acompanhar." }}
      >
        {(p) => (
          <div className="space-y-8">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <StatCard icon={BookIcon} label="Aulas concluídas" value={p.lessonsCompleted} />
              <StatCard icon={ClockIcon} label="Tempo de estudo" value={formatMinutes(p.minutesStudied)} />
              <StatCard icon={TargetIcon} label="Metas ativas" value={p.goals.length} />
            </div>

            <section aria-labelledby="metas">
              <SectionTitle id="metas">Metas</SectionTitle>
              <Card className="space-y-5">
                {p.goals.map((g) => (
                  <div key={g.id}>
                    <ProgressBar label={g.title} value={g.done} max={g.total} />
                    <p className="mt-1 text-xs text-fg-muted">
                      {g.done} de {g.total} aulas planejadas
                    </p>
                  </div>
                ))}
              </Card>
            </section>

            <section aria-labelledby="anotacoes">
              <SectionTitle id="anotacoes">Anotações dos professores</SectionTitle>
              <Card padding="none">
                <ol className="divide-y divide-line">
                  {p.notes.map((n) => (
                    <li key={n.id} className="px-5 py-4 sm:px-6">
                      <p className="text-xs font-medium text-fg-muted">
                        <time dateTime={n.date}>{formatDateShort(n.date)}</time> · {subjectName(n.subject)} · {n.teacherName}
                      </p>
                      <p className="mt-1.5 text-sm leading-relaxed text-fg">{n.text}</p>
                    </li>
                  ))}
                </ol>
              </Card>
            </section>
          </div>
        )}
      </AsyncContent>
    </>
  );
}
