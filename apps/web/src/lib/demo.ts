/**
 * Identidades fictícias da demonstração (sem autenticação real).
 * - Aluno: Ana — vê as próprias aulas.
 * - Professor: qualquer um dos professores fictícios (padrão: Profa. Marina),
 *   escolhido em "Escolha seu perfil" ou em Configurações.
 * Uma reserva da Ana com um professor aparece na agenda desse professor.
 */
export const DEMO_STUDENT_ID = "s-ana";
export const DEMO_STUDENT_NAME = "Ana (demonstração)";
export const DEMO_TEACHER_ID = "t-marina";
export const DEMO_TEACHER_NAME = "Profa. Marina Duarte";

/** Chave da sessão de demonstração (lida pelo adapter mock como a API leria o JWT). */
export const DEMO_SESSION_KEY = "edusearch-demo-session";

/** "Profa. Marina Duarte" → "Marina" (nome de exibição na saudação). */
export const firstName = (fullName: string) => fullName.replace(/^(Prof(a)?\.?)\s+/i, "").split(/\s+/)[0] ?? fullName;
