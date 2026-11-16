import type { ReactNode } from "react";

type Props = {
  id: string;
  eyebrow: string;
  title: string;
  description?: string;
  dark?: boolean;
  className?: string;
  children: ReactNode;
};

export default function Section({
  id,
  eyebrow,
  title,
  description,
  dark = false,
  className = "",
  children,
}: Props) {
  return (
    <section id={id} aria-labelledby={`${id}-titulo`} className={`py-20 sm:py-28 ${className}`}>
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <div className="max-w-2xl">
          <p
            className={`text-sm font-semibold tracking-wide uppercase ${
              dark ? "text-verde-claro" : "text-petroleo"
            }`}
          >
            {eyebrow}
          </p>
          <h2
            id={`${id}-titulo`}
            className={`mt-3 text-3xl font-semibold tracking-tight sm:text-4xl ${
              dark ? "text-white" : "text-profundo"
            }`}
          >
            {title}
          </h2>
          {description && (
            <p
              className={`mt-4 text-lg leading-relaxed ${dark ? "text-slate-300" : "text-slate-600"}`}
            >
              {description}
            </p>
          )}
        </div>
        <div className="mt-12 sm:mt-16">{children}</div>
      </div>
    </section>
  );
}
