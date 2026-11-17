import type { Subject } from "./api/types";

/**
 * Catálogo provisório de disciplinas usado pela interface.
 * Quando a API expuser a lista oficial, ela passa a ser carregada via
 * dataSource.listSubjects(); este catálogo serve como fallback de rótulos.
 */
export const SUBJECTS: Subject[] = [
  { id: "matematica", name: "Matemática" },
  { id: "redacao", name: "Redação" },
  { id: "fisica", name: "Física" },
  { id: "quimica", name: "Química" },
  { id: "biologia", name: "Biologia" },
  { id: "ingles", name: "Inglês" },
  { id: "historia", name: "História" },
  { id: "programacao", name: "Programação" },
];

export const subjectName = (id: string) => SUBJECTS.find((s) => s.id === id)?.name ?? id;

export const subjectOptions = SUBJECTS.map((s) => ({ value: s.id, label: s.name }));
