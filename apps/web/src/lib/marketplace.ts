/**
 * Regras puras do marketplace real (Fase 4A). Sem React; testadas em scripts/unit.test.mjs.
 * Só atributos que existem no cadastro real: nada de preço, avaliação ou certificado.
 */
import type { CatalogQuery } from "./api/scheduling";

export const CATALOG_PAGE_SIZE = 12;

export type CatalogFilters = {
  q: string;
  subject: string;
  modality: "" | NonNullable<CatalogQuery["modality"]>;
  period: "" | NonNullable<CatalogQuery["period"]>;
  availableOnly: boolean;
};

export const EMPTY_FILTERS: CatalogFilters = { q: "", subject: "", modality: "", period: "", availableOnly: false };

/** Filtros da tela → query da API (vazios omitidos; busca aparada, até 60 caracteres). */
export function toCatalogQuery(f: CatalogFilters, page: number, pageSize = CATALOG_PAGE_SIZE): CatalogQuery {
  const q = f.q.trim().slice(0, 60);
  return {
    ...(q ? { q } : {}),
    ...(f.subject ? { subject: f.subject } : {}),
    ...(f.modality ? { modality: f.modality } : {}),
    ...(f.period ? { period: f.period } : {}),
    ...(f.availableOnly ? { available_only: true } : {}),
    limit: pageSize,
    offset: Math.max(0, page) * pageSize,
  };
}

/** Filtros ↔ URL (?q=&materia=&modalidade=&periodo=&livres=1): busca compartilhável e "voltar" do navegador. */
export function filtersFromSearch(search: string): CatalogFilters {
  const p = new URLSearchParams(search);
  const oneOf = <T extends string>(v: string | null, allowed: readonly T[]): T | "" => (v && (allowed as readonly string[]).includes(v) ? (v as T) : "");
  return {
    q: (p.get("q") ?? "").slice(0, 60),
    subject: /^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.get("materia") ?? "") ? p.get("materia")! : "",
    modality: oneOf(p.get("modalidade"), ["online", "presencial", "hibrido"] as const),
    period: oneOf(p.get("periodo"), ["manha", "tarde", "noite"] as const),
    availableOnly: p.get("livres") === "1",
  };
}

export function filtersToSearch(f: CatalogFilters): string {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.subject) p.set("materia", f.subject);
  if (f.modality) p.set("modalidade", f.modality);
  if (f.period) p.set("periodo", f.period);
  if (f.availableOnly) p.set("livres", "1");
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const activeFilterCount = (f: CatalogFilters) =>
  [f.q.trim(), f.subject, f.modality, f.period, f.availableOnly ? "1" : ""].filter(Boolean).length;

/** A lista acabou quando a página veio incompleta. */
export const hasMorePages = (lastPageSize: number, pageSize = CATALOG_PAGE_SIZE) => lastPageSize === pageSize;
