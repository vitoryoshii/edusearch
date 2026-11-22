import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useSearchParams } from "react-router";
import { Avatar, Badge, Button, Card, Checkbox, ClockIcon, ErrorState, Input, LoadingState, SearchIcon, Select, buttonClasses } from "@edusearch/ui";
import { hasRole, useServerMe } from "../../app/account";
import { PageHeader } from "../../components/PageHeader";
import { useSubjectNames } from "../../components/marketplace/LessonList";
import { accountApi } from "../../lib/api/account";
import { describeError } from "../../lib/api/client";
import { schedulingApi, type BookableTeacher } from "../../lib/api/scheduling";
import { FEATURES } from "../../lib/features";
import { PERIOD_LABELS } from "../../lib/format";
import { useAsync } from "../../lib/hooks/useAsync";
import {
  CATALOG_PAGE_SIZE,
  EMPTY_FILTERS,
  activeFilterCount,
  filtersFromSearch,
  filtersToSearch,
  hasMorePages,
  toCatalogQuery,
  type CatalogFilters,
} from "../../lib/marketplace";
import { EXPERIENCE_LABELS, MODALITY_LABELS, type ExperienceRange, type Modality } from "../../lib/onboarding";
import { nextSlotLabel } from "../../lib/scheduling";

/** Catálogo REAL: só professores aprovados e publicados (garantido pela API e pelo RLS). */
export default function Explore() {
  const me = useServerMe();
  if (FEATURES.scheduling === "off" || !me) return <Navigate to="/conta" replace />;
  if (!hasRole(me, "student")) return <Navigate to="/conta" replace />;
  return <ExplorePage />;
}

function ExplorePage() {
  const [params, setParams] = useSearchParams();
  const filters = filtersFromSearch(`?${params.toString()}`);
  const key = filtersToSearch(filters);
  const subjectName = useSubjectNames();
  const subjects = useAsync(() => accountApi.subjects(), []);

  const [draftQ, setDraftQ] = useState(filters.q);
  const [items, setItems] = useState<BookableTeacher[]>([]);
  const [page, setPage] = useState(0);
  const [state, setState] = useState<{ status: "loading" | "ready" | "error"; error?: unknown; more: boolean; loadingMore: boolean }>({ status: "loading", more: false, loadingMore: false });

  // Nova busca (filtros mudaram): recomeça da primeira página. Respostas antigas são descartadas.
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading", more: false, loadingMore: false });
    setPage(0);
    schedulingApi
      .teachers(toCatalogQuery(filters, 0), controller.signal)
      .then((list) => {
        setItems(list);
        setState({ status: "ready", more: hasMorePages(list.length), loadingMore: false });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ status: "error", error, more: false, loadingMore: false });
      });
    return () => controller.abort();
  }, [key]);

  const loadMore = () => {
    const next = page + 1;
    setState((s) => ({ ...s, loadingMore: true }));
    schedulingApi
      .teachers(toCatalogQuery(filters, next))
      .then((list) => {
        setItems((prev) => [...prev, ...list.filter((t) => !prev.some((p) => p.id === t.id))]);
        setPage(next);
        setState({ status: "ready", more: hasMorePages(list.length), loadingMore: false });
      })
      .catch((error: unknown) => setState((s) => ({ ...s, loadingMore: false, error })));
  };

  const apply = (patch: Partial<CatalogFilters>) => setParams(new URLSearchParams(filtersToSearch({ ...filters, ...patch }).slice(1)));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    apply({ q: draftQ });
  };
  const count = activeFilterCount(filters);

  return (
    <>
      <PageHeader title="Explorar professores" description="Professores aprovados no piloto. Veja o perfil e os próximos horários livres." />
      <Card className="mb-6" data-testid="catalog-filters">
        <form role="search" onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Input
            label="Buscar por nome ou disciplina"
            value={draftQ}
            maxLength={60}
            onChange={(e) => setDraftQ(e.target.value)}
            leftIcon={<SearchIcon className="h-4 w-4" />}
            className="min-w-0 flex-1"
            enterKeyHint="search"
          />
          <Button type="submit" className="shrink-0">
            Buscar
          </Button>
        </form>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Select
            label="Disciplina"
            value={filters.subject}
            onChange={(e) => apply({ subject: e.target.value })}
            placeholder="Todas"
            options={(subjects.data ?? []).map((s) => ({ value: s.slug, label: s.name }))}
          />
          <Select
            label="Modalidade"
            value={filters.modality}
            onChange={(e) => apply({ modality: e.target.value as CatalogFilters["modality"] })}
            placeholder="Todas"
            options={(["online", "presencial", "hibrido"] as const).map((m) => ({ value: m, label: MODALITY_LABELS[m] }))}
          />
          <Select
            label="Período disponível"
            value={filters.period}
            onChange={(e) => apply({ period: e.target.value as CatalogFilters["period"] })}
            placeholder="Qualquer"
            options={(["manha", "tarde", "noite"] as const).map((p) => ({ value: p, label: PERIOD_LABELS[p] }))}
          />
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <Checkbox label="Só com horário livre nos próximos 14 dias" checked={filters.availableOnly} onChange={(e) => apply({ availableOnly: e.target.checked })} />
          {count > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setDraftQ("");
                setParams(new URLSearchParams(filtersToSearch(EMPTY_FILTERS).slice(1)));
              }}
            >
              Limpar filtros ({count})
            </Button>
          )}
        </div>
      </Card>

      {state.status === "loading" && <LoadingState variant="spinner" label="Buscando professores…" />}
      {state.status === "error" && <ErrorState description={describeError(state.error)} onRetry={() => apply({})} />}
      {state.status === "ready" && items.length === 0 && (
        <Card tone="muted" className="text-center" data-testid="catalog-empty">
          <p className="font-semibold text-fg-strong">Nenhum professor encontrado</p>
          <p className="mt-1 text-sm text-fg-muted">{count ? "Tente remover algum filtro." : "Ainda não há professores aprovados no piloto."}</p>
        </Card>
      )}
      {state.status === "ready" && items.length > 0 && (
        <>
          <p className="mb-3 text-sm text-fg-muted" aria-live="polite">
            {items.length} {items.length === 1 ? "professor" : "professores"}
            {state.more ? " até agora" : ""}
          </p>
          <ul className="grid gap-4 md:grid-cols-2" data-testid="catalog-results">
            {items.map((t) => (
              <li key={t.id}>
                <TeacherResultCard teacher={t} subjectName={subjectName} />
              </li>
            ))}
          </ul>
          {state.more && (
            <div className="mt-6 flex justify-center">
              <Button variant="secondary" loading={state.loadingMore} onClick={loadMore} data-testid="catalog-more">
                Carregar mais
              </Button>
            </div>
          )}
        </>
      )}
      <p className="sr-only">Até {CATALOG_PAGE_SIZE} professores por página.</p>
    </>
  );
}

