/**
 * Chaves de consulta centralizadas (Fase 4B). Pura; testada em scripts/unit.test.mjs.
 *
 * Todo dado PRIVADO fica sob ["edusearch", "user", <id da conta>, ...]: duas contas nunca
 * compartilham uma entrada, e o logout/troca de conta remove tudo que não for da conta atual.
 * Dado público (catálogo de disciplinas) fica sob ["edusearch", "public", ...].
 */
import type { CatalogQuery } from "../api/scheduling";

const ROOT = "edusearch" as const;

export const queryKeys = {
  root: [ROOT] as const,
  publicRoot: [ROOT, "public"] as const,
  userRoot: [ROOT, "user"] as const,
  user: (uid: string) => [ROOT, "user", uid] as const,

  subjects: () => [ROOT, "public", "subjects"] as const,

  me: (uid: string) => [ROOT, "user", uid, "me"] as const,
  studentProfile: (uid: string) => [ROOT, "user", uid, "student-profile"] as const,
  lessons: (uid: string) => [ROOT, "user", uid, "lessons"] as const,
  calendar: (uid: string) => [ROOT, "user", uid, "calendar"] as const,
  availability: (uid: string) => [ROOT, "user", uid, "availability"] as const,

  catalogAll: (uid: string) => [ROOT, "user", uid, "catalog"] as const,
  /** Sem limit/offset: a paginação fica dentro da consulta infinita. */
  catalog: (uid: string, query: Omit<CatalogQuery, "limit" | "offset">) => [ROOT, "user", uid, "catalog", query] as const,
  teacherProfile: (uid: string, teacherId: string) => [ROOT, "user", uid, "teacher", teacherId] as const,
  slotsAll: (uid: string) => [ROOT, "user", uid, "slots"] as const,
  slotsOf: (uid: string, teacherId: string) => [ROOT, "user", uid, "slots", teacherId] as const,
  slots: (uid: string, teacherId: string, duration: number) => [ROOT, "user", uid, "slots", teacherId, duration] as const,
};

/** A entrada pertence a OUTRA conta (ou a nenhuma, se uid=null)? Usado para limpar o cache. */
export function isForeignPrivateKey(queryKey: readonly unknown[], uid: string | null): boolean {
  return queryKey[0] === ROOT && queryKey[1] === "user" && queryKey[2] !== uid;
}
