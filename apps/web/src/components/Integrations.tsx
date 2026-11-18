import { useState } from "react";
import {
  AlertIcon,
  Badge,
  Button,
  CalendarIcon,
  Card,
  CheckCircleIcon,
  DownloadIcon,
  ExternalIcon,
  RefreshIcon,
  VideoIcon,
  buttonClasses,
  useToast,
} from "@edusearch/ui";
import { describeError } from "../lib/api/client";
import type { CalendarConnection, Lesson } from "../lib/api/types";
import { dataSource, isDemo } from "../lib/data/source";
import { useAsync } from "../lib/hooks/useAsync";
import { downloadLessonIcs } from "../lib/ics";
import { isTrustedMeetUrl, meetingUnavailableMessage } from "../lib/meeting";

/* --------------------------------- Google Agenda --------------------------------- */

/**
 * Integração visual com o Google Agenda.
 * Demonstração: conexão e sincronização SIMULADAS — nenhuma conta Google é
 * acessada, nenhum token é armazenado e nenhum evento real é criado.
 * A exportação .ics é um recurso local separado.
 */
export function GoogleCalendarCard({
  lesson,
  perspective,
  onLessonChange,
  compact = false,
}: {
  lesson?: Lesson;
  perspective: "student" | "teacher";
  onLessonChange?: (l: Lesson) => void;
  compact?: boolean;
}) {
  const toast = useToast();
  const conn = useAsync(() => dataSource.getCalendarConnection(), []);
  const [busy, setBusy] = useState<"connect" | "sync" | null>(null);
  const [syncing, setSyncing] = useState(false);

  const connected = conn.status === "success" && conn.data.status === "connected";
  const canToggle = Boolean(dataSource.setCalendarConnection);

  const toggle = async () => {
    if (!dataSource.setCalendarConnection) return;
    setBusy("connect");
    try {
      const next: CalendarConnection = await dataSource.setCalendarConnection(!connected);
      conn.setData(next);
      toast({
        title: next.status === "connected" ? "Google Agenda conectado (simulação)" : "Google Agenda desconectado (simulação)",
        description: "Nenhuma conta Google foi acessada.",
      });
    } catch (e) {
      toast({ tone: "error", title: "Não foi possível alterar a conexão", description: describeError(e) });
    } finally {
      setBusy(null);
    }
  };

  const sync = async (simulateFailure = false) => {
    if (!lesson) return;
    setSyncing(true);
    onLessonChange?.({ ...lesson, calendarSync: "pending" });
    try {
      const updated = await dataSource.syncLessonToCalendar(lesson.id, { simulateFailure });
      onLessonChange?.(updated);
      toast(
        updated.calendarSync === "synced"
          ? { tone: "success", title: "Aula adicionada ao Google Agenda (simulação)", description: "Nenhum evento real foi criado." }
          : { tone: "error", title: "Falha ao sincronizar (simulação)", description: "Tente novamente." },
      );
    } catch (e) {
      onLessonChange?.(lesson);
      toast({ tone: "error", title: "Não foi possível sincronizar", description: describeError(e) });
    } finally {
      setSyncing(false);
    }
  };

  const statusBadge =
    conn.status !== "success" ? null : connected ? (
      <Badge tone="success" icon={<CheckCircleIcon />}>
        Conectado{isDemo ? " (simulação)" : ""}
      </Badge>
    ) : (
      <Badge tone="neutral" dot>
        Não conectado
      </Badge>
    );

  const syncState = lesson?.calendarSync;

  return (
    <Card padding={compact ? "sm" : "md"} className={compact ? "sm:px-5" : undefined}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-primary-soft text-link">
            <CalendarIcon className="h-5 w-5" />
          </span>
          <div>
            <h3 className="font-semibold text-fg-strong">Google Agenda</h3>
            <p className="text-sm text-fg-muted">
              {isDemo ? "Integração em preparação. Conexão apenas simulada." : "Sincronize suas aulas com a sua agenda."}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {statusBadge}
          {canToggle && conn.status === "success" && (
            <Button size="sm" variant="secondary" loading={busy === "connect"} onClick={toggle}>
              {connected ? "Desconectar (simulação)" : "Simular conexão"}
            </Button>
          )}
        </div>
      </div>

      {lesson && lesson.status !== "cancelled" && (
        <div className="mt-4 space-y-3 border-t border-line pt-4">
          <p className="text-sm text-fg" role="status" aria-live="polite">
            {syncState === "pending" || syncing ? (
              <span className="inline-flex items-center gap-1.5 text-link">
                <RefreshIcon className="h-4 w-4 animate-spin" /> Sincronizando com o Google Agenda…
              </span>
            ) : syncState === "synced" ? (
              <span className="inline-flex items-center gap-1.5 text-success-text">
                <CheckCircleIcon className="h-4 w-4" /> Aula adicionada ao Google Agenda (simulação)
              </span>
            ) : syncState === "failed" ? (
              <span className="inline-flex items-center gap-1.5 text-danger-text">
                <AlertIcon className="h-4 w-4" /> A sincronização falhou (simulação). Tente novamente.
              </span>
            ) : (
              <span className="text-fg-muted">Sincronização Google pendente.</span>
            )}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button
              size="sm"
              leftIcon={<CalendarIcon className="h-4 w-4" />}
              disabled={!connected || lesson.status !== "scheduled" || syncing || syncState === "synced"}
              loading={syncing}
              onClick={() => sync(false)}
              aria-describedby={`gcal-hint-${lesson.id}`}
            >
              {syncState === "failed" ? "Tentar novamente" : "Adicionar ao Google Agenda"}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<DownloadIcon className="h-4 w-4" />}
              onClick={() => {
                downloadLessonIcs(lesson, perspective);
                toast({ title: "Arquivo .ics gerado", description: "Exportação local. Não é a sincronização com o Google Agenda." });
              }}
            >
              Exportar .ics (arquivo local)
            </Button>
            {isDemo && connected && lesson.status === "scheduled" && syncState !== "synced" && (
              <Button size="sm" variant="ghost" disabled={syncing} onClick={() => sync(true)}>
                Simular falha
              </Button>
            )}
          </div>
          <p id={`gcal-hint-${lesson.id}`} className="text-xs text-fg-muted">
            {!connected
              ? "Conecte o Google Agenda para adicionar a aula."
              : lesson.status !== "scheduled"
                ? "Disponível após a confirmação do pagamento."
                : "O arquivo .ics funciona em qualquer agenda e é gerado só no seu navegador."}
          </p>
        </div>
      )}
    </Card>
  );
}

