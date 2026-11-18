/**
 * Modelos de dados do FRONTEND (view models).
 *
 * IMPORTANTE: não são o contrato oficial da API. Ainda não existe
 * docs/api-contract.md; quando existir, os adapters em src/lib/data/http
 * devem converter as respostas da API para estes tipos (ou estes tipos
 * devem ser ajustados). Ver docs/frontend/api-integration.md.
 *
 * Convenções: datas em ISO 8601 (UTC); valores monetários em centavos (BRL),
 * sempre inteiros; percentuais em basis points inteiros (1500 = 15%).
 */

export type Role = "student" | "teacher";

export type Level = "fundamental" | "medio" | "pre-vestibular" | "graduacao" | "concursos" | "livre";

export type Methodology = "pratica" | "teorica" | "exercicios" | "conversacao" | "projetos";

export type DayPeriod = "manha" | "tarde" | "noite";

/** Dificuldades declaradas pelo aluno no matching (lista fechada, explicável). */
export type Difficulty = "base" | "exercicios" | "pratica" | "fala" | "organizacao";

export type Subject = { id: string; name: string };

export type Teacher = {
  id: string;
  name: string;
  headline: string;
  bio: string;
  subjects: string[]; // ids de Subject
  levels: Level[];
  methodologies: Methodology[];
  periods: DayPeriod[];
  priceCents: number;
  lessonMinutes: number;
  education: string[];
  languages: string[];
};

export type TeacherFilters = {
  q?: string;
  subject?: string;
  level?: Level | "";
  methodologies?: Methodology[];
  periods?: DayPeriod[];
  maxPriceCents?: number;
};

export type TimeSlot = { id: string; teacherId: string; start: string; end: string };

/**
 * Ciclo de vida da aula:
 * - pending_payment: reserva solicitada; o horário fica reservado até o Pix
 *   ser confirmado, expirar ou ser cancelado.
 * - scheduled: confirmada (pagamento confirmado).
 * - completed / cancelled.
 */
export type LessonStatus = "pending_payment" | "scheduled" | "completed" | "cancelled";

export type CancellationReason = "student" | "teacher" | "payment_expired";

/**
 * Status de uma cobrança Pix:
 * - creating: aguardando criação da cobrança.
 * - pending: aguardando pagamento.
 * - processing: pagamento em processamento.
 * - confirmed, expired, cancelled, failed.
 */
export type PaymentStatus = "creating" | "pending" | "processing" | "confirmed" | "expired" | "cancelled" | "failed";

/** Reunião da aula. O link só existe quando a API devolver uma URL do Google Meet. */
export type MeetingInfo = {
  provider: "google_meet";
  /** URL de entrada. Nunca é inventada pelo frontend; null até a integração existir. */
  joinUrl: string | null;
  status: "not_connected" | "awaiting_link" | "ready";
};

/** Estado da sincronização da aula com o Google Agenda. */
export type CalendarSyncStatus = "not_synced" | "pending" | "synced" | "failed";

export type LessonMaterial = { id: string; title: string; kind: "lista" | "resumo" | "link" };

export type Lesson = {
  id: string;
  teacherId: string;
  teacherName: string;
  studentId: string;
  studentName: string;
  subject: string; // id de Subject
  topic?: string;
  start: string;
  end: string;
  status: LessonStatus;
  cancellationReason?: CancellationReason;
  priceCents: number;
  meeting: MeetingInfo;
  /** Cobrança mais recente desta aula (null quando ainda não foi criada). */
  payment: { checkoutId: string; status: PaymentStatus } | null;
  calendarSync: CalendarSyncStatus;
  /** Contexto do aluno exibido ao professor (fictício na demonstração). */
  studentLevel?: Level;
  studentGoal?: string;
  materials?: LessonMaterial[];
};

/** Cobrança Pix de uma aula (gateway planejado: AbacatePay). */
export type Checkout = {
  id: string;
  lessonId: string;
  status: PaymentStatus;
  method: "pix";
  gateway: "abacatepay";
  amountCents: number;
  createdAt: string;
  /** Validade da cobrança informada pelo gateway (null quando não houver). */
  expiresAt: string | null;
  confirmedAt?: string;
  failureReason?: string;
  /** QR Code e Copia e Cola: só existem quando devolvidos por integração autorizada. */
  pix: { qrCodeImageUrl: string | null; copyPasteCode: string | null };
  /** true na demonstração: nada é cobrado. */
  simulated: boolean;
};

