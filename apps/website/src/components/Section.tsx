import type { ReactNode } from "react";
import { cn } from "@edusearch/ui";

type Props = {
  id: string;
  eyebrow: string;
  title: string;
  description?: string;
  /** Seção sobre o azul profundo da marca (independe do tema). */
  dark?: boolean;
  className?: string;
  children: ReactNode;
};

export default function Section({ id, eyebrow, title, description, dark = false, className, children }: Props) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-titulo`}
      className={cn("py-20 sm:py-28", dark && "bg-profundo", className)}
    >
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <div className="max-w-2xl">
          <p
            className={cn(
              "text-sm font-semibold tracking-wide uppercase",
              dark ? "text-verde-claro" : "text-link",
            )}
          >
            {eyebrow}
          </p>
          <h2
            id={`${id}-titulo`}
            className={cn(
              "mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl",
              dark ? "text-white" : "text-fg-strong",
            )}
          >
            {title}
          </h2>
          {description && (
            <p className={cn("mt-4 text-lg leading-relaxed text-pretty", dark ? "text-slate-300" : "text-fg")}>
              {description}
            </p>
          )}
        </div>
        <div className="mt-12 sm:mt-16">{children}</div>
      </div>
    </section>
  );
}
