import { Select, Skeleton } from "@edusearch/ui";
import type { Teacher } from "../lib/api/types";
import { describeError } from "../lib/api/client";
import { dataSource } from "../lib/data/source";
import { useAsync } from "../lib/hooks/useAsync";

/**
 * Escolha do professor fictício cuja visão será exibida na demonstração.
 * A lista vem do DataSource (os mesmos professores da busca).
 */
export function TeacherPicker({
  value,
  onChange,
  label = "Ver a demonstração como",
  hint = "Professores fictícios. As reservas feitas com cada um aparecem na agenda dele.",
}: {
  value: string;
  onChange: (teacher: Teacher) => void;
  label?: string;
  hint?: string;
}) {
  const teachers = useAsync(() => dataSource.searchTeachers({}), []);

  if (teachers.status === "loading") {
    return (
      <div role="status" className="space-y-2">
        <span className="sr-only">Carregando professores…</span>
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-11 w-full" />
      </div>
    );
  }
  if (teachers.status === "error") {
    return (
      <p role="alert" className="text-sm text-danger-text">
        {describeError(teachers.error)}{" "}
        <button type="button" className="font-medium underline" onClick={teachers.reload}>
          Tentar novamente
        </button>
      </p>
    );
  }
  return (
    <Select
      label={label}
      hint={hint}
      options={teachers.data.map((t) => ({ value: t.id, label: `${t.name} — ${t.headline}` }))}
      value={value}
      onChange={(e) => {
        const t = teachers.data.find((x) => x.id === e.target.value);
        if (t) onChange(t);
      }}
    />
  );
}
