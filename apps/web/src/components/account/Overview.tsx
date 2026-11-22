import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import {
  ArrowRightIcon,
  Badge,
  Button,
  CalendarIcon,
  Card,
  CheckCircleIcon,
  ClockIcon,
  ExternalIcon,
  GraduationIcon,
  Input,
  SearchIcon,
  Skeleton,
  VideoIcon,
  buttonClasses,
} from "@edusearch/ui";
import { isUpcoming, useSubjectNames } from "../marketplace/LessonList";
import { accountApi, type Me } from "../../lib/api/account";
import { schedulingApi, type Lesson } from "../../lib/api/scheduling";
import { useAsync } from "../../lib/hooks/useAsync";
import { isTrustedMeetUrl } from "../../lib/meeting";
import { lessonWhen, timeOf } from "../../lib/scheduling";
import { DateBlock } from "./DateBlock";

/* ------------------------------- Próxima aula ------------------------------- */

/** Destaque da próxima aula (aluno ou professor), com o link do Meet quando houver. */
export function NextLessonCard({ lessons, role }: { lessons: Lesson[] | undefined; role: "student" | "teacher" }) {
  const subjectName = useSubjectNames();
  if (lessons === undefined) return <Skeleton className="h-36 w-full rounded-card" />;
  const upcoming = lessons.filter((l) => isUpcoming(l)).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const next = upcoming[0];
  if (!next) {
    return (
      <Card className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between" data-testid="next-lesson" data-state="empty">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control bg-surface-muted text-fg-muted">
            <CalendarIcon className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-semibold text-fg-strong">Nenhuma aula agendada</h2>
            <p className="mt-1 text-sm text-fg-muted">
              {role === "student" ? "Escolha um professor e reserve um horário livre." : "Quando um aluno reservar, a aula aparece aqui com o link do Meet."}
            </p>
          </div>
        </div>
        <Link to={role === "student" ? "/conta/explorar" : "/conta/agenda"} className={buttonClasses({ variant: role === "student" ? "primary" : "secondary", className: "shrink-0" })}>
          {role === "student" ? "Explorar professores" : "Revisar disponibilidade"}
          <ArrowRightIcon className="h-4 w-4" />
        </Link>
      </Card>
    );
  }
  const other = next.role === "teacher" ? next.student : next.teacher;
  const meet = isTrustedMeetUrl(next.meet_url) ? next.meet_url : null;
  return (
    <Card padding="lg" className="relative overflow-hidden" data-testid="next-lesson" data-state="scheduled">
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-link" />
      <p className="text-xs font-semibold tracking-wide text-link uppercase">Próxima aula</p>
      <div className="mt-3 flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <DateBlock iso={next.starts_at} />
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-fg-strong">{subjectName(next.subject)}</h2>
            <p className="mt-0.5 text-sm text-fg first-letter:uppercase">{lessonWhen(next.starts_at, next.ends_at)}</p>
            <p className="text-sm text-fg-muted">
              {next.role === "teacher" ? "Aluno" : "Professor"}: {other.display_name ?? "—"}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {meet ? (
            <a href={meet} target="_blank" rel="noopener noreferrer" className={buttonClasses({})}>
              <VideoIcon className="h-4 w-4" /> Entrar no Meet
              <ExternalIcon className="h-3.5 w-3.5" />
              <span className="sr-only"> (abre em nova aba)</span>
            </a>
          ) : (
            <span className="text-sm text-fg-muted">O link do Meet aparece após a sincronização da agenda.</span>
          )}
          <Link to="/conta/aulas" className={buttonClasses({ variant: "ghost" })}>
            Todas as aulas
          </Link>
        </div>
      </div>
      {upcoming.length > 1 && (
        <p className="mt-4 border-t border-line pt-3 text-sm text-fg-muted">
          Depois: {subjectName(upcoming[1]!.subject)}, <span className="first-letter:lowercase">{lessonWhen(upcoming[1]!.starts_at, upcoming[1]!.ends_at)}</span>
          {upcoming.length > 2 ? ` e mais ${upcoming.length - 2}` : ""}.
        </p>
      )}
    </Card>
  );
}

/* ------------------------------- Aluno ------------------------------- */