/** Conexão da conta Google Agenda (na demonstração, apenas simulada). */
export type CalendarConnection = { status: "disconnected" | "connected"; simulated: boolean };

export type BookingInput = { teacherId: string; slotId: string; subject: string; topic?: string };

export type MatchRequest = {
  goal: string;
  subject: string;
  level: Level;
  methodologies: Methodology[];
  difficulties: Difficulty[];
  periods: DayPeriod[];
  maxPriceCents?: number;
};

export type MatchResult = {
  teacher: Teacher;
  /** 0–100. Na demonstração é calculado localmente, sem IA. */
  score: number;
  reasons: string[];
  /** Pontos de atenção (ex.: acima do orçamento). */
  cautions: string[];
};

export type LearningGoal = { id: string; title: string; done: number; total: number };

export type LearningProgress = {
  lessonsCompleted: number;
  minutesStudied: number;
  goals: LearningGoal[];
  notes: Array<{ id: string; date: string; teacherName: string; subject: string; text: string }>;
};

export type WeeklyAvailability = Array<{
  weekday: number; // 0 = domingo
  enabled: boolean;
  ranges: Array<{ start: string; end: string }>; // "HH:MM"
}>;

export type TeacherProfile = {
  name: string;
  headline: string;
  bio: string;
  education: string;
  priceCents: number;
  lessonMinutes: number;
  methodologies: Methodology[];
};

export type Specialty = { subject: string; levels: Level[] };

export type TeacherDashboard = {
  lessonsThisWeek: number;
  nextLesson: Lesson | null;
  /** Saldo estimado: parcela do professor nas aulas com pagamento confirmado. */
  estimatedBalanceCents: number;
  /** Valor de reservas ainda aguardando pagamento (não recebido). */
  awaitingPaymentCents: number;
  profileChecklist: Array<{ id: "profile" | "specialties" | "availability"; label: string; done: boolean }>;
};

/**
 * Situação financeira de uma aula na visão do professor.
 * Não existe "repassado": repasses e saques não fazem parte desta fase.
 */
export type FinancialStatus = "awaiting_payment" | "confirmed" | "cancelled" | "cancelled_after_payment";

export type TeacherEarning = {
  id: string;
  lessonId: string;
  date: string;
  studentName: string;
  subject: string;
  grossCents: number;
  /** Comissão bruta do EduSearch sobre o valor da aula. */
  commissionCents: number;
  /** Parcela bruta do professor (valor da aula − comissão). */
  teacherShareCents: number;
  /** Tarifas do gateway, contabilizadas à parte; null = ainda não informadas. */
  gatewayFeeCents: number | null;
  /** Parcela do professor − tarifas conhecidas. Estimativa, não é saldo real. */
  estimatedBalanceCents: number;
  status: FinancialStatus;
};

export type EarningsSummary = {
  periodLabel: string;
  /** Comissão aplicada, em basis points (1500 = 15%). */
  commissionBps: number;
  /** Somente aulas com pagamento confirmado. */
  confirmed: { grossCents: number; commissionCents: number; teacherShareCents: number; gatewayFeesCents: number | null; estimatedBalanceCents: number };
  /** Reservas aguardando pagamento (ainda não recebidas). */
  awaitingPaymentCents: number;
  items: TeacherEarning[];
};

/** Comissão e programa de incentivos do professor (regras ainda não aprovadas). */
export type CommissionProgram = {
  standardBps: number;
  currentBps: number;
  activeBenefits: Array<{ id: string; title: string; description: string }>;
  /** Economia acumulada com benefícios (0 enquanto não houver benefício aprovado). */
  savingsCents: number;
  /** Metas e conquistas são exemplos com dados da demonstração. */
  illustrative: boolean;
  goals: Array<{ id: string; title: string; current: number; target: number; unit: string; reward: string }>;
  achievements: Array<{ id: string; title: string; date: string | null; achieved: boolean }>;
};

export type ReferralProgram = {
  /** Código ilustrativo: não funciona sem backend. */
  code: string;
  /** Link público: null até existir backend que valide indicações. */
  shareUrl: string | null;
  invited: number;
  qualified: number;
  goals: Array<{ id: string; title: string; current: number; target: number; reward: string }>;
  rewardsEarned: Array<{ id: string; title: string }>;
  rewardsPending: Array<{ id: string; title: string; reason: string }>;
  illustrative: boolean;
};

export type HealthResponse = { status: "ok"; service: string; version: string };
