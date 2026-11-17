import {
  forwardRef,
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "../lib/cn";
import { AlertIcon, CheckIcon, ChevronDownIcon, EyeIcon, EyeOffIcon } from "./icons";

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

export interface PasswordInputProps extends Omit<InputProps, "type"> {}

/** Senha com botão "mostrar/ocultar" (alvo de 44px, estado anunciado via aria-pressed). */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(function PasswordInput(
  { label, hideLabel, hint, error, required, className, id, leftIcon, ...rest },
  ref,
) {
  const [visible, setVisible] = useState(false);
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
            type={visible ? "text" : "password"}
            required={required}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            autoCapitalize="none"
            spellCheck={false}
            className={controlClasses(invalid, cn("h-11 pr-12", leftIcon ? "pl-10" : undefined))}
            {...rest}
          />
          <button
            type="button"
            aria-label={visible ? "Ocultar senha" : "Mostrar senha"}
            aria-pressed={visible}
            aria-controls={id}
            onClick={() => setVisible((v) => !v)}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-control text-fg-muted transition-colors hover:text-fg-strong"
          >
            {visible ? <EyeOffIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
          </button>
        </div>
      )}
    </Field>
  );
});

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className"> {
  label: ReactNode;
  error?: string;
  className?: string;
}

/** Checkbox estilizado sobre o input nativo (teclado e leitores de tela preservados). */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, error, className, id: idProp, ...rest },
  ref,
) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const errorId = error ? `${id}-erro` : undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed text-fg">
        <span className="relative mt-0.5 inline-flex h-5 w-5 shrink-0">
          <input
            ref={ref}
            id={id}
            type="checkbox"
            aria-invalid={error ? true : undefined}
            aria-describedby={errorId}
            className={cn(
              "peer h-5 w-5 cursor-pointer appearance-none rounded-[0.375rem] border bg-surface transition-colors checked:border-primary checked:bg-primary",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link",
              error ? "border-danger" : "border-line-strong hover:border-fg-muted",
            )}
            {...rest}
          />
          <CheckIcon className="pointer-events-none absolute inset-0 m-auto h-3.5 w-3.5 text-primary-fg opacity-0 transition-opacity peer-checked:opacity-100" />
        </span>
        <span>{label}</span>
      </label>
      {error && (
        <p id={errorId} className="mt-1.5 ml-8 flex items-center gap-1.5 text-sm text-danger-text">
          <AlertIcon className="h-4 w-4 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
});
