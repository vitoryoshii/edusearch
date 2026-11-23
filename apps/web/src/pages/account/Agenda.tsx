import { useState } from "react";
import { Link, Navigate } from "react-router";
import {
  AlertIcon,
  Badge,
  Button,
  CalendarIcon,
  Card,
  Input,
  PlusIcon,
  Select,
  TrashIcon,
  buttonClasses,
  useToast,
} from "@edusearch/ui";
import { hasRole, useServerMe } from "../../app/account";
import { RealLessonCalendar } from "../../components/account/RealLessonCalendar";
import { QueryContent } from "../../components/QueryContent";
import { PageHeader } from "../../components/PageHeader";
import { describeError } from "../../lib/api/client";
import { schedulingApi, type CalendarConnection } from "../../lib/api/scheduling";
import { FEATURES } from "../../lib/features";
import { useAction } from "../../lib/hooks/useAsync";
import { toAsyncState, useAvailabilityQuery, useCalendarQuery, useDisconnectCalendarMutation, useLessonsQuery, useSaveAvailabilityMutation } from "../../lib/query/hooks";
import {
  WEEKDAY_LABEL,
  WEEKDAY_ORDER,
  isGoogleAuthorizationUrl,
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
  // URL antiga da reserva do aluno: hoje a reserva fica no perfil do professor (Explorar).
  if (!hasRole(me, "teacher")) return <Navigate to={hasRole(me, "student") ? "/conta/aulas" : "/conta"} replace />;
  return <AgendaPage />;
}

