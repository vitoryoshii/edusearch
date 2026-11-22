import { useMemo, useRef, useState } from "react";
import { Navigate } from "react-router";
import {
  AlertIcon,
  Avatar,
  Badge,
  Button,
  CalendarIcon,
  Card,
  Chip,
  ExternalIcon,
  InfoIcon,
  Input,
  PlusIcon,
  RefreshIcon,
  Select,
  TrashIcon,
  VideoIcon,
  buttonClasses,
  useToast,
} from "@edusearch/ui";
import { hasRole, useServerMe } from "../../app/account";
import { AsyncContent } from "../../components/AsyncContent";
import { PageHeader } from "../../components/PageHeader";
import { accountApi } from "../../lib/api/account";
import { ApiError, describeError } from "../../lib/api/client";
import { schedulingApi, type BookableTeacher, type CalendarConnection, type Lesson } from "../../lib/api/scheduling";
import { FEATURES } from "../../lib/features";
import { useAction, useAsync } from "../../lib/hooks/useAsync";
import { isTrustedMeetUrl } from "../../lib/meeting";
import {
  WEEKDAY_LABEL,
  WEEKDAY_ORDER,
  groupSlotsByDay,
  isGoogleAuthorizationUrl,
  lessonWhen,
  windowsIssue,
  type AvailabilityWindow,
  type Weekday,
} from "../../lib/scheduling";

/**
 * Agenda REAL (Fase 3A): Google Agenda/Meet do professor, disponibilidade semanal e aulas de
 * TESTE (sem cobrança). Só existe com VITE_STAGE_SCHEDULING=testing; a API tem o próprio
 * interruptor (API_SCHEDULING_STAGE). Nada aqui usa dados da demonstração.
 */
export default function AccountAgenda() {
  const me = useServerMe();
  if (FEATURES.scheduling === "off" || !me) return <Navigate to="/conta" replace />;
  const teacher = hasRole(me, "teacher");
  const student = hasRole(me, "student");
  return <AgendaPage teacher={teacher} student={student} />;
}

function AgendaPage({ teacher, student }: { teacher: boolean; student: boolean }) {
  const lessons = useAsync(() => schedulingApi.lessons(), []);
  const subjects = useAsync(() => accountApi.subjects(), []);
  const subjectName = useMemo(() => {
    const map = new Map((subjects.data ?? []).map((s) => [s.slug, s.name] as const));
    return (slug: string) => map.get(slug) ?? slug;
  }, [subjects.data]);

  if (!teacher && !student) return <Navigate to="/conta" replace />;
  return (
    <>
      <PageHeader title="Agenda" description="Aulas de teste com link do Google Meet. Horários de Brasília." />
      <div className="space-y-5">
        <TestPhaseNotice />
        {teacher && <CalendarConnectionCard />}
        {teacher && <AvailabilityEditor />}
        {student && <BookLesson subjectName={subjectName} onBooked={lessons.reload} />}
        <Card>
          <h2 className="text-lg font-semibold text-fg-strong">Minhas aulas</h2>
          <div className="mt-4">
            <AsyncContent
              state={lessons}
              reload={lessons.reload}
              loading="spinner"
              isEmpty={(d) => d.length === 0}
              empty={{ title: "Nenhuma aula ainda", description: "As aulas de teste reservadas aparecem aqui.", icon: <CalendarIcon className="h-6 w-6" /> }}
            >
              {(data) => (
                <ul className="divide-y divide-line" data-testid="lesson-list">
                  {data.map((l) => (
                    <LessonRow key={l.id} lesson={l} subjectName={subjectName} onChange={lessons.reload} />
                  ))}
                </ul>
              )}
            </AsyncContent>
          </div>
        </Card>
      </div>
    </>
  );
}

function TestPhaseNotice() {
  return (
    <Card tone="muted" className="flex items-start gap-3 text-sm" data-testid="scheduling-test-notice">
      <InfoIcon className="mt-0.5 h-5 w-5 shrink-0 text-link" />
      <p className="leading-relaxed text-fg">
        <strong className="font-semibold text-fg-strong">Fase de testes:</strong> as aulas reservadas aqui são de teste, sem
        cobrança e sem pagamento. Não há aulas comerciais nesta fase.
      </p>
    </Card>
  );
}

/* ------------------------------- Google Agenda (professor) ------------------------------- */

