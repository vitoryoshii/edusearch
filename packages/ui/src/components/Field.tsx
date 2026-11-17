import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "../lib/cn";
import { AlertIcon, ChevronDownIcon } from "./icons";

type FieldBaseProps = {
  label: string;
  /** Oculta o rótulo visualmente, mantendo-o para leitores de tela. */
  hideLabel?: boolean;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  className?: string;
};

type FieldRenderProps = { id: string; describedBy: string | undefined; invalid: boolean };

/** Estrutura comum (rótulo, dica e erro) com as ligações ARIA corretas. */
export function Field({
  label,
  hideLabel,
  hint,
  error,
  required,
  className,
  id: idProp,
  children,
}: FieldBaseProps & { id?: string; children: (p: FieldRenderProps) => ReactNode }) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const hintId = hint ? `${id}-dica` : undefined;
  const errorId = error ? `${id}-erro` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className={cn("text-sm font-medium text-fg-strong", hideLabel && "sr-only")}>
        {label}
        {required && (
          <span className="text-danger-text" aria-hidden="true">
            {" *"}
          </span>
        )}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {hint && (
        <p id={hintId} className="text-sm text-fg-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="flex items-center gap-1.5 text-sm text-danger-text">
          <AlertIcon className="h-4 w-4 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

/** Classes base dos controles de formulário (16px no mobile evita zoom no iOS). */
export const controlClasses = (invalid?: boolean, extra?: string) =>
  cn(
    "w-full rounded-control border bg-surface px-3.5 text-base text-fg-strong placeholder:text-fg-muted transition-colors sm:text-sm",
    "focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-link",
    "disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-fg-muted",
    invalid ? "border-danger" : "border-line-strong hover:border-fg-muted",
    extra,
  );

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "className">, FieldBaseProps {
  leftIcon?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hideLabel, hint, error, required, className, id, leftIcon, ...rest },
  ref,
) {
  return (
    <Field {...{ label, hideLabel, hint, error, required, className, id }}>
      {({ id, describedBy, invalid }) => (
        <div className="relative">
          {leftIcon && (
            <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-fg-muted [&>svg]:h-4.5 [&>svg]:w-4.5">
              {leftIcon}
            </span>
          )}
          <input
            ref={ref}
            id={id}
            required={required}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className={controlClasses(invalid, cn("h-11", leftIcon ? "pl-10" : undefined))}
            {...rest}
          />
        </div>
      )}
    </Field>
  );
});

export interface TextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className">,
    FieldBaseProps {}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hideLabel, hint, error, required, className, id, rows = 4, ...rest },
  ref,
) {
  return (
    <Field {...{ label, hideLabel, hint, error, required, className, id }}>
      {({ id, describedBy, invalid }) => (
        <textarea
          ref={ref}
          id={id}
          rows={rows}
          required={required}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={controlClasses(invalid, "resize-y py-2.5 leading-relaxed")}
          {...rest}
        />
      )}
    </Field>
  );
});

export type SelectOption = { value: string; label: string; disabled?: boolean };

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "className">, FieldBaseProps {
  options: readonly SelectOption[];
  placeholder?: string;
}

/** Select nativo estilizado: acessível por padrão e confiável em mobile. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hideLabel, hint, error, required, className, id, options, placeholder, ...rest },
  ref,
) {
  return (
    <Field {...{ label, hideLabel, hint, error, required, className, id }}>
      {({ id, describedBy, invalid }) => (
        <div className="relative">
          <select
            ref={ref}
            id={id}
            required={required}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className={controlClasses(invalid, "h-11 appearance-none pr-10")}
            {...rest}
          >
            {placeholder !== undefined && <option value="">{placeholder}</option>}
            {options.map((o) => (
              <option key={o.value} value={o.value} disabled={o.disabled}>
                {o.label}
              </option>
            ))}
          </select>
          <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-3.5 h-4 w-4 -translate-y-1/2 text-fg-muted" />
        </div>
      )}
    </Field>
  );
});
