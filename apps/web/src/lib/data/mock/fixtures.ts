/**
 * DADOS SINTÉTICOS DE DEMONSTRAÇÃO.
 *
 * Todas as pessoas, valores, horários e anotações abaixo são FICTÍCIOS.
 * Não representam professores, alunos ou métricas reais do EduSearch.
 * Não há avaliações (estrelas) de propósito: o produto ainda não tem aulas reais.
 */
import type {
  DayPeriod,
  EarningsSummary,
  LearningProgress,
  Lesson,
  Specialty,
  Teacher,
  TeacherProfile,
  TimeSlot,
  WeeklyAvailability,
} from "../../api/types";
import { SUBJECTS, subjectName } from "../../catalog";

import { DEMO_STUDENT_ID, DEMO_STUDENT_NAME, DEMO_TEACHER_ID } from "../../demo";

export { DEMO_STUDENT_ID, DEMO_STUDENT_NAME, DEMO_TEACHER_ID };

export const subjects = SUBJECTS;
export { subjectName };

export const teachers: Teacher[] = [
  {
    id: "t-marina",
    name: "Profa. Marina Duarte",
    headline: "Matemática para ENEM e vestibulares",
    bio: "Professora de Matemática com foco em preparação para o ENEM. Trabalha a partir das dificuldades do aluno, com muitos exercícios comentados e revisão espaçada.",
    subjects: ["matematica", "fisica"],
    levels: ["medio", "pre-vestibular"],
    methodologies: ["exercicios", "pratica"],
    periods: ["tarde", "noite"],
    priceCents: 8000,
    lessonMinutes: 60,
    education: ["Licenciatura em Matemática (fictícia)", "Especialização em Ensino de Ciências Exatas (fictícia)"],
    languages: ["Português"],
  },
  {
    id: "t-rafael",
    name: "Prof. Rafael Nogueira",
    headline: "Redação nota máxima, passo a passo",
    bio: "Corrige redações com devolutivas detalhadas e ajuda a construir repertório. Aulas estruturadas em competências do ENEM.",
    subjects: ["redacao", "historia"],
    levels: ["medio", "pre-vestibular", "concursos"],
    methodologies: ["pratica", "teorica"],
    periods: ["manha", "noite"],
    priceCents: 7000,
    lessonMinutes: 60,
    education: ["Licenciatura em Letras (fictícia)"],
    languages: ["Português", "Espanhol"],
  },
  {
    id: "t-helena",
    name: "Profa. Helena Castro",
    headline: "Inglês para conversação e intercâmbio",
    bio: "Aulas focadas em conversação, com situações reais do dia a dia e preparação para entrevistas e intercâmbios.",
    subjects: ["ingles"],
    levels: ["livre", "graduacao"],
    methodologies: ["conversacao", "pratica"],
    periods: ["manha", "tarde"],
    priceCents: 9500,
    lessonMinutes: 50,
    education: ["Bacharelado em Tradução (fictício)"],
    languages: ["Português", "Inglês"],
  },
  {
    id: "t-joao",
    name: "Prof. João Pereira",
    headline: "Física e Matemática sem decoreba",
    bio: "Explica a intuição por trás das fórmulas antes de partir para os exercícios. Ideal para quem sente que 'não é de exatas'.",
    subjects: ["fisica", "matematica"],
    levels: ["fundamental", "medio"],
    methodologies: ["teorica", "exercicios"],
    periods: ["tarde"],
    priceCents: 6000,
    lessonMinutes: 60,
    education: ["Licenciatura em Física (fictícia)"],
    languages: ["Português"],
  },
  {
    id: "t-luiza",
    name: "Profa. Luiza Martins",
    headline: "Biologia e Química para vestibulares",
    bio: "Usa mapas mentais e esquemas visuais para organizar conteúdos extensos. Acompanha o cronograma de estudos do aluno.",
    subjects: ["biologia", "quimica"],
    levels: ["medio", "pre-vestibular"],
    methodologies: ["teorica", "projetos"],
    periods: ["manha", "noite"],
    priceCents: 7500,
    lessonMinutes: 60,
    education: ["Bacharelado em Ciências Biológicas (fictício)"],
    languages: ["Português"],
  },
  {
    id: "t-caio",
    name: "Prof. Caio Ramos",
    headline: "Programação para iniciantes e universitários",
    bio: "Ensina lógica e programação construindo pequenos projetos desde a primeira aula. Apoio em disciplinas da graduação.",
    subjects: ["programacao", "matematica"],
    levels: ["graduacao", "livre"],
    methodologies: ["projetos", "pratica"],
    periods: ["noite"],
    priceCents: 11000,
    lessonMinutes: 60,
    education: ["Bacharelado em Ciência da Computação (fictício)"],
    languages: ["Português", "Inglês"],
  },
];