const CALENDAR_LABEL: Record<CalendarConnection["status"], { text: string; tone: "success" | "warning" | "neutral" }> = {
  connected: { text: "Conectada", tone: "success" },
  revoked: { text: "Reconexão necessária", tone: "warning" },
  not_connected: { text: "Não conectada", tone: "neutral" },
  not_configured: { text: "Indisponível", tone: "neutral" },
};

function CalendarConnectionCard() {
  const toast = useToast();
  const state = useAsync(() => schedulingApi.calendar(), []);
  const [confirming, setConfirming] = useState(false);
  const connect = useAction(async () => {
    const { authorization_url } = await schedulingApi.startAuthorization();
    if (!isGoogleAuthorizationUrl(authorization_url)) throw new Error("Endereço de autorização inesperado.");
    window.location.assign(authorization_url);
  });
  const disconnect = useAction(async () => {
    state.setData(await schedulingApi.disconnect());
    setConfirming(false);
    toast({ tone: "success", title: "Google Agenda desconectada", description: "O EduSearch não cria mais eventos na sua agenda." });
  });
  const fail = (e: unknown) => toast({ tone: "error", title: "Não foi possível concluir", description: describeError(e) });

  return (
    <Card data-testid="calendar-card">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <CalendarIcon className="mt-0.5 h-5 w-5 shrink-0 text-link" />
          <div>
            <h2 className="flex flex-wrap items-center gap-2 font-semibold text-fg-strong">
              Google Agenda e Meet
              {state.status === "success" && (
                <span data-testid="calendar-status" data-status={state.data.status}>
                  <Badge tone={CALENDAR_LABEL[state.data.status].tone}>{CALENDAR_LABEL[state.data.status].text}</Badge>
                </span>
              )}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-fg-muted">
              Com a agenda conectada, cada aula reservada vira um evento na sua Google Agenda com link do Google Meet. O EduSearch
              só cria e remove os eventos das aulas; não lê suas outras agendas nem envia convites por e-mail.
            </p>
            {state.status === "success" && state.data.status === "revoked" && (
              <p className="mt-2 flex items-start gap-1.5 text-sm text-warning-text">
                <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" /> O acesso foi revogado ou expirou. Conecte de novo para voltar a
                criar eventos.
              </p>
            )}
            {state.status === "error" && <p className="mt-2 text-sm text-danger-text">{describeError(state.error)}</p>}
          </div>
        </div>
        {state.status === "success" && state.data.status !== "not_configured" && (
          <div className="flex shrink-0 flex-col gap-2 sm:items-end">
            {state.data.status === "connected" ? (
              confirming ? (
                <div className="flex gap-2">
                  <Button variant="danger" size="sm" loading={disconnect.pending} onClick={() => void disconnect.run().catch(fail)}>
                    Confirmar desconexão
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                    Manter
                  </Button>
                </div>
              ) : (
                <Button variant="secondary" size="sm" onClick={() => setConfirming(true)}>
                  Desconectar
                </Button>
              )
            ) : (
              <Button loading={connect.pending} onClick={() => void connect.run().catch(fail)} data-testid="calendar-connect">
                {state.data.status === "revoked" ? "Reconectar Google Agenda" : "Conectar Google Agenda"}
              </Button>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

/* ------------------------------- Disponibilidade (professor) ------------------------------- */

function AvailabilityEditor() {
  const toast = useToast();
  const state = useAsync(() => schedulingApi.availability(), []);
  const [draft, setDraft] = useState<AvailabilityWindow[] | null>(null);
  const windows = draft ?? state.data?.windows ?? [];
  const issue = windowsIssue(windows);
  const save = useAction(async () => {
    const saved = await schedulingApi.saveAvailability(windows);
    state.setData(saved);
    setDraft(null);
    toast({ tone: "success", title: "Disponibilidade salva" });
  });
  const update = (i: number, patch: Partial<AvailabilityWindow>) => setDraft(windows.map((w, j) => (j === i ? { ...w, ...patch } : w)));

  return (
    <Card data-testid="availability-card">
      <h2 className="text-lg font-semibold text-fg-strong">Disponibilidade semanal</h2>
      <p className="mt-1 text-sm text-fg-muted">Horários de Brasília, de 15 em 15 minutos. Alunos só podem reservar dentro destas janelas.</p>
      <div className="mt-4">
        <AsyncContent state={state} reload={state.reload} loading="spinner">
          {() => (
            <div className="space-y-3">
              {windows.length === 0 && <p className="text-sm text-fg-muted">Nenhuma janela cadastrada.</p>}
              {windows.map((w, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2 sm:grid-cols-[10rem_8rem_8rem_auto]">
                  <Select
                    label="Dia"
                    hideLabel={i > 0}
                    value={w.weekday}
                    onChange={(e) => update(i, { weekday: e.target.value as Weekday })}
                    options={WEEKDAY_ORDER.map((d) => ({ value: d, label: WEEKDAY_LABEL[d] }))}
                    className="col-span-3 sm:col-span-1"
                  />
                  <Input label="Início" hideLabel={i > 0} type="time" step={900} value={w.start} onChange={(e) => update(i, { start: e.target.value })} />
                  <Input label="Fim" hideLabel={i > 0} type="time" step={900} value={w.end === "24:00" ? "23:59" : w.end} onChange={(e) => update(i, { end: e.target.value === "23:59" ? "24:00" : e.target.value })} />
                  <Button variant="ghost" size="sm" className="mb-1" aria-label={`Remover janela de ${WEEKDAY_LABEL[w.weekday]}`} onClick={() => setDraft(windows.filter((_, j) => j !== i))}>
                    <TrashIcon className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button variant="secondary" size="sm" leftIcon={<PlusIcon className="h-4 w-4" />} onClick={() => setDraft([...windows, { weekday: "seg", start: "09:00", end: "12:00" }])} disabled={windows.length >= 28}>
                  Adicionar janela
                </Button>
                <Button
                  size="sm"
                  disabled={draft === null || issue !== null}
                  loading={save.pending}
                  onClick={() => void save.run().catch((e) => toast({ tone: "error", title: "Não foi possível salvar", description: describeError(e) }))}
                >
                  Salvar disponibilidade
                </Button>
              </div>
              {draft !== null && issue && (
                <p role="alert" className="text-sm text-danger-text">
                  {issue}
                </p>
              )}
            </div>
          )}
        </AsyncContent>
      </div>
    </Card>
  );
}

/* ------------------------------- Reserva (aluno) ------------------------------- */

function BookLesson({ subjectName, onBooked }: { subjectName: (slug: string) => string; onBooked: () => void }) {
  const toast = useToast();
  const teachers = useAsync(() => schedulingApi.teachers(), []);
  const [teacher, setTeacher] = useState<BookableTeacher | null>(null);
  const [subject, setSubject] = useState("");
  const [duration, setDuration] = useState(0);
  const [slot, setSlot] = useState<string | null>(null);
  // Uma chave por INTENÇÃO de reserva: clique duplo ou nova tentativa não criam outra aula.
  const key = useRef<string>(crypto.randomUUID());
  // Envio em andamento: um segundo clique antes de o botão desabilitar não gera outro POST/aviso.
  const inFlight = useRef(false);
  const choose = (t: BookableTeacher) => {
    setTeacher(t);
    setSubject(t.subjects[0] ?? "");
    setDuration(t.lesson_durations_minutes[0] ?? 60);
    setSlot(null);
    key.current = crypto.randomUUID();
  };
  const slots = useAsync(
    () => (teacher && duration ? schedulingApi.slots(teacher.id, duration) : Promise.resolve({ duration_minutes: 0, slots: [] })),
    [teacher?.id, duration],
  );
  const book = useAction(async () => {
    if (!teacher || !slot || !subject || inFlight.current) return;
    inFlight.current = true;
    let lesson;
    try {
      lesson = await schedulingApi.book({ teacher_id: teacher.id, subject, starts_at: slot, duration_minutes: duration, idempotency_key: key.current });
    } finally {
      inFlight.current = false;
    }
    toast({
      tone: "success",
      title: "Aula de teste reservada",
      description: lesson.meet_url ? "O link do Google Meet já está na sua lista de aulas." : "O link do Meet aparece quando o professor sincronizar a agenda.",
    });
    setSlot(null);
    key.current = crypto.randomUUID();
    slots.reload();
    onBooked();
  });
  const fail = (e: unknown) => {
    if (e instanceof ApiError && e.status === 409) {
      setSlot(null);
      key.current = crypto.randomUUID();
      slots.reload();
    }
    toast({ tone: "error", title: "Não foi possível reservar", description: describeError(e) });
  };

  return (
    <Card data-testid="booking-card">
      <h2 className="text-lg font-semibold text-fg-strong">Reservar aula de teste</h2>
      <p className="mt-1 text-sm text-fg-muted">Escolha um professor aprovado, a disciplina, a duração e um horário livre.</p>
      <div className="mt-4">
        <AsyncContent
          state={teachers}
          reload={teachers.reload}
          loading="spinner"
          isEmpty={(d) => d.length === 0}
          empty={{ title: "Nenhum professor disponível ainda", description: "Professores aparecem aqui depois de aprovados." }}
        >
          {(list) => (
            <div className="space-y-5">
              <div className="flex flex-wrap gap-2" role="group" aria-label="Professores">
                {list.map((t) => (
                  <Chip key={t.id} selected={teacher?.id === t.id} onClick={() => choose(t)} aria-pressed={teacher?.id === t.id}>
                    <span className="flex items-center gap-2">
                      <Avatar name={t.display_name} src={t.avatar_url ?? undefined} size="sm" />
                      {t.display_name}
                    </span>
                  </Chip>
                ))}
              </div>
              {teacher && (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Select label="Disciplina" value={subject} onChange={(e) => setSubject(e.target.value)} options={teacher.subjects.map((s) => ({ value: s, label: subjectName(s) }))} />
                    <Select
                      label="Duração"
                      value={String(duration)}
                      onChange={(e) => {
                        setDuration(Number(e.target.value));
                        setSlot(null);
                      }}
                      options={teacher.lesson_durations_minutes.map((d) => ({ value: String(d), label: `${d} minutos` }))}
                    />
                  </div>
                  <AsyncContent
                    state={slots}
                    reload={slots.reload}
                    loading="spinner"
                    isEmpty={(d) => d.slots.length === 0}
                    empty={{ title: "Sem horários livres nos próximos 14 dias" }}
                  >
                    {(d) => (
                      <div className="space-y-4" data-testid="slot-list">
                        {groupSlotsByDay(d.slots).map((day) => (
                          <div key={day.key}>
                            <p className="text-sm font-medium text-fg-strong first-letter:uppercase">{day.label}</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {day.slots.map((s) => (
                                <Chip key={s.iso} selected={slot === s.iso} onClick={() => setSlot(s.iso)} aria-pressed={slot === s.iso}>
                                  {s.time}
                                </Chip>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </AsyncContent>
                  <Button disabled={!slot || !subject} loading={book.pending} onClick={() => void book.run().catch(fail)} data-testid="book-lesson">
                    Reservar aula de teste
                  </Button>
                </>
              )}
            </div>
          )}
        </AsyncContent>
      </div>
    </Card>
  );
}

/* ------------------------------- Lista de aulas ------------------------------- */

const SYNC_LABEL: Record<Lesson["calendar_sync_status"], string> = {
  synced: "Na Google Agenda",
  pending: "Sincronizando",
  failed: "Falha na agenda",
  not_connected: "Sem Google Agenda",
  removed: "Removida da agenda",
};

function LessonRow({ lesson, subjectName, onChange }: { lesson: Lesson; subjectName: (slug: string) => string; onChange: () => void }) {
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const other = lesson.role === "teacher" ? lesson.student : lesson.teacher;
  const upcoming = lesson.status === "scheduled" && new Date(lesson.ends_at).getTime() > Date.now();
  const fail = (e: unknown) => toast({ tone: "error", title: "Não foi possível concluir", description: describeError(e) });
  const cancel = useAction(async () => {
    await schedulingApi.cancel(lesson.id);
    toast({ tone: "success", title: "Aula cancelada" });
    onChange();
  });
  const resync = useAction(async () => {
    const l = await schedulingApi.resync(lesson.id);
    toast(l.calendar_sync_status === "synced" ? { tone: "success", title: "Evento criado na Google Agenda" } : { tone: "info", title: "Ainda não foi possível sincronizar", description: "Confira a conexão com a Google Agenda." });
    onChange();
  });

  return (
    <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between" data-testid="lesson-row" data-status={lesson.status}>
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 font-semibold text-fg-strong">
          {subjectName(lesson.subject)}
          <Badge tone="demo">Teste</Badge>
          {lesson.status === "cancelled" ? <Badge tone="danger">Cancelada</Badge> : <Badge tone="neutral">{SYNC_LABEL[lesson.calendar_sync_status]}</Badge>}
        </p>
        <p className="mt-1 text-sm text-fg first-letter:uppercase">{lessonWhen(lesson.starts_at, lesson.ends_at)}</p>
        <p className="text-sm text-fg-muted">
          {lesson.role === "teacher" ? "Aluno" : "Professor"}: {other.display_name ?? "—"}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {upcoming && isTrustedMeetUrl(lesson.meet_url) && (
          <a href={lesson.meet_url} target="_blank" rel="noopener noreferrer" className={buttonClasses({ size: "sm" })}>
            <VideoIcon className="h-4 w-4" /> Google Meet
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
