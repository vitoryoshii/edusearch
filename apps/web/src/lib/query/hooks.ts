import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useAuth } from "../../app/auth";
import { accountApi } from "../api/account";
import { schedulingApi, type CalendarConnection, type CatalogQuery, type Lesson, type LessonRequest } from "../api/scheduling";
import type { AsyncState } from "../hooks/useAsync";
import type { AvailabilityWindow } from "../scheduling";
import { queryKeys } from "./keys";
import { STALE_MS } from "./policy";

/**
 * Consultas e mutações da conta REAL com cache compartilhado (Fase 4B).
 * Toda chave privada leva o id da conta: nada é compartilhado entre usuários.
 */

/** Id da conta com sessão real; "" quando não há (consultas privadas ficam desligadas). */
export function useAccountUid(): string {
  const { status, profile } = useAuth();
  return status === "signedIn" ? (profile?.id ?? "") : "";
}

/* ------------------------------- Consultas ------------------------------- */

export function useSubjectsQuery() {
  return useQuery({
    queryKey: queryKeys.subjects(),
    queryFn: ({ signal }) => accountApi.subjects(signal),
    staleTime: STALE_MS.subjects,
  });
}

export function useLessonsQuery(enabled = true) {
  const uid = useAccountUid();
  return useQuery({
    queryKey: queryKeys.lessons(uid),
    queryFn: ({ signal }) => schedulingApi.lessons(signal),
    staleTime: STALE_MS.lessons,
    enabled: enabled && !!uid,
  });
}

export function useStudentProfileQuery(enabled = true) {
  const uid = useAccountUid();
  return useQuery({
    queryKey: queryKeys.studentProfile(uid),
    queryFn: ({ signal }) => accountApi.getStudentProfile(signal),
    staleTime: STALE_MS.studentProfile,
    enabled: enabled && !!uid,
  });
}

export function useCalendarQuery(enabled = true) {
  const uid = useAccountUid();
  return useQuery({
    queryKey: queryKeys.calendar(uid),
    queryFn: ({ signal }) => schedulingApi.calendar(signal),
    staleTime: STALE_MS.calendar,
    enabled: enabled && !!uid,
  });
}

export function useAvailabilityQuery(enabled = true) {
  const uid = useAccountUid();
  return useQuery({
    queryKey: queryKeys.availability(uid),
    queryFn: ({ signal }) => schedulingApi.availability(signal),
    staleTime: STALE_MS.availability,
    enabled: enabled && !!uid,
  });
}

export function useTeacherProfileQuery(teacherId: string) {
  const uid = useAccountUid();
  return useQuery({
    queryKey: queryKeys.teacherProfile(uid, teacherId),
    queryFn: ({ signal }) => schedulingApi.teacherProfile(teacherId, signal),
    staleTime: STALE_MS.teacherProfile,
    enabled: !!uid && !!teacherId,
  });
}

export function useSlotsQuery(teacherId: string, duration: number) {
  const uid = useAccountUid();
  return useQuery({
    queryKey: queryKeys.slots(uid, teacherId, duration),
    queryFn: ({ signal }) => schedulingApi.slots(teacherId, duration, signal),
    staleTime: STALE_MS.slots,
    // Ao voltar à tela, horários vencidos são buscados de novo (o cache aparece enquanto isso).
    refetchOnMount: true,
    enabled: !!uid && !!teacherId && duration > 0,
  });
}

/** Catálogo paginado: cada página é guardada; "Carregar mais" só busca a próxima. */
export function useCatalogQuery(query: Omit<CatalogQuery, "limit" | "offset">, pageSize: number) {
  const uid = useAccountUid();
  return useInfiniteQuery({
    queryKey: queryKeys.catalog(uid, query),
    queryFn: ({ pageParam, signal }) => schedulingApi.teachers({ ...query, limit: pageSize, offset: pageParam * pageSize }, signal),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.length === pageSize ? pages.length : undefined),
    staleTime: STALE_MS.catalog,
    enabled: !!uid,
  });
}

/* ------------------------------- Invalidação ------------------------------- */