/** Atalhos do aluno: busca e as disciplinas do PRÓPRIO cadastro (nada inventado). */
export function StudentShortcuts() {
  const navigate = useNavigate();
  const subjectName = useSubjectNames();
  const profile = useAsync(() => accountApi.getStudentProfile().catch(() => null), []);
  const [q, setQ] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    navigate(term ? `/conta/explorar?q=${encodeURIComponent(term.slice(0, 60))}` : "/conta/explorar");
  };
  const mine = profile.data?.subjects ?? [];
  return (
    <Card data-testid="student-shortcuts">
      <h2 className="font-semibold text-fg-strong">Encontre um professor</h2>
      <form role="search" onSubmit={submit} className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
        <Input label="Nome ou disciplina" hideLabel placeholder="Nome ou disciplina" value={q} maxLength={60} onChange={(e) => setQ(e.target.value)} leftIcon={<SearchIcon className="h-4 w-4" />} className="min-w-0 flex-1" />
        <Button type="submit" variant="secondary" className="shrink-0">
          Buscar
        </Button>
      </form>
      {mine.length > 0 && (
        <div className="mt-4">
          <p className="text-sm text-fg-muted">Suas disciplinas</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {mine.map((s) => (
              <li key={s}>
                <Link to={`/conta/explorar?materia=${encodeURIComponent(s)}`} className={buttonClasses({ variant: "secondary", size: "sm", shape: "pill" })}>
                  {subjectName(s)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

/* ------------------------------- Professor ------------------------------- */

const CALENDAR_TEXT = { connected: "Conectada", revoked: "Reconectar", not_connected: "Não conectada", not_configured: "Indisponível" } as const;

/** Indicador compacto: 2 por linha no celular (ícone só a partir de sm). */
function Stat({ label, value, icon: Icon }: { label: string; value: string; icon: typeof CalendarIcon }) {
  return (
    // dt/dd filhos diretos do item (exigência de <dl>); o ícone ocupa as duas linhas a partir de sm.
    <div className="grid min-w-0 grid-cols-1 gap-x-3 rounded-card border border-line bg-surface p-3.5 shadow-card sm:grid-cols-[auto_minmax(0,1fr)] sm:p-4">
      <span aria-hidden="true" className="row-span-2 hidden h-9 w-9 items-center justify-center self-start rounded-control bg-primary-soft text-link sm:flex">
        <Icon className="h-4.5 w-4.5" />
      </span>
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="mt-0.5 font-semibold break-words text-fg-strong tabular-nums">{value}</dd>
    </div>
  );
}

/** Painel do professor: indicadores reais e o que falta para receber reservas. */
export function TeacherOverview({ me, lessons }: { me: Me; lessons: Lesson[] | undefined }) {
  const calendar = useAsync(() => schedulingApi.calendar(), []);
  const availability = useAsync(() => schedulingApi.availability(), []);
  const teacher = me.onboarding.teacher;
  const published = Boolean(teacher?.is_published);
  const upcoming = lessons?.filter((l) => l.role === "teacher" && isUpcoming(l)) ?? [];
  const windows = availability.data?.windows.length;
  const connected = calendar.data?.status === "connected";
  const steps = [
    { done: teacher?.status === "completed", label: "Cadastro profissional salvo", to: "/conta/cadastro/professor" },
    { done: published, label: "Perfil aprovado e publicado", to: "/conta/perfil-profissional", note: published ? undefined : "A aprovação é feita pela equipe EduSearch." },
    { done: connected, label: "Google Agenda conectada (links do Meet)", to: "/conta/agenda" },
    { done: (windows ?? 0) > 0, label: "Disponibilidade semanal definida", to: "/conta/agenda" },
  ];
  const pending = steps.filter((s) => !s.done);

  return (
    <div className="space-y-6" data-testid="teacher-overview">
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="teacher-stats">
        <Stat label="Próximas aulas" value={lessons ? String(upcoming.length) : "—"} icon={CalendarIcon} />
        <Stat label="Google Agenda" value={calendar.data ? CALENDAR_TEXT[calendar.data.status] : "—"} icon={VideoIcon} />
        <Stat label="Disponibilidade" value={windows === undefined ? "—" : `${windows} ${windows === 1 ? "janela" : "janelas"}/sem.`} icon={ClockIcon} />
        <Stat label="Perfil" value={published ? "Publicado" : "Em análise"} icon={GraduationIcon} />
      </dl>
      {pending.length > 0 && (
        <Card data-testid="teacher-checklist">
          <h2 className="font-semibold text-fg-strong">Para receber reservas</h2>
          <ol className="mt-3 space-y-2">
            {steps.map((s) => (
              <li key={s.label} className="flex items-start gap-3 text-sm">
                {s.done ? (
                  <CheckCircleIcon className="mt-0.5 h-5 w-5 shrink-0 text-success-text" />
                ) : (
                  <span aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 border-line-strong" />
                )}
                <span className="min-w-0">
                  <span className="sr-only">{s.done ? "Concluído: " : "Pendente: "}</span>
                  {s.done ? (
                    <span className="text-fg-muted">{s.label}</span>
                  ) : (
                    <Link to={s.to} className="font-medium text-link underline-offset-4 hover:underline">
                      {s.label}
                    </Link>
                  )}
                  {s.note && !s.done && <span className="block text-xs text-fg-muted">{s.note}</span>}
                </span>
              </li>
            ))}
          </ol>
        </Card>
      )}
      {upcoming.length > 1 && (
        <Card>
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold text-fg-strong">Agenda dos próximos dias</h2>
            <Link to="/conta/aulas" className="text-sm font-semibold text-link underline-offset-4 hover:underline">
              Ver todas
            </Link>
          </div>
          <ul className="mt-3 divide-y divide-line">
            {upcoming.slice(0, 4).map((l) => (
              <li key={l.id} className="flex items-center gap-3 py-3">
                <DateBlock iso={l.starts_at} tone="muted" />
                <div className="min-w-0 text-sm">
                  <p className="font-medium text-fg-strong">
                    {timeOf(l.starts_at)}–{timeOf(l.ends_at)} · {l.student.display_name ?? "Aluno"}
                  </p>
                  <Badge tone={l.calendar_sync_status === "synced" ? "success" : "neutral"}>{l.calendar_sync_status === "synced" ? "Com Meet" : "Sem Meet"}</Badge>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
