import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn";
import { CheckIcon } from "./icons";

/* ---------------------------------- Card ---------------------------------- */

export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: "div" | "section" | "article" | "li" | "aside";
  padding?: "none" | "sm" | "md" | "lg";
  /** Realce sutil ao passar o mouse (use quando o card inteiro é clicável). */
  interactive?: boolean;
  tone?: "default" | "soft" | "muted";
}

const paddings = { none: "", sm: "p-4", md: "p-5 sm:p-6", lg: "p-6 sm:p-8" } as const;
const tones = {
  default: "border-line bg-surface",
  soft: "border-transparent bg-soft",
  muted: "border-line bg-surface-muted",
} as const;

export function Card({
  as: Tag = "div",
  padding = "md",
  interactive = false,
  tone = "default",
  className,
  ...rest
}: CardProps) {
  return (
    <Tag
      className={cn(
        "rounded-card border shadow-card",
        tones[tone],
        paddings[padding],
        interactive &&
          "relative transition-[border-color,box-shadow] duration-150 hover:border-line-strong hover:shadow-raised focus-within:border-line-strong",
        className,
      )}
      {...rest}
    />
  );
}

/* ---------------------------------- Badge --------------------------------- */

export type BadgeTone = "neutral" | "primary" | "success" | "warning" | "danger" | "demo";

const badgeTones: Record<BadgeTone, string> = {
  neutral: "bg-surface-muted text-fg",
  primary: "bg-primary-soft text-link",
  success: "bg-success-soft text-success-text",
  warning: "bg-warning-soft text-warning-text",
  danger: "bg-danger-soft text-danger-text",
  demo: "border border-dashed border-line-strong bg-surface text-fg-muted",
};

const dotTones: Record<BadgeTone, string> = {
  neutral: "bg-fg-muted",
  primary: "bg-link",
  success: "bg-success",
  warning: "bg-warning-text",
  danger: "bg-danger",
  demo: "bg-fg-muted",
};

export function Badge({
  tone = "neutral",
  dot = false,
  icon,
  className,
  children,
}: {
  tone?: BadgeTone;
  dot?: boolean;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap [&>svg]:h-3.5 [&>svg]:w-3.5",
        badgeTones[tone],
        className,
      )}
    >
      {dot && <span className={cn("h-1.5 w-1.5 rounded-full", dotTones[tone])} aria-hidden="true" />}
      {icon}
      {children}
    </span>
  );
}

/* --------------------------------- Avatar --------------------------------- */

const avatarSizes = { sm: "h-9 w-9 text-xs", md: "h-12 w-12 text-sm", lg: "h-16 w-16 text-lg", xl: "h-24 w-24 text-2xl" } as const;
const avatarTints = [
  "bg-primary-soft text-link",
  "bg-soft text-success-text",
  "bg-surface-muted text-fg-strong",
] as const;

function initials(name: string) {
  const parts = name
    .replace(/^(Prof(a)?\.?)\s+/i, "")
    .split(/\s+/)
    .filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/**
 * Avatar com iniciais. Não usa fotos de pessoas: os dados de demonstração
 * são fictícios e não devem parecer perfis reais.
 */
export function Avatar({
  name,
  src,
  size = "md",
  className,
  decorative = true,
}: {
  name: string;
  src?: string;
  size?: keyof typeof avatarSizes;
  className?: string;
  /** Quando o nome já aparece ao lado, o avatar é decorativo. */
  decorative?: boolean;
}) {
  const tint = avatarTints[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % avatarTints.length];
  const common = cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold", avatarSizes[size], className);
  if (src) {
    return <img src={src} alt={decorative ? "" : name} className={cn(common, "object-cover")} />;
  }
  return (
    <span className={cn(common, tint)} {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": name })}>
      {initials(name)}
    </span>
  );
}

/* ---------------------------------- Chip ---------------------------------- */

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
}

/** Botão de alternância (aria-pressed) para filtros e seleções rápidas. */
export function Chip({ selected = false, className, children, type = "button", ...rest }: ChipProps) {
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={cn(
        "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors",
        selected
          ? "border-primary bg-primary text-primary-fg"
          : "border-line-strong bg-surface text-fg-strong hover:border-link hover:text-link",
        className,
      )}
      {...rest}
    >
      {selected && <CheckIcon className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}

/* --------------------------------- Switch --------------------------------- */

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <label className={cn("flex items-start justify-between gap-4", disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer")}>
      <span>
        <span className="block text-sm font-medium text-fg-strong">{label}</span>
        {description && <span className="mt-0.5 block text-sm text-fg-muted">{description}</span>}
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input
          type="checkbox"
          role="switch"
          className="peer sr-only"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span
          aria-hidden="true"
          className="h-6 w-11 rounded-full bg-line-strong transition-colors peer-checked:bg-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-link"
        />
        <span
          aria-hidden="true"
          className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-card transition-transform peer-checked:translate-x-5"
        />
      </span>
    </label>
  );
}

/* ------------------------------- ProgressBar ------------------------------ */

export function ProgressBar({
  value,
  max = 100,
  label,
  showValue = true,
  tone = "primary",
}: {
  value: number;
  max?: number;
  label: string;
  showValue?: boolean;
  tone?: "primary" | "success";
}) {
  const pct = Math.max(0, Math.min(100, Math.round((value / max) * 100)));
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
        <span className="font-medium text-fg-strong">{label}</span>
        {showValue && <span className="text-fg-muted tabular-nums">{pct}%</span>}
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-2 overflow-hidden rounded-full bg-surface-muted"
      >
        <div
          className={cn("h-full rounded-full transition-[width] duration-500", tone === "success" ? "bg-success" : "bg-primary")}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/* --------------------------------- Skeleton ------------------------------- */

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("animate-pulse-soft rounded-control bg-surface-muted", className)} />;
}

/* -------------------------------- Divider --------------------------------- */

export function Divider({ className }: { className?: string }) {
  return <hr className={cn("border-line", className)} />;
}
