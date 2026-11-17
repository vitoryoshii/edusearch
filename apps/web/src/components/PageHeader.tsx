import type { ReactNode } from "react";
import { Link } from "react-router";
import { ArrowLeftIcon } from "@edusearch/ui";

export function PageHeader({
  title,
  description,
  back,
  actions,
  eyebrow,
}: {
  title: string;
  description?: ReactNode;
  back?: { to: string; label: string };
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="mb-6 sm:mb-8">
      {back && (
        <Link
          to={back.to}
          className="-ml-1 mb-3 inline-flex min-h-9 items-center gap-1.5 rounded-md px-1 text-sm font-medium text-fg-muted hover:text-link"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          {back.label}
        </Link>
      )}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {eyebrow && <div className="mb-2">{eyebrow}</div>}
          <h1 className="text-2xl font-semibold tracking-tight text-balance text-fg-strong sm:text-3xl">{title}</h1>
          {description && <p className="mt-1.5 max-w-2xl text-fg-muted">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function SectionTitle({ children, action, id }: { children: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-4">
      <h2 id={id} className="text-base font-semibold text-fg-strong">
        {children}
      </h2>
      {action}
    </div>
  );
}
