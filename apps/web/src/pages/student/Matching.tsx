import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { ArrowLeftIcon, ArrowRightIcon, Badge, Button, Card, Chip, Select, SparkleIcon, Textarea } from "@edusearch/ui";
import { DemoNotice } from "../../components/DemoNotice";
import { PageHeader } from "../../components/PageHeader";
import type { DayPeriod, Level, MatchRequest, Methodology } from "../../lib/api/types";
import { subjectName, subjectOptions } from "../../lib/catalog";
import { LEVEL_LABELS, METHODOLOGY_LABELS, PERIOD_LABELS, formatMoney, options } from "../../lib/format";
import { isDemo } from "../../lib/data/source";

export const MATCH_REQUEST_KEY = "edusearch-match-request";

const BUDGETS = [
  { value: "", label: "Sem limite definido" },
  ...[6000, 8000, 10000, 12000].map((c) => ({ value: String(c), label: `Até ${formatMoney(c)} por aula` })),
];

const STEPS = ["Objetivo", "Preferências", "Revisão"] as const;

const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

export default function Matching() {
  const navigate = useNavigate();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<{ goal?: string; subject?: string; level?: string }>({});
  const [form, setForm] = useState({
    goal: "",
    subject: "",
    level: "" as Level | "",
    methodologies: [] as Methodology[],
    periods: [] as DayPeriod[],
    budget: "",
  });

  const go = (next: number) => {
    setStep(next);
    requestAnimationFrame(() => headingRef.current?.focus());
  };

  const validateStep0 = () => {
    const e: typeof errors = {};
    if (form.goal.trim().length < 10) e.goal = "Descreva seu objetivo com pelo menos 10 caracteres.";
    if (!form.subject) e.subject = "Escolha a disciplina.";
    if (!form.level) e.level = "Escolha seu nível.";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = () => {
    const request: MatchRequest = {
      goal: form.goal.trim(),
      subject: form.subject,
      level: form.level as Level,
      methodologies: form.methodologies,
      periods: form.periods,
      maxPriceCents: form.budget ? Number(form.budget) : undefined,
    };
    // O objetivo é texto livre do aluno: trafega no estado da navegação e no
    // sessionStorage (para sobreviver a um recarregamento), nunca na URL.
    try {
      sessionStorage.setItem(MATCH_REQUEST_KEY, JSON.stringify(request));
    } catch {
      /* ignora */
    }
    navigate("/aluno/recomendados", { state: { request } });
  };

  return (
    <>
      <PageHeader
        title="Assistente de matching"
        description="Conte o que você precisa e indicaremos professores compatíveis com seu objetivo e seu jeito de aprender."
        eyebrow={
          <Badge tone="primary" icon={<SparkleIcon />}>
            Matching pedagógico
          </Badge>
        }
      />

      <ol className="mb-6 flex gap-2" aria-label="Etapas">
        {STEPS.map((s, i) => (
          <li key={s} className="flex-1" aria-current={i === step ? "step" : undefined}>
            <span className={`block h-1.5 rounded-full ${i <= step ? "bg-primary" : "bg-surface-muted"}`} aria-hidden="true" />
            <span className={`mt-2 block text-xs font-medium ${i === step ? "text-fg-strong" : "text-fg-muted"}`}>
              {i + 1}. {s}
              {i < step && <span className="sr-only"> (concluída)</span>}
            </span>
          </li>
        ))}
      </ol>

      <Card padding="lg" className="max-w-2xl">
        <h2 ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-fg-strong outline-none">
          {step === 0 && "O que você quer aprender?"}
          {step === 1 && "Como você prefere estudar?"}
          {step === 2 && "Confira antes de buscar"}
        </h2>

        {step === 0 && (
          <div className="mt-5 space-y-5">
            <Textarea
              label="Seu objetivo"
              placeholder="Ex.: Quero melhorar em funções e geometria para o ENEM deste ano."
              hint="Quanto mais contexto, melhores as recomendações."
              rows={4}
              required
              value={form.goal}
              error={errors.goal}
              onChange={(e) => setForm({ ...form, goal: e.target.value })}
            />
            <div className="grid gap-5 sm:grid-cols-2">
              <Select
                label="Disciplina"
                placeholder="Selecione"
                options={subjectOptions}
                required
                value={form.subject}
                error={errors.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
              />
              <Select
                label="Seu nível"
                placeholder="Selecione"
                options={options(LEVEL_LABELS)}
                required
                value={form.level}
                error={errors.level}
                onChange={(e) => setForm({ ...form, level: e.target.value as Level })}
              />
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="mt-5 space-y-6">
            <fieldset>
              <legend className="text-sm font-medium text-fg-strong">Metodologias que funcionam para você</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {options(METHODOLOGY_LABELS).map((o) => (
                  <Chip
                    key={o.value}
                    selected={form.methodologies.includes(o.value)}
                    onClick={() => setForm({ ...form, methodologies: toggle(form.methodologies, o.value) })}
                  >
                    {o.label}
                  </Chip>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="text-sm font-medium text-fg-strong">Períodos disponíveis</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {options(PERIOD_LABELS).map((o) => (
                  <Chip
                    key={o.value}
                    selected={form.periods.includes(o.value)}
                    onClick={() => setForm({ ...form, periods: toggle(form.periods, o.value) })}
                  >
                    {o.label}
                  </Chip>
                ))}
              </div>
            </fieldset>
            <Select
              label="Orçamento"
              options={BUDGETS}
              value={form.budget}
              onChange={(e) => setForm({ ...form, budget: e.target.value })}
            />
          </div>
        )}

        {step === 2 && (
          <dl className="mt-5 divide-y divide-line text-sm">
            {[
              ["Objetivo", form.goal],
              ["Disciplina", subjectName(form.subject)],
              ["Nível", form.level ? LEVEL_LABELS[form.level] : "—"],
              ["Metodologias", form.methodologies.map((m) => METHODOLOGY_LABELS[m]).join(", ") || "Sem preferência"],
              ["Períodos", form.periods.map((p) => PERIOD_LABELS[p]).join(", ") || "Qualquer período"],
              ["Orçamento", BUDGETS.find((b) => b.value === form.budget)?.label ?? "—"],
            ].map(([k, v]) => (
              <div key={k} className="grid gap-1 py-3 sm:grid-cols-[9rem_1fr]">
                <dt className="text-fg-muted">{k}</dt>
                <dd className="font-medium break-words text-fg-strong">{v}</dd>
              </div>
            ))}
          </dl>
        )}

        <div className="mt-8 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          {step > 0 ? (
            <Button variant="ghost" leftIcon={<ArrowLeftIcon className="h-4 w-4" />} onClick={() => go(step - 1)}>
              Voltar
            </Button>
          ) : (
            <span />
          )}
          {step < 2 ? (
            <Button
              rightIcon={<ArrowRightIcon className="h-4 w-4" />}
              onClick={() => {
                if (step === 0 && !validateStep0()) return;
                go(step + 1);
              }}
            >
              Continuar
            </Button>
          ) : (
            <Button leftIcon={<SparkleIcon className="h-4 w-4" />} onClick={submit}>
              Ver professores recomendados
            </Button>
          )}
        </div>
      </Card>

      {isDemo && (
        <DemoNotice className="mt-6 max-w-2xl">
          Nesta demonstração, as recomendações usam regras simples no navegador. A análise com IA (Google Gemini) será feita
          pela API em fase futura.
        </DemoNotice>
      )}
    </>
  );
}
