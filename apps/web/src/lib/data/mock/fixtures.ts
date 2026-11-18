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
  WeeklyAvailability,
} from "../../api/types";
import { SUBJECTS, subjectName } from "../../catalog";

export const DEMO_STUDENT_NAME = "Ana (demonstração)";
export const DEMO_TEACHER_ID = "t-marina";

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

const PERIOD_HOURS: Record<DayPeriod, number[]> = { manha: [8, 10], tarde: [14, 16], noite: [19, 20] };

/** Gera horários livres nos próximos 7 dias, com alguns dias vazios. */
export function generateSlots(teacher: Teacher) {
  const slots = [];
  for (let day = 1; day <= 7; day++) {
    const weekday = at(day, 0).getDay();
    if (weekday === 0) continue; // sem aulas aos domingos
    for (const p of teacher.periods) {
      for (const h of PERIOD_HOURS[p]) {
        // Ocupação pseudoaleatória e determinística.
        if ((day * 7 + h + teacher.id.length) % 3 === 0) continue;
        const start = at(day, h);
        slots.push({ id: `${teacher.id}-${day}-${h}`, teacherId: teacher.id, start: iso(start), end: iso(plusMinutes(start, teacher.lessonMinutes)) });
      }
    }
  }
  return slots;
}

function lesson(
  id: string,
  teacher: Teacher,
  studentName: string,
  subject: string,
  start: Date,
  status: Lesson["status"],
  topic?: string,
): Lesson {
  return {
    id,
    teacherId: teacher.id,
    teacherName: teacher.name,
    studentName,
    subject,
    topic,
    start: iso(start),
    end: iso(plusMinutes(start, teacher.lessonMinutes)),
    status,
    priceCents: teacher.priceCents,
    meetingUrl: null,
  };
}

const [marina, rafael, helena] = teachers;

export function initialStudentLessons(): Lesson[] {
  return [
    lesson("l-1", marina, DEMO_STUDENT_NAME, "matematica", at(2, 19), "scheduled", "Funções do 1º e 2º grau"),
    lesson("l-2", rafael, DEMO_STUDENT_NAME, "redacao", at(5, 8), "scheduled", "Proposta de intervenção"),
    lesson("l-3", marina, DEMO_STUDENT_NAME, "matematica", at(-5, 19), "completed", "Porcentagem e juros"),
    lesson("l-4", rafael, DEMO_STUDENT_NAME, "redacao", at(-9, 8), "completed", "Estrutura da dissertação"),
    lesson("l-5", marina, DEMO_STUDENT_NAME, "matematica", at(-12, 19), "completed", "Razão e proporção"),
    lesson("l-6", helena, DEMO_STUDENT_NAME, "ingles", at(-3, 10), "cancelled"),
  ];
}

export function initialTeacherLessons(): Lesson[] {
  const s = (n: string) => `${n} (fictício)`;
  return [
    lesson("tl-1", marina, s("Ana S."), "matematica", at(0, 19), "scheduled", "Funções"),
    lesson("tl-2", marina, s("Bruno T."), "matematica", at(1, 14), "scheduled", "Geometria plana"),
    lesson("tl-3", marina, s("Carla M."), "fisica", at(1, 16), "scheduled", "Cinemática"),
    lesson("tl-4", marina, s("Diego R."), "matematica", at(3, 19), "scheduled", "Probabilidade"),
    lesson("tl-5", marina, s("Ana S."), "matematica", at(5, 20), "scheduled"),
    lesson("tl-6", marina, s("Eduarda L."), "matematica", at(9, 14), "scheduled", "Estatística"),
    lesson("tl-7", marina, s("Bruno T."), "matematica", at(-2, 14), "completed", "Trigonometria"),
    lesson("tl-8", marina, s("Ana S."), "matematica", at(-5, 19), "completed", "Porcentagem e juros"),
    lesson("tl-9", marina, s("Fábio C."), "fisica", at(-6, 16), "completed"),
    lesson("tl-10", marina, s("Carla M."), "fisica", at(-8, 16), "cancelled"),
  ];
}

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

export const teacherProfile: TeacherProfile = {
  name: marina.name,
  headline: marina.headline,
  bio: marina.bio,
  education: marina.education.join("\n"),
  priceCents: marina.priceCents,
  lessonMinutes: marina.lessonMinutes,
  methodologies: marina.methodologies,
};

export const specialties: Specialty[] = [
  { subject: "matematica", levels: ["medio", "pre-vestibular"] },
  { subject: "fisica", levels: ["medio"] },
];

export const availability: WeeklyAvailability = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday,
  enabled: weekday >= 1 && weekday <= 5,
  ranges: weekday >= 1 && weekday <= 5 ? [{ start: "14:00", end: "17:00" }, { start: "19:00", end: "21:00" }] : [],
}));

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
