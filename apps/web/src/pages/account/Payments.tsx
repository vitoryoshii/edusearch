import { Link, Navigate } from "react-router";
import { Badge, Card, WalletIcon, buttonClasses } from "@edusearch/ui";
import { hasRole, useServerMe } from "../../app/account";
import { TeacherFinancePanel } from "../../components/account/TeacherFinancePanel";
import { PageHeader } from "../../components/PageHeader";
import { QueryContent, RefreshButton } from "../../components/QueryContent";
import { useSubjectNames } from "../../components/marketplace/LessonList";
import { FEATURES } from "../../lib/features";
import { PAYMENT_STATUS_LABEL, PAYMENT_STATUS_TONE, formatBRL } from "../../lib/payments";
import { usePaymentsQuery } from "../../lib/query/hooks";
import { lessonWhen } from "../../lib/scheduling";

/** Histórico de pagamentos (aluno: o que pagou; professor: o que recebe). Só leitura. */
export default function AccountPayments() {
  const me = useServerMe();
  const payments = usePaymentsQuery(FEATURES.payments !== "off");
  const subjectName = useSubjectNames();
  if (FEATURES.payments === "off" || !me) return <Navigate to="/conta" replace />;
  const teacher = hasRole(me, "teacher");
  return (
    <>
      <PageHeader
        title={teacher ? "Financeiro" : "Meus pagamentos"}
        description={FEATURES.payments === "sandbox" ? "Ambiente de testes: Pix do Modo Teste da AbacatePay, sem dinheiro real." : "Pagamentos Pix das suas aulas."}
        actions={<RefreshButton query={payments} />}
      />
      <div className="space-y-6">
      {teacher && <TeacherFinancePanel />}
      <Card>
        {teacher && <h2 className="mb-3 font-semibold text-fg-strong">Todos os pagamentos</h2>}
        <QueryContent
          query={payments}
          loading="spinner"
          loadingLabel="Carregando pagamentos…"
          isEmpty={(d) => d.length === 0}
          empty={{
            title: "Nenhum pagamento ainda",
            description: "Os Pix das aulas reservadas aparecem aqui.",
            icon: <WalletIcon className="h-6 w-6" />,
            action: (
              <Link to="/conta/explorar" className={buttonClasses({})}>
                Explorar professores
              </Link>
            ),
          }}
        >
          {(list) => (
            <ul className="divide-y divide-line" data-testid="payment-list">
              {list.map((p) => (
                <li key={p.id} data-testid="payment-row" data-status={p.status}>
                  <Link to={`/conta/pagamentos/${p.id}`} className="flex flex-col gap-2 py-4 hover:bg-surface-muted/60 sm:flex-row sm:items-center sm:justify-between sm:px-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-fg-strong">
                        {p.lesson.subject ? subjectName(p.lesson.subject) : "Aula"}{" "}
                        <span className="font-normal text-fg-muted">
                          · {p.role === "student" ? p.lesson.teacher_name : p.lesson.student_name}
                        </span>
                      </p>
                      {p.lesson.starts_at && p.lesson.ends_at && (
                        <p className="text-sm text-fg first-letter:uppercase">{lessonWhen(p.lesson.starts_at, p.lesson.ends_at)}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="font-semibold text-fg-strong tabular-nums">
                        {formatBRL(p.role === "teacher" ? p.teacher_share_cents : p.amount_cents)}
                      </span>
                      <Badge tone={PAYMENT_STATUS_TONE[p.status]}>{PAYMENT_STATUS_LABEL[p.status]}</Badge>
                      {p.refund && <Badge tone="primary">Reembolso solicitado</Badge>}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </QueryContent>
      </Card>
      </div>
    </>
  );
}
