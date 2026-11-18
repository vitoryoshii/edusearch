import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { ArrowLeftIcon, ArrowRightIcon, Button, Card, Chip, Select, SparkleIcon, Textarea } from "@edusearch/ui";
import { DemoNotice } from "../../components/DemoNotice";
import { PageHeader } from "../../components/PageHeader";
import type { DayPeriod, Difficulty, Level, MatchRequest, Methodology } from "../../lib/api/types";
import { subjectName, subjectOptions } from "../../lib/catalog";
import { DIFFICULTY_LABELS, LEVEL_LABELS, METHODOLOGY_LABELS, PERIOD_LABELS, formatMoney, options } from "../../lib/format";
import { isDemo } from "../../lib/data/source";

export const MATCH_REQUEST_KEY = "edusearch-match-request";

const BUDGETS = [
  { value: "", label: "Sem limite definido" },
  ...[6000, 8000, 10000, 12000].map((c) => ({ value: String(c), label: `Até ${formatMoney(c)} por aula` })),
];

const STEPS = ["Objetivo", "Preferências", "Revisão"] as const;

const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

/** Pergunta do assistente (a pergunta atual é o título da etapa e recebe o foco). */
function AssistantBubble({
  children,
  current,
  headingRef,
}: {
  children: React.ReactNode;
  current?: boolean;
  headingRef?: React.RefObject<HTMLHeadingElement | null>;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-soft text-link" aria-hidden="true">
        <SparkleIcon className="h-4 w-4" />
      </span>
      {current ? (
        <h2 ref={headingRef} tabIndex={-1} className="rounded-2xl rounded-tl-md bg-surface px-4 py-2.5 text-base font-semibold text-fg-strong shadow-card outline-none">
          {children}
        </h2>
      ) : (
        <p className="rounded-2xl rounded-tl-md bg-surface px-4 py-2.5 text-sm font-medium text-fg-strong shadow-card">{children}</p>
      )}
    </div>
  );
}

/** Resposta do aluno já enviada. */
function UserBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[85%] rounded-2xl rounded-tr-md bg-soft px-4 py-2.5 text-sm break-words text-fg-strong">
        <span className="sr-only">Sua resposta: </span>
        {children}
      </p>
    </div>
  );
}

export default function Matching() {
  const navigate = useNavigate();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<{ goal?: string; subject?: string; level?: string; difficulties?: string }>({});
  const [form, setForm] = useState({
    goal: "",
    subject: "",
    level: "" as Level | "",
    difficulties: [] as Difficulty[],
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
    if (!form.difficulties.length) e.difficulties = "Escolha pelo menos uma dificuldade.";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = () => {
    const request: MatchRequest = {
      goal: form.goal.trim(),
      subject: form.subject,
      level: form.level as Level,
      methodologies: form.methodologies,
      difficulties: form.difficulties,
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
      <PageHeader title="Assistente EduSearch" />

      <div className="mx-auto max-w-2xl">
        {/* Apresentação como no mockup aprovado */}
        <div className="text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-panel bg-soft text-link shadow-card">
            <SparkleIcon className="h-7 w-7" />
          </span>
          <p className="mt-4 text-xl font-semibold text-fg-strong">Como posso te ajudar?</p>
          <p className="mt-1 text-sm text-fg-muted">Encontre o professor ideal para o seu objetivo em três passos.</p>
        </div>

        <ol className="mt-6 mb-6 flex gap-2" aria-label="Etapas">
          {STEPS.map((st, i) => (
            <li key={st} className="flex-1" aria-current={i === step ? "step" : undefined}>
              <span className={`block h-1 rounded-full ${i <= step ? "bg-primary" : "bg-surface-muted"}`} aria-hidden="true" />
              <span className={`mt-1.5 block text-xs font-medium ${i === step ? "text-fg-strong" : "text-fg-muted"}`}>
                {i + 1}. {st}
                {i < step && <span className="sr-only"> (concluída)</span>}
              </span>
            </li>
          ))}
        </ol>

        {/* Conversa: perguntas do assistente à esquerda, respostas do aluno à direita */}
        <div className="space-y-3">
          <AssistantBubble current={step === 0} headingRef={step === 0 ? headingRef : undefined}>
            O que você quer aprender?
          </AssistantBubble>
          {step > 0 && (
            <UserBubble>
              {form.goal.trim()}
              <span className="mt-1 block text-xs text-fg-muted">
                {subjectName(form.subject)} · {form.level ? LEVEL_LABELS[form.level] : ""} · {form.difficulties.map((d) => DIFFICULTY_LABELS[d].toLowerCase()).join(", ")}
              </span>
            </UserBubble>
          )}
          {step >= 1 && (
            <AssistantBubble current={step === 1} headingRef={step === 1 ? headingRef : undefined}>
              Como você prefere estudar?
            </AssistantBubble>
          )}
          {step > 1 && (
            <UserBubble>
              {[
                form.methodologies.map((m) => METHODOLOGY_LABELS[m]).join(", ") || "Sem preferência de metodologia",
                form.periods.map((pp) => PERIOD_LABELS[pp]).join(", ") || "Qualquer período",
                BUDGETS.find((bb) => bb.value === form.budget)?.label ?? "",
              ].join(" · ")}
            </UserBubble>
          )}
          {step === 2 && (
            <AssistantBubble current headingRef={headingRef}>
              Confira antes de buscar
            </AssistantBubble>
          )}
        </div>

      <Card padding="lg" className="mt-4">
        {step === 0 && (
          <div className="space-y-5">
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
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
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
            <fieldset aria-describedby={errors.difficulties ? "dificuldades-erro" : "dificuldades-dica"}>
              <legend className="text-sm font-medium text-fg-strong">
                Principais dificuldades<span className="text-danger-text" aria-hidden="true"> *</span>
              </legend>
              <p id="dificuldades-dica" className="mt-0.5 text-sm text-fg-muted">
                Escolha uma ou mais.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {options(DIFFICULTY_LABELS).map((o) => (
                  <Chip
                    key={o.value}
                    selected={form.difficulties.includes(o.value)}
                    onClick={() => {
                      setForm({ ...form, difficulties: toggle(form.difficulties, o.value) });
                      setErrors((er) => ({ ...er, difficulties: undefined }));
                    }}
                  >
                    {o.label}
                  </Chip>
                ))}
              </div>
              {errors.difficulties && (
                <p id="dificuldades-erro" role="alert" className="mt-2 text-sm text-danger-text">
                  {errors.difficulties}
                </p>
              )}
            </fieldset>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-6">
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
          <dl className="divide-y divide-line text-sm">
            {[
              ["Objetivo", form.goal],
              ["Disciplina", subjectName(form.subject)],
              ["Nível", form.level ? LEVEL_LABELS[form.level] : "—"],
              ["Dificuldades", form.difficulties.map((d) => DIFFICULTY_LABELS[d]).join(", ")],
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
        <DemoNotice className="mt-6">
          Nesta demonstração, as recomendações usam regras simples no navegador. A análise com IA (Google Gemini) será feita
          pela API em fase futura.
        </DemoNotice>
      )}
      </div>
    </>
  );
}