/** Agenda do PROFESSOR: aulas reais, Google Agenda/Meet e disponibilidade semanal. */
function AgendaPage() {
  const lessons = useLessonsQuery();
  const availability = useAvailabilityQuery();
  return (
    <>
      <PageHeader
        title="Agenda"
        description={
          <>
            Conecte a Google Agenda e defina quando você pode dar aulas. Horários de Brasília.{" "}
            <span data-testid="scheduling-test-notice">Aulas do piloto, sem cobrança.</span>
          </>
        }
      />
      <div className="space-y-5">
        <QueryContent
          query={lessons}
          loading="spinner"
          loadingLabel="Carregando aulas da agenda…"
        >
          {(data) => <RealLessonCalendar lessons={data} windows={availability.data?.windows ?? []} />}
        </QueryContent>
        <CalendarConnectionCard />
        <AvailabilityEditor />
        <Card className="border-primary/20 bg-primary-soft/40">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h2 className="font-semibold text-fg-strong">Acompanhe suas aulas</h2>
              <p className="mt-1 text-sm leading-relaxed text-fg-muted">Consulte os detalhes, o Google Meet e pagamentos de cada reserva em Minhas aulas.</p>
            </div>
            <Link to="/conta/aulas" className={buttonClasses({ variant: "secondary", size: "sm", className: "w-full sm:w-auto" })}>
              Ver minhas aulas
            </Link>
          </div>
        </Card>
      </div>
    </>
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
  const calendar = useCalendarQuery();
  const state = toAsyncState(calendar);
  const disconnectMutation = useDisconnectCalendarMutation();
  const [confirming, setConfirming] = useState(false);
  const connect = useAction(async () => {
    const { authorization_url } = await schedulingApi.startAuthorization();
    if (!isGoogleAuthorizationUrl(authorization_url)) throw new Error("Endereço de autorização inesperado.");
    window.location.assign(authorization_url);
  });
  const disconnect = useAction(async () => {
    await disconnectMutation.mutateAsync(); // grava o novo estado no cache (painel e agenda)
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
  const state = useAvailabilityQuery();
  const saveMutation = useSaveAvailabilityMutation();
  const [draft, setDraft] = useState<AvailabilityWindow[] | null>(null);
  const windows = draft ?? state.data?.windows ?? [];
  const issue = windowsIssue(windows);
  const save = useAction(async () => {
    await saveMutation.mutateAsync(windows); // resposta da API vai para o cache (painel incluso)
    setDraft(null);
    toast({ tone: "success", title: "Disponibilidade salva" });
  });
  const update = (i: number, patch: Partial<AvailabilityWindow>) => setDraft(windows.map((w, j) => (j === i ? { ...w, ...patch } : w)));

  return (
    <Card data-testid="availability-card" className="overflow-hidden">
      <div className="flex flex-col gap-1 border-b border-line pb-4">
        <h2 className="text-lg font-semibold text-fg-strong">Disponibilidade semanal</h2>
        <p className="max-w-2xl text-sm leading-relaxed text-fg-muted">Horários de Brasília, de 15 em 15 minutos. Alunos só podem reservar dentro destas janelas.</p>
      </div>
      <div className="mt-4">
        <QueryContent query={state} loading="spinner">
          {() => (
            <div className="space-y-4">
              {windows.length === 0 && <p className="rounded-card border border-dashed border-line-strong bg-surface-muted px-4 py-5 text-sm text-fg-muted">Nenhuma janela cadastrada. Adicione o primeiro período em que você aceita aulas.</p>}
              {windows.map((w, i) => (
                /*
                  Cartão por janela: a divisão evita a aparência de formulário corrido e mantém o
                  input nativo de hora seguro no Chrome en-US. Em telas muito estreitas ele empilha
                  sem esconder conteúdo; a partir de 400px o intervalo fica lado a lado.
                */
                <section key={i} className="rounded-card border border-line bg-surface-muted/60 p-3 shadow-card sm:p-4" data-testid="availability-row">
                  <div className="flex min-w-0 items-end gap-2">
                    <Select
                      label="Dia"
                      value={w.weekday}
                      onChange={(e) => update(i, { weekday: e.target.value as Weekday })}
                      options={WEEKDAY_ORDER.map((d) => ({ value: d, label: WEEKDAY_LABEL[d] }))}
                      className="min-w-0 flex-1"
                    />
                    <Button variant="ghost" size="sm" className="mb-1 shrink-0 text-fg-muted hover:bg-danger-soft hover:text-danger-text" aria-label={`Remover janela de ${WEEKDAY_LABEL[w.weekday]}`} onClick={() => setDraft(windows.filter((_, j) => j !== i))}>
                      <TrashIcon className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="mt-3 grid min-w-0 grid-cols-1 gap-2 min-[400px]:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] min-[400px]:items-end">
                    <Input label="Início" className="min-w-0" type="time" step={900} value={w.start} onChange={(e) => update(i, { start: e.target.value })} />
                    <span className="hidden pb-3 text-center text-lg font-semibold text-fg-muted min-[400px]:block" aria-hidden="true">→</span>
                    <Input label="Fim" className="min-w-0" type="time" step={900} value={w.end === "24:00" ? "23:59" : w.end} onChange={(e) => update(i, { end: e.target.value === "23:59" ? "24:00" : e.target.value })} />
                  </div>
                </section>
              ))}
              <div className="flex flex-col gap-2 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
                <Button variant="secondary" size="sm" leftIcon={<PlusIcon className="h-4 w-4" />} onClick={() => setDraft([...windows, { weekday: "seg", start: "09:00", end: "12:00" }])} disabled={windows.length >= 28} className="w-full sm:w-auto">
                  Adicionar janela
                </Button>
                <Button
                  size="md"
                  disabled={draft === null || issue !== null}
                  loading={save.pending}
                  onClick={() => void save.run().catch((e) => toast({ tone: "error", title: "Não foi possível salvar", description: describeError(e) }))}
                  className="w-full sm:w-auto"
                >
                  Salvar disponibilidade
                </Button>
              </div>
              {draft !== null && issue && (
                <p role="alert" className="rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-sm font-medium text-danger-text">
                  {issue}
                </p>
              )}
            </div>
          )}
        </QueryContent>
      </div>
    </Card>
  );
}
