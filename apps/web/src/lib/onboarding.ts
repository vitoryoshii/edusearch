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
