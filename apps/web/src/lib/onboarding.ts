import type { DayPeriod, Difficulty, Level, Methodology } from "./api/types";

/**
 * Regras puras do onboarding da conta REAL (sem React, sem armazenamento).
 * Testadas em scripts/unit.test.mjs.
 *
 * Nesta fase o onboarding é uma PRÉVIA: as respostas vivem só no estado da
 * tela, não são enviadas nem gravadas (nem em localStorage/sessionStorage) até
 * existir a API de perfis com persistência segura e fluxo de dados aprovado.
 */

export type AccountRole = "student" | "teacher";

export const WELCOME_PATH = "/conta/boas-vindas";
export const ONBOARDING_PATH: Record<AccountRole, string> = {
  student: "/conta/cadastro/aluno",
  teacher: "/conta/cadastro/professor",
};

/**
 * Próxima etapa disponível para uma sessão válida.
 * Sem papel escolhido (primeiro acesso) → boas-vindas; com papel → início da conta,
 * que oferece continuar o cadastro (ainda não há perfil salvo no servidor).
 */
export function nextAccountStep(role: AccountRole | null): string {
  return role ? "/conta" : WELCOME_PATH;
}

/* --------------------------------- Opções --------------------------------- */

export type Weekday = "seg" | "ter" | "qua" | "qui" | "sex" | "sab" | "dom";
export type Modality = "online" | "presencial" | "hibrido";
export type BudgetRange = "ate-50" | "50-80" | "80-120" | "120-mais";
export type ExperienceRange = "menos-1" | "1-3" | "3-5" | "5-mais";

export const WEEKDAYS: Array<{ value: Weekday; label: string }> = [
  { value: "seg", label: "Seg" },
  { value: "ter", label: "Ter" },
  { value: "qua", label: "Qua" },
  { value: "qui", label: "Qui" },
  { value: "sex", label: "Sex" },
  { value: "sab", label: "Sáb" },
  { value: "dom", label: "Dom" },
];

export const MODALITY_LABELS: Record<Modality, string> = {
  online: "Online",
  presencial: "Presencial",
  hibrido: "Online e presencial",
};

export const BUDGET_LABELS: Record<BudgetRange, string> = {
  "ate-50": "Até R$ 50",
  "50-80": "R$ 50 a R$ 80",
  "80-120": "R$ 80 a R$ 120",
  "120-mais": "Acima de R$ 120",
};

export const EXPERIENCE_LABELS: Record<ExperienceRange, string> = {
  "menos-1": "Menos de 1 ano",
  "1-3": "1 a 3 anos",
  "3-5": "3 a 5 anos",
  "5-mais": "Mais de 5 anos",
};

export const LESSON_DURATIONS = [30, 45, 60, 90] as const;

/** Limites de texto (evitam colagens enormes e mantêm o formulário curto). */
export const LIMITS = {
  goal: { min: 3, max: 200 },
  bio: { min: 30, max: 600 },
  specialties: { max: 200 },
  education: { min: 3, max: 200 },
  methodology: { max: 400 },
  /** Valor da aula em centavos (R$ 20,00 a R$ 1.000,00). */
  priceCents: { min: 2000, max: 100000 },
} as const;

/* -------------------------------- Rascunhos -------------------------------- */

export type StudentDraft = {
  goal: string;
  level: Level | null;
  subjects: string[];
  difficulties: Difficulty[];
  days: Weekday[];
  periods: DayPeriod[];
  modality: Modality | null;
  budget: BudgetRange | null;
};

export type TeacherDraft = {
  bio: string;
  subjects: string[];
  specialties: string;
  education: string;
  experience: ExperienceRange | null;
  methodologies: Methodology[];
  methodologyNotes: string;
  /** Texto digitado (ex.: "80" ou "80,50"); convertido por parsePriceToCents. */
  price: string;
  durations: number[];
  modality: Modality | null;
  days: Weekday[];
  periods: DayPeriod[];
};

export const emptyStudentDraft = (): StudentDraft => ({
  goal: "",
  level: null,
  subjects: [],
  difficulties: [],
  days: [],
  periods: [],
  modality: null,
  budget: null,
});

export const emptyTeacherDraft = (): TeacherDraft => ({
  bio: "",
  subjects: [],
  specialties: "",
  education: "",
  experience: null,
  methodologies: [],
  methodologyNotes: "",
  price: "",
  durations: [],
  modality: null,
  days: [],
  periods: [],
});