/* --------------------------------- Datas --------------------------------- */

/** Data relativa a hoje (dias de deslocamento, hora local). */
export function at(dayOffset: number, hour: number, minute = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d;
}
const iso = (d: Date) => d.toISOString();
const plusMinutes = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);

/** Janela de agendamento: de amanhã até 7 dias à frente. */
export const BOOKING_WINDOW_DAYS = 7;

/** Horários candidatos de um professor: de hora em hora dentro da grade semanal (antes de descontar as aulas marcadas). */
export function candidateSlots(teacher: Teacher, weekly: WeeklyAvailability): TimeSlot[] {
  const slots: TimeSlot[] = [];
  for (let day = 1; day <= BOOKING_WINDOW_DAYS; day++) {
    const weekday = at(day, 0).getDay();
    const d = weekly.find((w) => w.weekday === weekday);
    if (!d?.enabled) continue;
    const hours = new Set<number>();
    for (const r of d.ranges) {
      const [sh] = r.start.split(":").map(Number);
      const [eh, em] = r.end.split(":").map(Number);
      // A aula precisa terminar dentro do intervalo.
      for (let h = sh; h * 60 + teacher.lessonMinutes <= eh * 60 + em; h++) hours.add(h);
    }
    for (const h of [...hours].sort((x, y) => x - y)) {
      const start = at(day, h);
      slots.push({ id: `${teacher.id}-${iso(start)}`, teacherId: teacher.id, start: iso(start), end: iso(plusMinutes(start, teacher.lessonMinutes)) });
    }
  }
  return slots;
}

/** Duas faixas de horário se sobrepõem? */
export const overlaps = (a: { start: string; end: string }, b: { start: string; end: string }) =>
  a.start < b.end && b.start < a.end;

/* --------------------------------- Aulas ---------------------------------- */

function lesson(
  id: string,
  teacher: Teacher,
  student: { id: string; name: string },
  subject: string,
  start: Date,
  status: Lesson["status"],
  topic?: string,
): Lesson {
  return {
    id,
    teacherId: teacher.id,
    teacherName: teacher.name,
    studentId: student.id,
    studentName: student.name,
    subject,
    topic,
    start: iso(start),
    end: iso(plusMinutes(start, teacher.lessonMinutes)),
    status,
    priceCents: teacher.priceCents,
    meetingUrl: null,
  };
}

/**
 * Uma única lista de aulas para toda a demonstração.
 * - Visão do aluno: aulas com studentId = DEMO_STUDENT_ID.
 * - Visão do professor: aulas com teacherId = DEMO_TEACHER_ID.
 * Assim, uma reserva feita pela Ana com a Profa. Marina aparece nas duas visões.
 */
export function seedLessons(): Lesson[] {
  const [marina, rafael, helena] = teachers;
  const ana = { id: DEMO_STUDENT_ID, name: DEMO_STUDENT_NAME };
  const other = (n: string) => ({ id: `s-${n.toLowerCase().replace(/\W/g, "")}`, name: `${n} (fictício)` });
  return [
    // Aulas da Ana (aluna da demonstração)
    lesson("l-1", marina, ana, "matematica", at(2, 19), "scheduled", "Funções do 1º e 2º grau"),
    lesson("l-2", rafael, ana, "redacao", at(5, 8), "scheduled", "Proposta de intervenção"),
    lesson("l-3", marina, ana, "matematica", at(-5, 19), "completed", "Porcentagem e juros"),
    lesson("l-4", rafael, ana, "redacao", at(-9, 8), "completed", "Estrutura da dissertação"),
    lesson("l-5", marina, ana, "matematica", at(-12, 19), "completed", "Razão e proporção"),
    lesson("l-6", helena, ana, "ingles", at(-3, 10), "cancelled"),
    // Outros alunos da Profa. Marina (professora da demonstração)
    lesson("l-7", marina, other("Bruno T."), "matematica", at(1, 14), "scheduled", "Geometria plana"),
    lesson("l-8", marina, other("Carla M."), "fisica", at(1, 16), "scheduled", "Cinemática"),
    lesson("l-9", marina, other("Diego R."), "matematica", at(3, 19), "scheduled", "Probabilidade"),
    lesson("l-10", marina, other("Eduarda L."), "matematica", at(9, 14), "scheduled", "Estatística"),
    lesson("l-11", marina, other("Bruno T."), "matematica", at(-2, 14), "completed", "Trigonometria"),
    lesson("l-12", marina, other("Fábio C."), "fisica", at(-6, 16), "completed"),
    lesson("l-13", marina, other("Carla M."), "fisica", at(-8, 16), "cancelled"),
    // Outros professores também têm agenda própria
    lesson("l-14", rafael, other("Gabriel P."), "redacao", at(4, 19), "scheduled", "Repertório sociocultural"),
    lesson("l-15", rafael, other("Júlia N."), "redacao", at(-4, 20), "completed"),
    lesson("l-16", teachers[4], other("Igor S."), "biologia", at(3, 8), "scheduled", "Genética"),
  ];
}

