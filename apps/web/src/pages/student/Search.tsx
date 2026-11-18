import { useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { Badge, Button, Card, Chip, Dialog, FilterIcon, Input, SearchIcon, Select } from "@edusearch/ui";
import { AsyncContent } from "../../components/AsyncContent";
import { PageHeader } from "../../components/PageHeader";
import { TeacherCard } from "../../components/TeacherCard";
import type { DayPeriod, Level, Methodology, TeacherFilters } from "../../lib/api/types";
import { subjectOptions } from "../../lib/catalog";
import { dataSource } from "../../lib/data/source";
import { LEVEL_LABELS, METHODOLOGY_LABELS, PERIOD_LABELS, formatMoney, options } from "../../lib/format";
import { useAsync } from "../../lib/hooks/useAsync";

const PRICE_OPTIONS = [6000, 8000, 10000, 12000].map((c) => ({ value: String(c), label: `Até ${formatMoney(c)}` }));

type FilterState = Required<Omit<TeacherFilters, "q" | "maxPriceCents">> & { maxPrice: string };

function readFilters(params: URLSearchParams): FilterState {
  const list = <T extends string>(key: string, valid: Record<T, string>) =>
    (params.get(key)?.split(",") ?? []).filter((v): v is T => v in valid);
  return {
    subject: params.get("disciplina") ?? "",
    level: (params.get("nivel") as Level) ?? "",
    methodologies: list<Methodology>("metodologia", METHODOLOGY_LABELS),
    periods: list<DayPeriod>("periodo", PERIOD_LABELS),
    maxPrice: params.get("preco") ?? "",
  };
}

const EMPTY: FilterState = { subject: "", level: "", methodologies: [], periods: [], maxPrice: "" };

function toggle<T>(list: T[], v: T) {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

function FilterFields({ value, onChange }: { value: FilterState; onChange: (v: FilterState) => void }) {
  return (
    <div className="space-y-6">
      <Select
        label="Disciplina"
        placeholder="Todas"
        options={subjectOptions}
        value={value.subject}
        onChange={(e) => onChange({ ...value, subject: e.target.value })}
      />
      <Select
        label="Nível"
        placeholder="Todos"
        options={options(LEVEL_LABELS)}
        value={value.level}
        onChange={(e) => onChange({ ...value, level: e.target.value as Level })}
      />
      <fieldset>
        <legend className="text-sm font-medium text-fg-strong">Metodologia</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {options(METHODOLOGY_LABELS).map((o) => (
            <Chip
              key={o.value}
              selected={value.methodologies.includes(o.value)}
              onClick={() => onChange({ ...value, methodologies: toggle(value.methodologies, o.value) })}
            >
              {o.label}
            </Chip>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="text-sm font-medium text-fg-strong">Período</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {options(PERIOD_LABELS).map((o) => (
            <Chip
              key={o.value}
              selected={value.periods.includes(o.value)}
              onClick={() => onChange({ ...value, periods: toggle(value.periods, o.value) })}
            >
              {o.label}
            </Chip>
          ))}
        </div>
      </fieldset>
      <Select
        label="Valor por aula"
        placeholder="Qualquer valor"
        options={PRICE_OPTIONS}
        value={value.maxPrice}
        onChange={(e) => onChange({ ...value, maxPrice: e.target.value })}
      />
    </div>
  );
}

export default function Search() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const filters = useMemo(() => readFilters(params), [params]);
  const [draftQ, setDraftQ] = useState(q);
  const [draft, setDraft] = useState<FilterState>(filters);
  const [sheetOpen, setSheetOpen] = useState(false);

  const activeCount =
    (filters.subject ? 1 : 0) +
    (filters.level ? 1 : 0) +
    filters.methodologies.length +
    filters.periods.length +
    (filters.maxPrice ? 1 : 0);

  const result = useAsync(
    () =>
      dataSource.searchTeachers({
        q,
        subject: filters.subject || undefined,
        level: filters.level || undefined,
        methodologies: filters.methodologies,
        periods: filters.periods,
        maxPriceCents: filters.maxPrice ? Number(filters.maxPrice) : undefined,
      }),
    [params.toString()],
  );

  const apply = (next: FilterState, nextQ = q) => {
    const p = new URLSearchParams();
    if (nextQ) p.set("q", nextQ);
    if (next.subject) p.set("disciplina", next.subject);
    if (next.level) p.set("nivel", next.level);
    if (next.methodologies.length) p.set("metodologia", next.methodologies.join(","));
    if (next.periods.length) p.set("periodo", next.periods.join(","));
    if (next.maxPrice) p.set("preco", next.maxPrice);
    // Preserva o modo de demonstração (?demo=erro|vazio) ao filtrar.
    const demo = params.get("demo");
    if (demo) p.set("demo", demo);
    setParams(p, { replace: true });
  };

  const clearAll = () => {
    setDraft(EMPTY);
    setDraftQ("");
    apply(EMPTY, "");
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    apply(filters, draftQ.trim());
  };

  return (
    <>
      <PageHeader title="Buscar professores" description="Filtre por disciplina, nível, metodologia, período e valor." />

      <form role="search" onSubmit={onSubmit} className="flex gap-2">
        <Input
          label="Buscar"
          hideLabel
          type="search"
          className="flex-1"
          placeholder="Ex.: matemática ENEM, redação, inglês"
          leftIcon={<SearchIcon />}
          value={draftQ}
          onChange={(e) => setDraftQ(e.target.value)}
        />
        <Button type="submit" className="max-sm:hidden">
          Buscar
        </Button>
        <Button
          variant="secondary"
          className="lg:hidden"
          leftIcon={<FilterIcon className="h-4 w-4" />}
          onClick={() => {
            setDraft(filters);
            setSheetOpen(true);
          }}
          aria-label={activeCount ? `Filtros, ${activeCount} ativos` : "Filtros"}
        >
          <span className="hidden sm:inline">Filtros</span>
          {activeCount > 0 && <Badge tone="primary">{activeCount}</Badge>}
        </Button>
      </form>

      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[16rem_1fr]">
        <aside aria-label="Filtros" className="hidden lg:block">
          <Card className="sticky top-6">
            <FilterFields value={filters} onChange={(v) => apply(v)} />
            {activeCount > 0 && (
              <Button variant="ghost" size="sm" className="mt-5 w-full" onClick={clearAll}>
                Limpar filtros
              </Button>
            )}
          </Card>
        </aside>

        <section aria-labelledby="resultados">
          <h2 id="resultados" className="sr-only">
            Resultados
          </h2>
          <AsyncContent
            state={result}
            reload={result.reload}
            isEmpty={(d) => d.length === 0}
            empty={{
              icon: <SearchIcon />,
              title: "Nenhum professor encontrado",
              description: "Tente remover alguns filtros ou buscar por outro termo.",
              action:
                activeCount > 0 || q ? (
                  <Button variant="secondary" size="sm" onClick={clearAll}>
                    Limpar busca e filtros
                  </Button>
                ) : undefined,
            }}
          >
            {(data) => (
              <>
                <p className="mb-3 text-sm text-fg-muted" aria-live="polite">
                  {data.length} {data.length === 1 ? "professor encontrado" : "professores encontrados"}
                </p>
                <ul className="grid gap-3">
                  {data.map((t) => (
                    <li key={t.id}>
                      <TeacherCard teacher={t} />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </AsyncContent>
        </section>
      </div>

      <Dialog
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Filtros"
        variant="sheet"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDraft(EMPTY)}>
              Limpar
            </Button>
            <Button
              onClick={() => {
                apply(draft, draftQ.trim());
                setSheetOpen(false);
              }}
            >
              Ver resultados
            </Button>
          </>
        }
      >
        <FilterFields value={draft} onChange={setDraft} />
      </Dialog>
    </>
  );
}
