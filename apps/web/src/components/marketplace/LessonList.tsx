import { useMemo, useState, type ReactNode } from "react";
import { Badge, Button, CalendarIcon, ExternalIcon, RefreshIcon, VideoIcon, buttonClasses, useToast } from "@edusearch/ui";
import { QueryContent, RefreshButton } from "../QueryContent";
import { describeError } from "../../lib/api/client";
import type { Lesson } from "../../lib/api/scheduling";
import { useCancelLessonMutation, useLessonsQuery, useResyncLessonMutation, useSubjectsQuery } from "../../lib/query/hooks";
import { isTrustedMeetUrl } from "../../lib/meeting";
import { lessonWhen } from "../../lib/scheduling";
import { DateBlock } from "../account/DateBlock";

/** Nome oficial da disciplina (GET /v1/subjects, em cache compartilhado), com o slug como reserva. */
export function useSubjectNames() {
  const subjects = useSubjectsQuery();
  return useMemo(() => {
    const map = new Map((subjects.data ?? []).map((s) => [s.slug, s.name] as const));
    return (slug: string) => map.get(slug) ?? slug;
  }, [subjects.data]);
}

const SYNC_LABEL: Record<Lesson["calendar_sync_status"], string> = {
  synced: "Na Google Agenda",
  pending: "Sincronizando",
  failed: "Falha na agenda",
  not_connected: "Sem Google Agenda",
  removed: "Removida da agenda",
};

export const isUpcoming = (l: Lesson, now = Date.now()) => l.status === "scheduled" && new Date(l.ends_at).getTime() > now;

/** Aulas reais da conta (aluno e/ou professor), separadas em próximas e anteriores. */
export function LessonList({ emptyAction }: { emptyAction?: ReactNode }) {
  const lessons = useLessonsQuery();
  const subjectName = useSubjectNames();
  return (
    <>
    <div className="-mt-2 mb-2 flex justify-end">
      <RefreshButton query={lessons} />
    </div>
    <QueryContent
      query={lessons}
      loading="spinner"
      loadingLabel="Carregando aulas…"
      isEmpty={(d) => d.length === 0}
      empty={{ title: "Nenhuma aula ainda", description: "As aulas reservadas aparecem aqui.", icon: <CalendarIcon className="h-6 w-6" />, action: emptyAction }}
    >
      {(data) => {
        const upcoming = data.filter((l) => isUpcoming(l)).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
        const past = data.filter((l) => !isUpcoming(l));
        return (
          <div className="space-y-8" data-testid="lesson-list">
            <section aria-labelledby="aulas-proximas">
              <h2 id="aulas-proximas" className="text-base font-semibold text-fg-strong">
                Próximas <span className="font-normal text-fg-muted">({upcoming.length})</span>
              </h2>
              {upcoming.length ? (
                <ul className="mt-3 divide-y divide-line">
                  {upcoming.map((l) => (
                    <LessonRow key={l.id} lesson={l} subjectName={subjectName} />
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-fg-muted">Nenhuma aula agendada.</p>
              )}
            </section>
            {past.length > 0 && (
              <section aria-labelledby="aulas-anteriores">
                <h2 id="aulas-anteriores" className="text-base font-semibold text-fg-strong">
                  Anteriores e canceladas <span className="font-normal text-fg-muted">({past.length})</span>
                </h2>
                <ul className="mt-3 divide-y divide-line">
                  {past.map((l) => (
                    <LessonRow key={l.id} lesson={l} subjectName={subjectName} />
                  ))}
                </ul>
              </section>
            )}
          </div>
        );
      }}
    </QueryContent>
    </>
  );
}

export function LessonRow({ lesson, subjectName }: { lesson: Lesson; subjectName: (slug: string) => string }) {
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const other = lesson.role === "teacher" ? lesson.student : lesson.teacher;
  const upcoming = isUpcoming(lesson);
  const fail = (e: unknown) => toast({ tone: "error", title: "Não foi possível concluir", description: describeError(e) });
  // Mutações atualizam a lista em cache com a resposta da API e revalidam aulas/horários/catálogo.
  const cancelMutation = useCancelLessonMutation();
  const resyncMutation = useResyncLessonMutation();
  const cancel = {
    pending: cancelMutation.isPending,
    run: async () => {
      await cancelMutation.mutateAsync(lesson.id);
      toast({ tone: "success", title: "Aula cancelada" });
    },
  };
  const resync = {
    pending: resyncMutation.isPending,
    run: async () => {
      const l = await resyncMutation.mutateAsync(lesson.id);
      toast(
        l.calendar_sync_status === "synced"
          ? { tone: "success", title: "Evento criado na Google Agenda" }
          : { tone: "info", title: "Ainda não foi possível sincronizar", description: "Confira a conexão com a Google Agenda." },
      );
    },
  };

  return (
    <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between" data-testid="lesson-row" data-status={lesson.status}>
      <div className="flex min-w-0 items-start gap-4">
        <DateBlock iso={lesson.starts_at} tone={upcoming ? "default" : "muted"} />
        <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 font-semibold text-fg-strong">
          {subjectName(lesson.subject)}
          {lesson.status === "cancelled" ? (
            <Badge tone="danger">Cancelada</Badge>
          ) : upcoming ? (
            <Badge tone={lesson.calendar_sync_status === "synced" ? "success" : "neutral"}>{SYNC_LABEL[lesson.calendar_sync_status]}</Badge>
          ) : (
            <Badge tone="neutral">Realizada</Badge>
          )}
        </p>
        <p className="mt-1 text-sm text-fg first-letter:uppercase">{lessonWhen(lesson.starts_at, lesson.ends_at)}</p>
        <p className="text-sm text-fg-muted">
          {lesson.role === "teacher" ? "Aluno" : "Professor"}: {other.display_name ?? "—"}
        </p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
        {upcoming && isTrustedMeetUrl(lesson.meet_url) && (
          <a href={lesson.meet_url} target="_blank" rel="noopener noreferrer" className={buttonClasses({ size: "sm" })}>
            <VideoIcon className="h-4 w-4" /> Entrar no Meet
            <ExternalIcon className="h-3.5 w-3.5" />
            <span className="sr-only"> (abre em nova aba)</span>
          </a>
        )}
        {upcoming && lesson.role === "teacher" && lesson.calendar_sync_status !== "synced" && (
          <Button variant="secondary" size="sm" leftIcon={<RefreshIcon className="h-4 w-4" />} loading={resync.pending} onClick={() => void resync.run().catch(fail)}>
            Sincronizar agenda
          </Button>
        )}
        {upcoming &&
          (confirming ? (
            <>
              <Button variant="danger" size="sm" loading={cancel.pending} onClick={() => void cancel.run().catch(fail)}>
                Confirmar cancelamento
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                Manter
              </Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
              Cancelar
            </Button>
          ))}
      </div>
    </li>
  );
}
