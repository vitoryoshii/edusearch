import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "soft";
export type ButtonSize = "sm" | "md" | "lg";

const variants: Record<ButtonVariant, string> = {
  // Gradiente moderado do mockup aprovado: petróleo → esmeralda (texto branco ≥ 4,67:1 em todo o gradiente).
  primary:
    "bg-primary bg-gradient-to-r from-petroleo to-esmeralda text-primary-fg shadow-card hover:from-petroleo-dark hover:to-[#0e6e5c]",
  secondary: "border border-line-strong bg-surface text-fg-strong hover:border-link hover:text-link",
  ghost: "text-fg-strong hover:bg-surface-muted",
  soft: "bg-primary-soft text-link hover:bg-soft",
  danger: "border border-line-strong bg-surface text-danger-text hover:border-danger hover:bg-danger-soft",
};

const sizes: Record<ButtonSize, string> = {
  sm: "min-h-9 gap-1.5 px-3 text-sm",
  md: "min-h-11 gap-2 px-4 text-sm",
  lg: "min-h-12 gap-2 px-6 text-base",
};

/**
 * Classes do botão, para aplicar o mesmo visual em links (<a>, <Link>).
 * Altura mínima de 36px (sm) e 44px (md/lg) para alvos de toque (WCAG 2.5.8).
 */
export function buttonClasses({
  variant = "primary",
  size = "md",
  fullWidth = false,
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
} = {}) {
  return cn(
    "inline-flex shrink-0 items-center justify-center rounded-control text-center font-semibold transition-[background-color,border-color,color,transform] duration-150 select-none active:translate-y-px",
    "disabled:pointer-events-none disabled:opacity-55 aria-disabled:pointer-events-none aria-disabled:opacity-55",
    variants[variant],
    sizes[size],
    fullWidth && "w-full",
    className,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    fullWidth,
    loading = false,
    leftIcon,
    rightIcon,
    className,
    disabled,
    children,
    type = "button",
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses({ variant, size, fullWidth, className })}
      {...rest}
    >
      {loading ? <Spinner className="h-4 w-4" /> : leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Rótulo acessível obrigatório: o botão não tem texto visível. */
  label: string;
  variant?: "ghost" | "secondary";
  size?: "sm" | "md";
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, variant = "ghost", size = "md", className, children, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-control text-fg-strong transition-colors",
        size === "md" ? "h-11 w-11" : "h-9 w-9",
        variant === "ghost"
          ? "hover:bg-surface-muted"
          : "border border-line-strong bg-surface hover:border-link hover:text-link",
        "disabled:pointer-events-none disabled:opacity-55",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
