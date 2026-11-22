import { useMemo, useState, type FormEvent } from "react";
import { Link, Navigate, useSearchParams } from "react-router";
import { Avatar, Badge, Button, Card, Checkbox, ClockIcon, ErrorState, Input, LoadingState, SearchIcon, Select, buttonClasses } from "@edusearch/ui";
import { hasRole, useServerMe } from "../../app/account";
import { PageHeader } from "../../components/PageHeader";
import { RefreshStatus } from "../../components/QueryContent";
import { useSubjectNames } from "../../components/marketplace/LessonList";
import { describeError } from "../../lib/api/client";
import type { BookableTeacher } from "../../lib/api/scheduling";
import { FEATURES } from "../../lib/features";
import { PERIOD_LABELS } from "../../lib/format";
import { useCatalogQuery, useSubjectsQuery } from "../../lib/query/hooks";
import {
  CATALOG_PAGE_SIZE,
  EMPTY_FILTERS,
  activeFilterCount,
  filtersFromSearch,
  filtersToSearch,
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
  const subjectName = useSubjectNames();
  const subjects = useSubjectsQuery();
  const [draftQ, setDraftQ] = useState(filters.q);

  // Cada combinação de filtros tem sua entrada no cache (com o id da conta). Voltar à mesma busca
  // mostra o resultado na hora e revalida em segundo plano; "Carregar mais" só busca a próxima página.
  const { limit: _l, offset: _o, ...catalogQuery } = toCatalogQuery(filters, 0);
  const catalog = useCatalogQuery(catalogQuery, CATALOG_PAGE_SIZE);
  const items = useMemo(() => {
    const seen = new Set<string>();
    return (catalog.data?.pages.flat() ?? []).filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
  }, [catalog.data]);
  const more = Boolean(catalog.hasNextPage);
  const loadMore = () => void catalog.fetchNextPage();

  const apply = (patch: Partial<CatalogFilters>) => setParams(new URLSearchParams(filtersToSearch({ ...filters, ...patch }).slice(1)));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    apply({ q: draftQ });
  };
  const count = activeFilterCount(filters);
  // Celular: filtros recolhidos atrás de um botão (a busca fica sempre visível). sm+: sempre abertos.
  const [showFilters, setShowFilters] = useState(false);

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
        <Button
          variant="ghost"
          size="sm"
          className="mt-3 sm:hidden"
          aria-expanded={showFilters}
          aria-controls="catalog-filter-fields"
          onClick={() => setShowFilters((v) => !v)}
          data-testid="toggle-filters"
        >
          {showFilters ? "Ocultar filtros" : `Filtros${count ? ` (${count})` : ""}`}
        </Button>
        <div id="catalog-filter-fields" className={`${showFilters ? "block" : "hidden"} sm:block`}>
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
        </div>
      </Card>

      {catalog.isPending && <LoadingState variant="spinner" label="Buscando professores…" />}
      {catalog.isError && !catalog.data && <ErrorState description={describeError(catalog.error)} onRetry={() => void catalog.refetch()} />}
      {catalog.data && !catalog.isFetchingNextPage && <RefreshStatus query={catalog} />}
      {catalog.data && items.length === 0 && (
        <Card tone="muted" className="text-center" data-testid="catalog-empty">
          <p className="font-semibold text-fg-strong">Nenhum professor encontrado</p>
          <p className="mt-1 text-sm text-fg-muted">{count ? "Tente remover algum filtro." : "Ainda não há professores aprovados no piloto."}</p>
        </Card>
      )}
      {catalog.data && items.length > 0 && (
        <>
          <p className="mb-3 text-sm text-fg-muted" aria-live="polite">
            {items.length} {items.length === 1 ? "professor" : "professores"}
            {more ? " até agora" : ""}
          </p>
          <ul className="grid gap-4 md:grid-cols-2" data-testid="catalog-results">
            {items.map((t) => (
              <li key={t.id}>
                <TeacherResultCard teacher={t} subjectName={subjectName} />
              </li>
            ))}
          </ul>
          {more && (
            <div className="mt-6 flex justify-center">
              <Button variant="secondary" loading={catalog.isFetchingNextPage} onClick={loadMore} data-testid="catalog-more">
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