function TeacherResultCard({ teacher: t, subjectName }: { teacher: BookableTeacher; subjectName: (slug: string) => string }) {
  const next = nextSlotLabel(t.next_slot);
  return (
    <Card className="flex h-full flex-col gap-4" data-testid="teacher-result">
      <div className="flex items-start gap-3">
        <Avatar name={t.display_name} src={t.avatar_url ?? undefined} size="lg" />
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-fg-strong">
            <Link to={`/conta/professores/${t.id}`} className="underline-offset-4 hover:underline">
              {t.display_name}
            </Link>
          </h2>
          {t.headline && <p className="mt-0.5 line-clamp-2 text-sm text-fg">{t.headline}</p>}
          <p className="mt-1 text-xs text-fg-muted">
            {[t.modality ? MODALITY_LABELS[t.modality as Modality] : null, t.experience ? `Experiência: ${EXPERIENCE_LABELS[t.experience as ExperienceRange]}` : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {t.subjects.map((s) => (
          <Badge key={s} tone="primary">
            {subjectName(s)}
          </Badge>
        ))}
      </div>
      <p className="mt-auto flex items-center gap-1.5 text-sm text-fg">
        <ClockIcon className="h-4 w-4 shrink-0 text-link" />
        {next ? (
          <span className="first-letter:uppercase">Próximo horário: {next}</span>
        ) : (
          <span className="text-fg-muted">Sem horários livres nos próximos 14 dias</span>
        )}
      </p>
      <Link to={`/conta/professores/${t.id}`} className={buttonClasses({ variant: "secondary", fullWidth: true })} aria-label={`Ver perfil e horários de ${t.display_name}`}>
        Ver perfil e horários
      </Link>
    </Card>
  );
}
