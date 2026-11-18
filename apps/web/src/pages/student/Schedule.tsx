import { useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { Avatar, Button, Card, EmptyState, ErrorState, LoadingState, cn } from "@edusearch/ui";
import { PageHeader } from "../../components/PageHeader";
import { describeError } from "../../lib/api/client";
import type { TimeSlot } from "../../lib/api/types";
import { dataSource } from "../../lib/data/source";
import { formatDateLong, formatMoney, formatTime } from "../../lib/format";
import { useAsync } from "../../lib/hooks/useAsync";

const dayKey = (iso: string) => new Date(iso).toDateString();

function nextDays(n: number) {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i + 1);
    d.setHours(12, 0, 0, 0);
    return d;
  });
}

const weekdayFmt = new Intl.DateTimeFormat("pt-BR", { weekday: "short" });

export default function Schedule() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const data = useAsync(() => Promise.all([dataSource.getTeacher(id), dataSource.listTeacherSlots(id)]), [id]);
  const days = useMemo(() => nextDays(7), []);
  const [params] = useSearchParams();
  // ?horario=<id> vem do perfil do professor: pré-seleciona o dia e o horário.
  const preselected = params.get("horario");
  const [day, setDay] = useState(() => days[0].toDateString());
  const [slotId, setSlotId] = useState<string | null>(preselected);
  const [synced, setSynced] = useState(false);

  const byDay = useMemo(() => {
    const map = new Map<string, TimeSlot[]>();
    for (const s of data.data?.[1] ?? []) {
      const k = dayKey(s.start);
      map.set(k, [...(map.get(k) ?? []), s]);
    }
    return map;
  }, [data.data]);

  // Ajusta o dia quando o horário pré-selecionado for carregado (uma vez).
  if (!synced && data.status === "success") {
    const pre = data.data[1].find((s) => s.id === preselected);
    setSynced(true);
    if (pre) setDay(dayKey(pre.start));
    else if (preselected) setSlotId(null);
  }

  if (data.status === "loading") return <LoadingState label="Carregando horários…" />;
  if (data.status === "error") return <ErrorState description={describeError(data.error)} onRetry={data.reload} />;

  const [teacher] = data.data;
  const slots = byDay.get(day) ?? [];
  const selected = data.data[1].find((s) => s.id === slotId);

  return (
    <>
      <PageHeader
        back={{ to: `/aluno/professores/${id}`, label: "Voltar ao perfil" }}
        title="Escolha um horário"
        description="Horários exibidos no seu fuso horário."
      />

      <Card className="mb-6 flex items-center gap-4" padding="sm">
        <Avatar name={teacher.name} />
        <div className="min-w-0">
          <p className="font-semibold text-fg-strong">{teacher.name}</p>
          <p className="text-sm text-fg-muted">
            {teacher.lessonMinutes} min · {formatMoney(teacher.priceCents)} por aula
          </p>
        </div>
      </Card>

      <fieldset>
        <legend className="mb-3 text-base font-semibold text-fg-strong">Dia</legend>
        <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
          {days.map((d) => {
            const k = d.toDateString();
            const count = byDay.get(k)?.length ?? 0;
            const active = k === day;
            return (
              <label
                key={k}
                className={cn(
                  "flex min-w-0 cursor-pointer flex-col items-center rounded-control border px-0.5 py-2.5 sm:rounded-card sm:py-3 text-center transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-link",
                  active ? "border-primary bg-primary text-primary-fg" : "border-line bg-surface hover:border-line-strong",
                  count === 0 && !active && "border-dashed bg-bg",
                )}
              >
                <input
                  type="radio"
                  name="dia"
                  className="sr-only"
                  checked={active}
                  onChange={() => {
                    setDay(k);
                    setSlotId(null);
                  }}
                />
                <span className={cn("text-xs capitalize", active ? "text-primary-fg" : "text-fg-muted")}>
                  {weekdayFmt.format(d).replace(".", "")}
                </span>
                <span className={cn("text-lg font-semibold tabular-nums", !active && (count ? "text-fg-strong" : "text-fg-muted"))}>{d.getDate()}</span>
                <span className="sr-only">{count ? `, ${count} horários livres` : ", sem horários"}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="mt-6">
        <legend className="mb-3 text-base font-semibold text-fg-strong">{formatDateLong(days.find((d) => d.toDateString() === day)!.toISOString())}</legend>
        {slots.length === 0 ? (
          <EmptyState compact title="Sem horários livres neste dia" description="Escolha outro dia acima." />
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {slots.map((s) => {
              const active = s.id === slotId;
              return (
                <label
                  key={s.id}
                  className={cn(
                    "flex min-h-12 cursor-pointer items-center justify-center rounded-control border text-sm font-semibold tabular-nums transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-link",
                    active ? "border-primary bg-primary-soft text-link" : "border-line-strong bg-surface text-fg-strong hover:border-link",
                  )}
                >
                  <input type="radio" name="horario" className="sr-only" checked={active} onChange={() => setSlotId(s.id)} />
                  {formatTime(s.start)}
                </label>
              );
            })}
          </div>
        )}
      </fieldset>

      <div className="mt-8 flex flex-col gap-3 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-fg-muted" aria-live="polite">
          {selected ? `Selecionado: ${formatDateLong(selected.start)}, às ${formatTime(selected.start)}` : "Selecione um horário para continuar."}
        </p>
        <Button
          disabled={!selected}
          onClick={() => selected && navigate("/aluno/agendamento/resumo", { state: { teacher, slot: selected } })}
        >
          Continuar
        </Button>
      </div>
    </>
  );
}
