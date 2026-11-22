/**
 * Regras puras da agenda real (Fase 3A). Sem React, sem armazenamento; testadas em
 * scripts/unit.test.mjs. Horários SEMPRE exibidos em America/Sao_Paulo (fuso da plataforma),
 * independentemente do fuso do aparelho.
 */

export const PLATFORM_TZ = "America/Sao_Paulo";

export type Weekday = "seg" | "ter" | "qua" | "qui" | "sex" | "sab" | "dom";
export const WEEKDAY_ORDER: Weekday[] = ["seg", "ter", "qua", "qui", "sex", "sab", "dom"];
export const WEEKDAY_LABEL: Record<Weekday, string> = {
  seg: "Segunda",
  ter: "Terça",
  qua: "Quarta",
  qui: "Quinta",
  sex: "Sexta",
  sab: "Sábado",
  dom: "Domingo",
};

export type AvailabilityWindow = { weekday: Weekday; start: string; end: string };

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;

export function minutesOf(hhmm: string): number | null {
  if (!HHMM.test(hhmm)) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
}

/** Mesmas regras da API: início < fim, 15 em 15 minutos, sem sobreposição no mesmo dia. */
export function windowsIssue(windows: readonly AvailabilityWindow[]): string | null {
  if (windows.length > 28) return "Use no máximo 28 janelas.";
  const parsed = windows.map((w) => ({ w, s: minutesOf(w.start), e: minutesOf(w.end) }));
  for (const { w, s, e } of parsed) {
    if (s === null || e === null) return `${WEEKDAY_LABEL[w.weekday]}: use o formato HH:MM.`;
    if (e <= s) return `${WEEKDAY_LABEL[w.weekday]}: o fim precisa ser depois do início.`;
    if (s % 15 || e % 15) return `${WEEKDAY_LABEL[w.weekday]}: use horários de 15 em 15 minutos.`;
  }
  const sorted = [...parsed].sort(
    (a, b) => WEEKDAY_ORDER.indexOf(a.w.weekday) - WEEKDAY_ORDER.indexOf(b.w.weekday) || a.s! - b.s!,
  );
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (prev.w.weekday === cur.w.weekday && cur.s! < prev.e!) return `${WEEKDAY_LABEL[cur.w.weekday]}: há janelas sobrepostas.`;
  }
  return null;
}

const dayKeyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: PLATFORM_TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const timeFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: PLATFORM_TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const dayLabelFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: PLATFORM_TZ, weekday: "long", day: "numeric", month: "long" });

/** "2026-12-02" no fuso da plataforma. */
export const dayKeyOf = (iso: string) => dayKeyFmt.format(new Date(iso));
/** "14:00" no fuso da plataforma. */
export const timeOf = (iso: string) => timeFmt.format(new Date(iso));
/** "quarta-feira, 2 de dezembro". */
export const dayLabelOf = (iso: string) => dayLabelFmt.format(new Date(iso));
/** "quarta-feira, 2 de dezembro · 14:00–15:00". */
export const lessonWhen = (startIso: string, endIso: string) => `${dayLabelOf(startIso)} · ${timeOf(startIso)}–${timeOf(endIso)}`;

const partsFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: PLATFORM_TZ, weekday: "short", day: "numeric", month: "short" });

/** Partes para o bloco de data ("qua", "2", "dez"), sempre no fuso da plataforma. */
export function dateParts(iso: string): { weekday: string; day: string; month: string } {
  const get = (type: string) =>
    (partsFmt.formatToParts(new Date(iso)).find((p) => p.type === type)?.value ?? "").replace(".", "").toLowerCase();
  return { weekday: get("weekday"), day: get("day"), month: get("month") };
}

/** "quarta-feira, 2 de dezembro · 14:00" (fuso da plataforma); null sem horário. */
export function nextSlotLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return `${dayLabelOf(iso)} · ${timeOf(iso)}`;
}

export type SlotItem = { iso: string; time: string };
export type SlotDay = { key: string; label: string; slots: SlotItem[] };

/** Agrupa inícios livres por dia (fuso da plataforma), em ordem. */
export function groupSlotsByDay(isos: readonly string[]): SlotDay[] {
  const days = new Map<string, SlotDay>();
  for (const iso of [...isos].sort()) {
    const key = dayKeyOf(iso);
    const day = days.get(key) ?? { key, label: dayLabelOf(iso), slots: [] };
    day.slots.push({ iso, time: timeOf(iso) });
    days.set(key, day);
  }
  return [...days.values()];
}

export type SlotPeriod = "manha" | "tarde" | "noite";
export const SLOT_PERIOD_LABEL: Record<SlotPeriod, string> = {
  manha: "Manhã",
  tarde: "Tarde",
  noite: "Noite",
};

/** Agrupa horários já filtrados para um dia no período de Brasília. */
export function groupSlotsByPeriod(slots: readonly SlotItem[]): Array<{ period: SlotPeriod; slots: SlotItem[] }> {
  const groups: Record<SlotPeriod, SlotItem[]> = { manha: [], tarde: [], noite: [] };
  for (const slot of slots) {
    const hour = Number(slot.time.slice(0, 2));
    const period: SlotPeriod = hour < 12 ? "manha" : hour < 18 ? "tarde" : "noite";
    groups[period].push(slot);
  }
  return (Object.keys(groups) as SlotPeriod[])
    .filter((period) => groups[period].length > 0)
    .map((period) => ({ period, slots: groups[period] }));
}

export type CalendarReturn = { kind: "code"; code: string; state: string } | { kind: "denied" } | { kind: "invalid" };

/** Lê o retorno do Google (?code&state ou ?error) sem confiar em nada além do formato. */
export function parseCalendarReturn(search: string): CalendarReturn {
  const p = new URLSearchParams(search);
  if (p.get("error")) return { kind: "denied" };
  const code = p.get("code") ?? "";
  const state = p.get("state") ?? "";
  if (code.length < 10 || code.length > 2048 || state.length < 20 || state.length > 2048) return { kind: "invalid" };
  return { kind: "code", code, state };
}

/** Só abre o Google se a URL de autorização for mesmo do Google (defesa contra resposta adulterada). */
export const isGoogleAuthorizationUrl = (url: string) => /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/.test(url);