/* --------------------------------- Google Meet --------------------------------- */

/**
 * Acesso à reunião. O botão "Entrar no Google Meet" só existe quando a API
 * devolver uma URL do Meet válida — nunca um link inventado.
 */
export function MeetJoinPanel({ lesson, canJoinNow }: { lesson: Lesson; canJoinNow: boolean }) {
  const url = lesson.meeting.joinUrl;
  const trusted = isTrustedMeetUrl(url);
  return (
    <div className="flex flex-col gap-3 rounded-card bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-primary-soft text-link">
          <VideoIcon className="h-5 w-5" />
        </span>
        <div>
          <p className="font-semibold text-fg-strong">Google Meet</p>
          <p className="text-sm text-fg-muted">{trusted ? "Link da reunião disponível." : meetingUnavailableMessage(lesson)}</p>
        </div>
      </div>
      {trusted ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonClasses({ variant: canJoinNow ? "primary" : "secondary", className: "sm:shrink-0" })}
        >
          Entrar no Google Meet
          <ExternalIcon className="h-4 w-4" />
          <span className="sr-only"> (abre em nova aba)</span>
        </a>
      ) : (
        <span className="inline-flex min-h-11 items-center rounded-control border border-dashed border-line-strong px-4 text-sm font-medium text-fg-muted sm:shrink-0">
          Link indisponível
        </span>
      )}
    </div>
  );
}