/** Alterna um item numa lista (seleção múltipla por chips). */
export function toggle<T>(list: readonly T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

/**
 * "80" | "80,5" | "80,50" | "R$ 1.200,00" → centavos (inteiro). Inválido → null.
 * Sem ponto flutuante: separa reais e centavos como texto.
 */
export function parsePriceToCents(input: string): number | null {
  const clean = input.replace(/\s|R\$/gi, "");
  const m = /^(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?$/.exec(clean);
  if (!m) return null;
  const reais = Number(m[1]!.replace(/\./g, ""));
  const cents = Number((m[2] ?? "0").padEnd(2, "0"));
  const total = reais * 100 + cents;
  return Number.isSafeInteger(total) ? total : null;
}

const len = (s: string) => s.trim().length;
const within = (s: string, min: number, max: number) => len(s) >= min && len(s) <= max;

/* ---------------------------------- Etapas ---------------------------------- */

export type StudentStep = "voce" | "objetivo" | "materias" | "rotina" | "revisao";
export type TeacherStep = "voce" | "ensino" | "aulas" | "agenda" | "documentos" | "revisao";

export const STUDENT_STEPS: StudentStep[] = ["voce", "objetivo", "materias", "rotina", "revisao"];
export const TEACHER_STEPS: TeacherStep[] = ["voce", "ensino", "aulas", "agenda", "documentos", "revisao"];

/** Motivo (em português) para a etapa ainda não estar completa; null se completa. */
export function studentStepIssue(step: StudentStep, d: StudentDraft): string | null {
  switch (step) {
    case "objetivo":
      if (!within(d.goal, LIMITS.goal.min, LIMITS.goal.max)) return "Conte em poucas palavras o que você quer aprender.";
      if (!d.level) return "Escolha seu nível atual.";
      return null;
    case "materias":
      return d.subjects.length ? null : "Escolha ao menos uma disciplina.";
    case "rotina":
      if (!d.days.length || !d.periods.length) return "Escolha ao menos um dia e um período.";
      if (!d.modality) return "Escolha a modalidade.";
      if (!d.budget) return "Escolha uma faixa de valor por aula.";
      return null;
    default:
      return null;
  }
}

export function teacherStepIssue(step: TeacherStep, d: TeacherDraft): string | null {
  switch (step) {
    case "voce":
      return within(d.bio, LIMITS.bio.min, LIMITS.bio.max)
        ? null
        : `Escreva uma apresentação entre ${LIMITS.bio.min} e ${LIMITS.bio.max} caracteres.`;
    case "ensino":
      if (!d.subjects.length) return "Escolha ao menos uma disciplina.";
      if (len(d.specialties) > LIMITS.specialties.max) return "Resuma suas especialidades.";
      if (!within(d.education, LIMITS.education.min, LIMITS.education.max)) return "Informe sua formação.";
      if (!d.experience) return "Informe seu tempo de experiência.";
      return null;
    case "aulas": {
      if (!d.methodologies.length) return "Escolha ao menos um estilo de aula.";
      if (len(d.methodologyNotes) > LIMITS.methodology.max) return "Resuma sua metodologia.";
      const cents = parsePriceToCents(d.price);
      if (cents === null || cents < LIMITS.priceCents.min || cents > LIMITS.priceCents.max)
        return "Informe um valor entre R$ 20,00 e R$ 1.000,00.";
      if (!d.durations.length) return "Escolha ao menos uma duração.";
      if (!d.modality) return "Escolha a modalidade.";
      return null;
    }
    case "agenda":
      return d.days.length && d.periods.length ? null : "Escolha ao menos um dia e um período.";
    default:
      return null;
  }
}

/** Primeira etapa incompleta (para a revisão apontar o que falta). */
export function firstIncomplete<S extends string, D>(steps: readonly S[], draft: D, issue: (s: S, d: D) => string | null): S | null {
  return steps.find((s) => issue(s, draft) !== null) ?? null;
}

/* --------------------- Rascunho ↔ API (Fase 2.6B, persistência real) --------------------- */
/*
 * Conversões PURAS entre os rascunhos da tela e o contrato da API (docs/api-contract.md).
 * Nenhuma resposta é descartada: cada campo do formulário tem um campo na API.
 */

/** Faixas de valor do aluno ↔ centavos (mapeamento exato e reversível). */
export const BUDGET_RANGE_CENTS: Record<BudgetRange, { min: number | null; max: number | null }> = {
  "ate-50": { min: null, max: 5000 },
  "50-80": { min: 5000, max: 8000 },
  "80-120": { min: 8000, max: 12000 },
  "120-mais": { min: 12000, max: null },
};

export function budgetRangeFromCents(min: number | null, max: number | null): BudgetRange | null {
  const hit = (Object.keys(BUDGET_RANGE_CENTS) as BudgetRange[]).find((k) => BUDGET_RANGE_CENTS[k].min === min && BUDGET_RANGE_CENTS[k].max === max);
  return hit ?? null;
}

/** Centavos → texto do campo de valor ("80,00"), sem ponto flutuante. */
export function centsToPriceInput(cents: number): string {
  return `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, "0")}`;
}

const optionalText = (s: string) => (s.trim() ? s.trim() : null);

export type StudentApiShape = {
  learning_goal: string;
  education_level: Level;
  subjects: string[];
  difficulty_areas: Difficulty[];
  preferred_weekdays: Weekday[];
  preferred_periods: DayPeriod[];
  preferred_modality: Modality;
  budget_min_cents: number | null;
  budget_max_cents: number | null;
};

/** Só chame com o rascunho completo (todas as etapas sem pendências). */
export function studentDraftToPayload(d: StudentDraft): StudentApiShape {
  if (!d.level || !d.modality || !d.budget) throw new Error("rascunho do aluno incompleto");
  const budget = BUDGET_RANGE_CENTS[d.budget];
  return {
    learning_goal: d.goal.trim(),
    education_level: d.level,
    subjects: [...d.subjects],
    difficulty_areas: [...d.difficulties],
    preferred_weekdays: [...d.days],
    preferred_periods: [...d.periods],
    preferred_modality: d.modality,
    budget_min_cents: budget.min,
    budget_max_cents: budget.max,
  };
}

export function studentPayloadToDraft(p: StudentApiShape): StudentDraft {
  return {
    goal: p.learning_goal,
    level: p.education_level,
    subjects: [...p.subjects],
    difficulties: [...p.difficulty_areas],
    days: [...p.preferred_weekdays],
    periods: [...p.preferred_periods],
    modality: p.preferred_modality,
    budget: budgetRangeFromCents(p.budget_min_cents, p.budget_max_cents),
  };
}

export type TeacherApiShape = {
  bio: string;
  subjects: string[];
  specialties: string | null;
  academic_background: string;
  experience: ExperienceRange;
  teaching_methods: Methodology[];
  methodology: string | null;
  price_cents: number;
  lesson_durations_minutes: number[];
  modality: Modality;
  available_weekdays: Weekday[];
  available_periods: DayPeriod[];
};

/** Só chame com o rascunho completo (todas as etapas sem pendências). */
export function teacherDraftToPayload(d: TeacherDraft): TeacherApiShape {
  const cents = parsePriceToCents(d.price);
  if (cents === null || !d.experience || !d.modality) throw new Error("rascunho do professor incompleto");
  return {
    bio: d.bio.trim(),
    subjects: [...d.subjects],
    specialties: optionalText(d.specialties),
    academic_background: d.education.trim(),
    experience: d.experience,
    teaching_methods: [...d.methodologies],
    methodology: optionalText(d.methodologyNotes),
    price_cents: cents,
    lesson_durations_minutes: [...d.durations].sort((a, b) => a - b),
    modality: d.modality,
    available_weekdays: [...d.days],
    available_periods: [...d.periods],
  };
}

export function teacherPayloadToDraft(p: TeacherApiShape): TeacherDraft {
  return {
    bio: p.bio,
    subjects: [...p.subjects],
    specialties: p.specialties ?? "",
    education: p.academic_background,
    experience: p.experience,
    methodologies: [...p.teaching_methods],
    methodologyNotes: p.methodology ?? "",
    price: centsToPriceInput(p.price_cents),
    durations: [...p.lesson_durations_minutes],
    modality: p.modality,
    days: [...p.available_weekdays],
    periods: [...p.available_periods],
  };
}