/** Depois de reservar/cancelar: aulas, horários e "próximo horário" do catálogo ficam velhos. */
export function invalidateAfterLessonChange(qc: QueryClient, uid: string, teacherId: string) {
  void qc.invalidateQueries({ queryKey: queryKeys.lessons(uid) });
  void qc.invalidateQueries({ queryKey: queryKeys.slotsOf(uid, teacherId) });
  void qc.invalidateQueries({ queryKey: queryKeys.catalogAll(uid) });
}

/** Coloca/atualiza a aula da resposta da API na lista em cache (tela correta sem esperar). */
function upsertLesson(qc: QueryClient, uid: string, lesson: Lesson) {
  qc.setQueryData<Lesson[]>(queryKeys.lessons(uid), (old) =>
    old ? (old.some((l) => l.id === lesson.id) ? old.map((l) => (l.id === lesson.id ? lesson : l)) : [lesson, ...old]) : old,
  );
}

/* ------------------------------- Mutações ------------------------------- */

export function useBookLessonMutation() {
  const qc = useQueryClient();
  const uid = useAccountUid();
  return useMutation({
    mutationFn: (body: LessonRequest) => schedulingApi.book(body),
    onSuccess: (lesson) => {
      upsertLesson(qc, uid, lesson);
      invalidateAfterLessonChange(qc, uid, lesson.teacher.id);
    },
    // 409 (horário tomado): o cache de horários estava velho — busca de novo. O servidor decide.
    onError: (_e, body) => invalidateAfterLessonChange(qc, uid, body.teacher_id),
  });
}

export function useCancelLessonMutation() {
  const qc = useQueryClient();
  const uid = useAccountUid();
  return useMutation({
    mutationFn: (lessonId: string) => schedulingApi.cancel(lessonId),
    onSuccess: (lesson) => {
      upsertLesson(qc, uid, lesson);
      invalidateAfterLessonChange(qc, uid, lesson.teacher.id);
    },
    onError: () => void qc.invalidateQueries({ queryKey: queryKeys.lessons(uid) }),
  });
}

export function useResyncLessonMutation() {
  const qc = useQueryClient();
  const uid = useAccountUid();
  return useMutation({
    mutationFn: (lessonId: string) => schedulingApi.resync(lessonId),
    onSuccess: (lesson) => {
      upsertLesson(qc, uid, lesson);
      void qc.invalidateQueries({ queryKey: queryKeys.calendar(uid) });
    },
  });
}

export function useSaveAvailabilityMutation() {
  const qc = useQueryClient();
  const uid = useAccountUid();
  return useMutation({
    mutationFn: (windows: AvailabilityWindow[]) => schedulingApi.saveAvailability(windows),
    onSuccess: (saved) => {
      qc.setQueryData(queryKeys.availability(uid), saved);
      void qc.invalidateQueries({ queryKey: queryKeys.slotsAll(uid) });
    },
  });
}

/** Grava o estado da conexão com o Google vindo da API (conectar/desconectar/reconectar). */
export function setCalendarConnection(qc: QueryClient, uid: string, connection: CalendarConnection) {
  qc.setQueryData(queryKeys.calendar(uid), connection);
}

export function useDisconnectCalendarMutation() {
  const qc = useQueryClient();
  const uid = useAccountUid();
  return useMutation({
    mutationFn: () => schedulingApi.disconnect(),
    onSuccess: (connection) => setCalendarConnection(qc, uid, connection),
  });
}

/** Cadastro de professor salvo: o perfil público (pré-visualização) e o catálogo ficam velhos. */
export function invalidateTeacherProfile(qc: QueryClient, uid: string) {
  void qc.invalidateQueries({ queryKey: queryKeys.teacherProfile(uid, uid) });
  void qc.invalidateQueries({ queryKey: queryKeys.catalogAll(uid) });
}

/** Cadastro de aluno salvo: atalhos de disciplinas do início usam o perfil do aluno. */
export function invalidateStudentProfile(qc: QueryClient, uid: string) {
  void qc.invalidateQueries({ queryKey: queryKeys.studentProfile(uid) });
}

/** Adapta uma consulta ao formato antigo (loading/error/success) para telas com estados próprios. */
export function toAsyncState<T>(q: { data: T | undefined; error: unknown; isError: boolean }): AsyncState<T> {
  if (q.data !== undefined) return { status: "success", data: q.data, error: undefined };
  if (q.isError) return { status: "error", data: undefined, error: q.error };
  return { status: "loading", data: undefined, error: undefined };
}
