/**
 * Exportação LOCAL de uma aula em formato iCalendar (.ics, RFC 5545).
 *
 * É apenas um arquivo gerado no navegador com os dados da aula. NÃO é a
 * sincronização com o Google Agenda (que dependerá do backend e de OAuth) e
 * não inclui link de reunião inventado.
 */
import type { Lesson } from "./api/types";
import { subjectName } from "./catalog";

/** 2026-11-19T22:00:00.000Z → 20261119T220000Z */
const icsDate = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Escapa texto conforme RFC 5545 (barra, ponto e vírgula, vírgula e quebras de linha). */
export const icsEscape = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Dobra linhas longas em 75 octetos (aproximado por caracteres), como pede a RFC. */
const fold = (line: string) => {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = " " + rest.slice(74);
  }
  out.push(rest);
  return out.join("\r\n");
};

export function buildLessonIcs(lesson: Lesson, perspective: "student" | "teacher", now = new Date()): string {
  const subject = subjectName(lesson.subject);
  const withWhom = perspective === "student" ? lesson.teacherName : lesson.studentName;
  const description = [
    `Aula de ${subject} com ${withWhom} pelo EduSearch.`,
    lesson.topic ? `Tema: ${lesson.topic}.` : "",
    "Aula online. O link do Google Meet aparecerá no EduSearch quando estiver disponível.",
    "Arquivo gerado na versão de demonstração (dados fictícios).",
  ]
    .filter(Boolean)
    .join("\n");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//EduSearch//Demonstracao//PT-BR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${lesson.id}@demo.edusearch`,
    `DTSTAMP:${icsDate(now.toISOString())}`,
    `DTSTART:${icsDate(lesson.start)}`,
    `DTEND:${icsDate(lesson.end)}`,
    `SUMMARY:${icsEscape(`${subject} — EduSearch`)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    "LOCATION:Online",
    `STATUS:${lesson.status === "cancelled" ? "CANCELLED" : lesson.status === "scheduled" ? "CONFIRMED" : "TENTATIVE"}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** Dispara o download do arquivo .ics no navegador (sem servidor). */
export function downloadLessonIcs(lesson: Lesson, perspective: "student" | "teacher") {
  const blob = new Blob([buildLessonIcs(lesson, perspective)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `edusearch-aula-${lesson.id}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
