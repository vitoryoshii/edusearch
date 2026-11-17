import { useState } from "react";
import { Button, Card, IconButton, PlusIcon, Select, Switch, TrashIcon, useToast } from "@edusearch/ui";
import { AsyncContent } from "../../components/AsyncContent";
import { DemoNotice } from "../../components/DemoNotice";
import { PageHeader } from "../../components/PageHeader";
import { describeError } from "../../lib/api/client";
import type { WeeklyAvailability } from "../../lib/api/types";
import { dataSource } from "../../lib/data/source";
import { WEEKDAYS } from "../../lib/format";
import { useAsync } from "../../lib/hooks/useAsync";

const HOURS = Array.from({ length: 17 }, (_, i) => {
  const h = String(i + 6).padStart(2, "0") + ":00";
  return { value: h, label: h };
});

/** Encontra sobreposições ou intervalos invertidos em um dia. */
function dayError(ranges: WeeklyAvailability[number]["ranges"]): string | undefined {
  if (ranges.some((r) => r.start >= r.end)) return "O horário final precisa ser depois do inicial.";
  const sorted = [...ranges].sort((a, b) => a.start.localeCompare(b.start));
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start < sorted[i - 1].end) return "Há intervalos sobrepostos neste dia.";
  }
  return undefined;
}

function Editor({ initial, onSaved }: { initial: WeeklyAvailability; onSaved: (v: WeeklyAvailability) => void }) {
  const toast = useToast();
  const [days, setDays] = useState(initial);
  const [saving, setSaving] = useState(false);
  const errors = days.map((d) => (d.enabled ? dayError(d.ranges) : undefined));
  const hasErrors = errors.some(Boolean);
  const changed = JSON.stringify(days) !== JSON.stringify(initial);

  const update = (weekday: number, fn: (d: WeeklyAvailability[number]) => WeeklyAvailability[number]) =>
    setDays((all) => all.map((d) => (d.weekday === weekday ? fn(d) : d)));

  const save = async () => {
    setSaving(true);
    try {
      const saved = await dataSource.saveAvailability(days);
      onSaved(saved);
      toast({ tone: "success", title: "Disponibilidade salva" });
    } catch (e) {
      toast({ tone: "error", title: "Não foi possível salvar", description: describeError(e) });
    } finally {
      setSaving(false);
    }
  };

  // Segunda a domingo, ordem mais natural para agenda de trabalho.
  const ordered = [...days.slice(1), days[0]];

  return (
    <>
      <ul className="grid gap-3">
        {ordered.map((d) => {
          const err = errors[d.weekday];
          return (
            <li key={d.weekday}>
              <Card padding="sm" className="sm:px-5">
                <Switch
                  label={WEEKDAYS[d.weekday]}
                  description={d.enabled ? `${d.ranges.length} intervalo(s)` : "Indisponível"}
                  checked={d.enabled}
                  onChange={(v) =>
                    update(d.weekday, (x) => ({ ...x, enabled: v, ranges: v && !x.ranges.length ? [{ start: "08:00", end: "12:00" }] : x.ranges }))
                  }
                />
                {d.enabled && (
                  <div className="mt-4 space-y-3 border-t border-line pt-4">
                    {d.ranges.map((r, i) => (
                      <div key={i} className="flex items-end gap-2">
                        <Select
                          className="flex-1"
                          label={`Início do intervalo ${i + 1} de ${WEEKDAYS[d.weekday]}`}
                          hideLabel={i > 0}
                          options={HOURS}
                          value={r.start}
                          onChange={(e) =>
                            update(d.weekday, (x) => ({ ...x, ranges: x.ranges.map((y, j) => (j === i ? { ...y, start: e.target.value } : y)) }))
                          }
                        />
                        <span className="pb-3 text-sm text-fg-muted" aria-hidden="true">
                          até
                        </span>
                        <Select
                          className="flex-1"
                          label={`Fim do intervalo ${i + 1} de ${WEEKDAYS[d.weekday]}`}
                          hideLabel={i > 0}
                          options={HOURS}
                          value={r.end}
                          onChange={(e) =>
                            update(d.weekday, (x) => ({ ...x, ranges: x.ranges.map((y, j) => (j === i ? { ...y, end: e.target.value } : y)) }))
                          }
                        />
                        <IconButton
                          label={`Remover intervalo ${i + 1} de ${WEEKDAYS[d.weekday]}`}
                          onClick={() =>
                            update(d.weekday, (x) => {
                              const ranges = x.ranges.filter((_, j) => j !== i);
                              return { ...x, ranges, enabled: ranges.length > 0 };
                            })
                          }
                        >
                          <TrashIcon className="h-5 w-5" />
                        </IconButton>
                      </div>
                    ))}
                    {err && (
                      <p role="alert" className="text-sm text-danger-text">
                        {err}
                      </p>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      leftIcon={<PlusIcon className="h-4 w-4" />}
                      onClick={() => update(d.weekday, (x) => ({ ...x, ranges: [...x.ranges, { start: "18:00", end: "20:00" }] }))}
                    >
                      Adicionar intervalo
                    </Button>
                  </div>
                )}
              </Card>
            </li>
          );
        })}
      </ul>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-fg-muted">{hasErrors ? "Corrija os intervalos destacados para salvar." : " "}</p>
        <Button onClick={save} loading={saving} disabled={!changed || hasErrors}>
          Salvar disponibilidade
        </Button>
      </div>
    </>
  );
}

export default function Availability() {
  const data = useAsync(() => dataSource.getAvailability(), []);
  return (
    <>
      <PageHeader title="Disponibilidade" description="Defina os horários em que você aceita aulas a cada semana." />
      <DemoNotice className="mb-6">
        A sincronização com o Google Calendar será feita pela API em fase futura. Nesta demonstração, nada é enviado.
      </DemoNotice>
      <AsyncContent state={data} reload={data.reload} loading="spinner">
        {(value) => <Editor initial={value} onSaved={data.setData} />}
      </AsyncContent>
    </>
  );
}
