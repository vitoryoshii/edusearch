import { Suspense, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link, Outlet } from "react-router";
import { AlertIcon, ArrowLeftIcon, Avatar, Button, Chip, InfoIcon, LoadingState, Logo, ProgressBar } from "@edusearch/ui";
import { useAuth } from "../app/auth";

/** Moldura das telas de boas-vindas e cadastro da conta real (sem menu lateral). */
export function OnboardingLayout() {
  const { profile } = useAuth();
  return (
    <div className="flex min-h-dvh flex-col bg-bg pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <header className="mx-auto flex h-16 w-full max-w-2xl items-center justify-between gap-4 px-5 sm:h-20 sm:px-8">
        <Link to="/conta" aria-label="EduSearch — minha conta" className="rounded-md">
          <Logo className="h-8" />
        </Link>
        {profile && <Avatar name={profile.displayName} src={profile.avatarUrl ?? undefined} size="sm" />}
      </header>
      <main id="conteudo-principal" className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-5 pb-12 sm:px-8">
        <Suspense fallback={<LoadingState label="Carregando…" />}>
          <div className="animate-fade-in">
            <Outlet />
          </div>
        </Suspense>
      </main>
    </div>
  );
}

/** Aviso fixo: o onboarding é uma prévia e nada é enviado ou salvo. */
export function PreviewNotice() {
  return (
    <p className="flex items-start gap-2.5 rounded-card bg-surface-muted px-4 py-3 text-sm text-fg" data-testid="onboarding-preview-notice">
      <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-link" />
      <span>
        <strong className="font-semibold text-fg-strong">Prévia do cadastro.</strong> Suas respostas ficam só nesta tela: nada é
        enviado nem salvo até a API de perfis estar disponível. Ao sair, elas são descartadas.
      </span>
    </p>
  );
}

/* ------------------------------- Seleção por chips ------------------------------- */

export function ChipGroup<T extends string | number>({
  label,
  hint,
  options,
  selected,
  onToggle,
}: {
  label: string;
  hint?: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  selected: readonly T[];
  onToggle: (value: T) => void;
}) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={`${id}-l`} aria-describedby={hint ? `${id}-h` : undefined}>
      <p id={`${id}-l`} className="text-sm font-medium text-fg-strong">
        {label}
      </p>
      {hint && (
        <p id={`${id}-h`} className="mt-0.5 text-sm text-fg-muted">
          {hint}
        </p>
      )}
      <div className="mt-2.5 flex flex-wrap gap-2">
        {options.map((o) => (
          <Chip key={String(o.value)} selected={selected.includes(o.value)} onClick={() => onToggle(o.value)}>
            {o.label}
          </Chip>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------- Fluxo em etapas --------------------------------- */

export type FlowStep = {
  id: string;
  title: string;
  description?: string;
  content: ReactNode;
  /** Motivo para não avançar (null = etapa completa). */
  issue: string | null;
};

/**
 * Etapas curtas e progressivas. Acessibilidade: o título de cada etapa recebe
 * o foco ao avançar/voltar; "Continuar" explica o que falta (role=alert) em vez
 * de ficar silenciosamente desabilitado.
 */
export function OnboardingFlow({
  label,
  steps,
  backTo,
  finish,
}: {
  label: string;
  steps: FlowStep[];
  backTo: { to: string; label: string };
  /** Conteúdo do rodapé na última etapa (ex.: "Salvar perfil" bloqueado). */
  finish: ReactNode;
}) {
  const [index, setIndex] = useState(0);
  const [blocked, setBlocked] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const step = steps[index]!;
  const last = index === steps.length - 1;

  useEffect(() => {
    if (!moved.current) return;
    heading.current?.focus();
    window.scrollTo(0, 0);
  }, [index]);

  const go = (to: number) => {
    moved.current = true;
    setBlocked(null);
    setIndex(to);
  };
  const next = () => {
    if (step.issue) {
      setBlocked(step.issue);
      return;
    }
    go(index + 1);
  };

  return (
    <section aria-label={label} data-step={step.id} className="flex flex-1 flex-col">
      <div className="flex items-center justify-between gap-4 text-sm">
        {index === 0 ? (
          <Link to={backTo.to} className="inline-flex min-h-11 items-center gap-1.5 font-medium text-fg-muted hover:text-link">
            <ArrowLeftIcon className="h-4 w-4" />
            {backTo.label}
          </Link>
        ) : (
          <button type="button" onClick={() => go(index - 1)} className="inline-flex min-h-11 items-center gap-1.5 font-medium text-fg-muted hover:text-link">
            <ArrowLeftIcon className="h-4 w-4" />
            Voltar
          </button>
        )}
        <span className="font-medium text-fg-muted" aria-live="polite">
          Etapa {index + 1} de {steps.length}
        </span>
      </div>
      <div className="mt-2">
        <ProgressBar value={index + 1} max={steps.length} label={`${label}: etapa ${index + 1} de ${steps.length}`} showValue={false} />
      </div>

      <h1 ref={heading} tabIndex={-1} className="mt-8 text-2xl font-semibold tracking-tight text-balance text-fg-strong outline-none sm:text-3xl">
        {step.title}
      </h1>
      {step.description && <p className="mt-2 text-fg-muted">{step.description}</p>}

      <div className="mt-8 flex-1 space-y-7">{step.content}</div>

      <div className="sticky bottom-0 -mx-5 mt-10 border-t border-line bg-bg/95 px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:pb-0 sm:backdrop-blur-none">
        {blocked && (
          <p role="alert" className="mb-3 flex items-start gap-2 text-sm text-danger-text">
            <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
            {blocked}
          </p>
        )}
        {last ? (
          finish
        ) : (
          <Button size="lg" fullWidth className="sm:w-auto sm:min-w-48" onClick={next}>
            Continuar
          </Button>
        )}
      </div>
    </section>
  );
}

/** Lista de revisão (termo + valor). */
export function ReviewList({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="divide-y divide-line rounded-card border border-line bg-surface">
      {items.map((i) => (
        <div key={i.label} className="grid gap-1 px-4 py-3 sm:grid-cols-[11rem_1fr] sm:gap-4">
          <dt className="text-sm text-fg-muted">{i.label}</dt>
          <dd className="text-sm font-medium break-words text-fg-strong">{i.value || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Botão final bloqueado: sem API de perfis, não há como salvar com segurança. */
export function SaveBlocked() {
  return (
    <div>
      <Button size="lg" fullWidth className="sm:w-auto sm:min-w-48" disabled aria-describedby="salvar-indisponivel">
        Salvar perfil
      </Button>
      <p id="salvar-indisponivel" className="mt-2 text-sm text-fg-muted">
        Disponível quando a API de perfis, as autorizações do servidor e os documentos jurídicos estiverem publicados.
      </p>
    </div>
  );
}