const [marina, rafael] = teachers;

export const studentProgress: LearningProgress = {
  lessonsCompleted: 3,
  minutesStudied: 180,
  goals: [
    { id: "g-1", title: "Matemática para o ENEM", done: 2, total: 8 },
    { id: "g-2", title: "Redação: estrutura dissertativa", done: 1, total: 5 },
  ],
  notes: [
    { id: "n-1", date: iso(at(-5, 20)), teacherName: marina.name, subject: "matematica", text: "Boa evolução em porcentagem. Próximo passo: juros compostos com exercícios do ENEM." },
    { id: "n-2", date: iso(at(-9, 9)), teacherName: rafael.name, subject: "redacao", text: "Introdução clara. Trabalhar repertório sociocultural e a proposta de intervenção." },
    { id: "n-3", date: iso(at(-12, 20)), teacherName: marina.name, subject: "matematica", text: "Revisamos razão e proporção. Lista de exercícios enviada para a próxima aula." },
  ],
};

/* ------------------- Dados editáveis de cada professor ------------------- */

/** Perfil profissional inicial, derivado do cadastro fictício do professor. */
export function profileOf(t: Teacher): TeacherProfile {
  return {
    name: t.name,
    headline: t.headline,
    bio: t.bio,
    education: t.education.join("\n"),
    priceCents: t.priceCents,
    lessonMinutes: t.lessonMinutes,
    methodologies: t.methodologies,
  };
}

/** Especialidades iniciais: cada disciplina do professor em todos os níveis que ele atende. */
export function specialtiesOf(t: Teacher): Specialty[] {
  return t.subjects.map((subject) => ({ subject, levels: [...t.levels] }));
}

const PERIOD_RANGES: Record<DayPeriod, { start: string; end: string }> = {
  manha: { start: "08:00", end: "12:00" },
  tarde: { start: "14:00", end: "18:00" },
  noite: { start: "19:00", end: "21:00" },
};

/**
 * Grade semanal inicial. A Profa. Marina tem uma grade própria (seg–sex);
 * os demais professores atendem de segunda a sábado nos seus períodos.
 */
export function availabilityOf(t: Teacher): WeeklyAvailability {
  if (t.id === DEMO_TEACHER_ID) {
    return [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      enabled: weekday >= 1 && weekday <= 5,
      ranges: weekday >= 1 && weekday <= 5 ? [{ start: "14:00", end: "17:00" }, { start: "19:00", end: "21:00" }] : [],
    }));
  }
  const ranges = (["manha", "tarde", "noite"] as const).filter((p) => t.periods.includes(p)).map((p) => ({ ...PERIOD_RANGES[p] }));
  return [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    enabled: weekday !== 0,
    ranges: weekday !== 0 ? ranges.map((r) => ({ ...r })) : [],
  }));
}

export function buildEarnings(lessons: Lesson[], feeRate = 0.1): EarningsSummary {
  const items = lessons
    .filter((l) => l.status !== "cancelled")
    .sort((a, b) => b.start.localeCompare(a.start))
    .map((l) => {
      const feeCents = Math.round(l.priceCents * feeRate);
      return {
        id: l.id,
        date: l.start,
        studentName: l.studentName,
        subject: l.subject,
        grossCents: l.priceCents,
        feeCents,
        netCents: l.priceCents - feeCents,
        status: l.status === "completed" ? ("transferred" as const) : ("expected" as const),
      };
    });
  const sum = (k: "grossCents" | "feeCents" | "netCents") => items.reduce((a, i) => a + i[k], 0);
  const month = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(new Date());
  return { periodLabel: month.charAt(0).toUpperCase() + month.slice(1), feeRate, grossCents: sum("grossCents"), feeCents: sum("feeCents"), netCents: sum("netCents"), items };
}
