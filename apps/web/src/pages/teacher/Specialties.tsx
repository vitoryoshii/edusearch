import { useState } from "react";
import { Badge, Button, Card, Chip, EmptyState, GraduationIcon, IconButton, PlusIcon, Select, TrashIcon, useToast } from "@edusearch/ui";
import { AsyncContent } from "../../components/AsyncContent";
import { PageHeader, SectionTitle } from "../../components/PageHeader";
import { describeError } from "../../lib/api/client";
import type { Level, Specialty } from "../../lib/api/types";
import { subjectName, subjectOptions } from "../../lib/catalog";
import { dataSource } from "../../lib/data/source";
import { LEVEL_LABELS, options } from "../../lib/format";
import { useAsync } from "../../lib/hooks/useAsync";

function Editor({ initial, onSaved }: { initial: Specialty[]; onSaved: (s: Specialty[]) => void }) {
  const toast = useToast();
  const [items, setItems] = useState(initial);
  const [subject, setSubject] = useState("");
  const [levels, setLevels] = useState<Level[]>([]);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const available = subjectOptions.filter((o) => !items.some((i) => i.subject === o.value));

  const add = () => {
    if (!subject) return setError("Escolha a disciplina.");
    if (!levels.length) return setError("Escolha pelo menos um nível.");
    setItems([...items, { subject, levels }]);
    setSubject("");
    setLevels([]);
    setError(undefined);
  };

  const save = async () => {
    setSaving(true);
    try {
      const saved = await dataSource.saveSpecialties(items);
      onSaved(saved);
      toast({ tone: "success", title: "Especialidades salvas" });
    } catch (e) {
      toast({ tone: "error", title: "Não foi possível salvar", description: describeError(e) });
    } finally {
      setSaving(false);
    }
  };

  const changed = JSON.stringify(items) !== JSON.stringify(initial);

  return (
    <div className="space-y-8">
      <section aria-labelledby="minhas-especialidades">
        <SectionTitle id="minhas-especialidades">Suas especialidades</SectionTitle>
        {items.length === 0 ? (
          <EmptyState
            icon={<GraduationIcon />}
            title="Nenhuma especialidade cadastrada"
            description="Adicione as disciplinas e níveis que você ensina para aparecer nas buscas."
          />
        ) : (
          <ul className="grid gap-3">
            {items.map((it) => (
              <li key={it.subject}>
                <Card padding="sm" className="flex items-start justify-between gap-3 sm:px-5">
                  <div>
                    <p className="font-semibold text-fg-strong">{subjectName(it.subject)}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {it.levels.map((l) => (
                        <Badge key={l}>{LEVEL_LABELS[l]}</Badge>
                      ))}
                    </div>
                  </div>
                  <IconButton
                    label={`Remover ${subjectName(it.subject)}`}
                    onClick={() => setItems(items.filter((x) => x.subject !== it.subject))}
                  >
                    <TrashIcon className="h-5 w-5" />
                  </IconButton>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="adicionar-especialidade">
        <SectionTitle id="adicionar-especialidade">Adicionar especialidade</SectionTitle>
        <Card className="space-y-5">
          <Select
            label="Disciplina"
            placeholder={available.length ? "Selecione" : "Todas as disciplinas já foram adicionadas"}
            options={available}
            disabled={!available.length}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
          <fieldset>
            <legend className="text-sm font-medium text-fg-strong">Níveis</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {options(LEVEL_LABELS).map((o) => (
                <Chip
                  key={o.value}
                  selected={levels.includes(o.value)}
                  onClick={() => setLevels(levels.includes(o.value) ? levels.filter((l) => l !== o.value) : [...levels, o.value])}
                >
                  {o.label}
                </Chip>
              ))}
            </div>
          </fieldset>
          {error && (
            <p role="alert" className="text-sm text-danger-text">
              {error}
            </p>
          )}
          <Button variant="secondary" leftIcon={<PlusIcon className="h-4 w-4" />} onClick={add} disabled={!available.length}>
            Adicionar
          </Button>
        </Card>
      </section>

      <div className="flex justify-end">
        <Button onClick={save} loading={saving} disabled={!changed}>
          Salvar especialidades
        </Button>
      </div>
    </div>
  );
}

export default function Specialties() {
  const data = useAsync(() => dataSource.listSpecialties(), []);
  return (
    <>
      <PageHeader title="Especialidades" description="Disciplinas e níveis em que você dá aulas." />
      <AsyncContent state={data} reload={data.reload} loading="spinner">
        {(items) => <Editor initial={items} onSaved={data.setData} />}
      </AsyncContent>
    </>
  );
}
