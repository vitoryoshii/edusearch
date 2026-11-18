import { Link } from "react-router";
import {
  CalendarIcon,
  Card,
  CheckCircleIcon,
  ChevronRightIcon,
  ClockIcon,
  EmptyState,
  ProgressBar,
  WalletIcon,
  cn,
} from "@edusearch/ui";
import { useSession } from "../../app/session";
import { AsyncContent } from "../../components/AsyncContent";
import { LessonCard } from "../../components/LessonCard";
import { SectionTitle } from "../../components/PageHeader";
import { StatCard } from "../../components/StatCard";
import { STANDARD_COMMISSION_BPS, formatBps } from "../../lib/commission";
import { dataSource } from "../../lib/data/source";
import { formatDateShort, formatMoney, formatTime } from "../../lib/format";
import { useAsync } from "../../lib/hooks/useAsync";

const CHECKLIST_LINKS = {
  profile: "/professor/perfil",
  specialties: "/professor/especialidades",
  availability: "/professor/disponibilidade",
} as const;

export default function TeacherDashboard() {
  const { session } = useSession();
  const data = useAsync(() => Promise.all([dataSource.getTeacherDashboard(), dataSource.listTeacherLessons()]), []);

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-fg-strong sm:text-3xl">Olá, {session?.name ?? "professor"}</h1>
        <p className="mt-1 text-fg-muted">Um resumo das suas aulas e do seu perfil.</p>
      </header>

      <AsyncContent state={data} reload={data.reload}>
        {([dash, lessons]) => {
          const doneCount = dash.profileChecklist.filter((c) => c.done).length;
          const upcoming = lessons
            .filter((l) => l.status === "scheduled" && new Date(l.end) > new Date())
            .sort((a, b) => a.start.localeCompare(b.start))
            .slice(0, 3);
          return (
            <div className="space-y-10">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <StatCard icon={CalendarIcon} label="Aulas nos próximos 7 dias" value={dash.lessonsThisWeek} />
                <StatCard
                  icon={ClockIcon}
                  label="Próxima aula"
                  value={dash.nextLesson ? formatTime(dash.nextLesson.start) : "—"}
                  hint={dash.nextLesson ? formatDateShort(dash.nextLesson.start) : "Nenhuma agendada"}
                />
                <StatCard
                  icon={WalletIcon}
                  label="Saldo estimado"
                  value={formatMoney(dash.estimatedBalanceCents)}
                  hint={
                    dash.awaitingPaymentCents > 0
                      ? `Pagamentos confirmados, após ${formatBps(STANDARD_COMMISSION_BPS)} de comissão · ${formatMoney(dash.awaitingPaymentCents)} aguardando`
                      : `Pagamentos confirmados, após ${formatBps(STANDARD_COMMISSION_BPS)} de comissão`
                  }
                />
              </div>

              <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_20rem]">
                <section aria-labelledby="proximas-aulas">
                  <SectionTitle
                    id="proximas-aulas"
                    action={
                      <Link to="/professor/agenda" className="text-sm font-medium text-link hover:underline">
                        Ver agenda
                      </Link>
                    }
                  >
                    Próximas aulas
                  </SectionTitle>
                  {upcoming.length ? (
                    <ul className="grid gap-3">
                      {upcoming.map((l, i) => (
                        <li key={l.id}>
                          <LessonCard lesson={l} perspective="teacher" highlight={i === 0} />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <EmptyState
                      title="Nenhuma aula agendada"
                      description="Mantenha sua disponibilidade atualizada para receber agendamentos."
                    />
                  )}
                </section>

                <section aria-labelledby="perfil-completo">
                  <SectionTitle id="perfil-completo">Seu perfil</SectionTitle>
                  <Card>
                    <ProgressBar
                      label="Perfil completo"
                      value={doneCount}
                      max={dash.profileChecklist.length}
                      tone={doneCount === dash.profileChecklist.length ? "success" : "primary"}
                    />
                    <ul className="mt-4 -mx-2">
                      {dash.profileChecklist.map((c) => (
                        <li key={c.id}>
                          <Link
                            to={CHECKLIST_LINKS[c.id]}
                            className="flex min-h-11 items-center gap-3 rounded-control px-2 text-sm hover:bg-surface-muted"
                          >
                            <CheckCircleIcon className={cn("h-5 w-5 shrink-0", c.done ? "text-success-text" : "text-fg-muted")} />
                            <span className="flex-1 text-fg-strong">{c.label}</span>
                            <span className="sr-only">{c.done ? "(concluído)" : "(pendente)"}</span>
                            <ChevronRightIcon className="h-4 w-4 text-fg-muted" />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </Card>
                </section>
              </div>
            </div>
          );
        }}
      </AsyncContent>
    </div>
  );
}
