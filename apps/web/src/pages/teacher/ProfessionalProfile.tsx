import { useEffect, useState, type FormEvent } from "react";
import { Button, Card, Chip, Input, Select, Textarea, useToast } from "@edusearch/ui";
import { AsyncContent } from "../../components/AsyncContent";
import { PageHeader } from "../../components/PageHeader";
import { describeError } from "../../lib/api/client";
import type { Methodology, TeacherProfile } from "../../lib/api/types";
import { dataSource } from "../../lib/data/source";
import { METHODOLOGY_LABELS, options } from "../../lib/format";
import { useAsync } from "../../lib/hooks/useAsync";

type Errors = Partial<Record<"name" | "headline" | "bio" | "price" | "methodologies", string>>;

const DURATIONS = [30, 45, 50, 60, 90].map((m) => ({ value: String(m), label: `${m} minutos` }));

function ProfileForm({ initial, onSaved }: { initial: TeacherProfile; onSaved: (p: TeacherProfile) => void }) {
  const toast = useToast();
  const [form, setForm] = useState(initial);
  const [price, setPrice] = useState((initial.priceCents / 100).toFixed(2).replace(".", ","));
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setDirty(JSON.stringify(form) !== JSON.stringify(initial));
  }, [form, initial]);

  const set = <K extends keyof TeacherProfile>(k: K, v: TeacherProfile[K]) => setForm((f) => ({ ...f, [k]: v }));

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const cents = Math.round(Number(price.replace(/\./g, "").replace(",", ".")) * 100);
    const next: Errors = {};
    if (form.name.trim().length < 3) next.name = "Informe seu nome completo.";
    if (form.headline.trim().length < 10) next.headline = "Escreva um título com pelo menos 10 caracteres.";
    if (form.bio.trim().length < 40) next.bio = "Conte um pouco mais sobre você (mínimo de 40 caracteres).";
    if (!Number.isFinite(cents) || cents < 2000 || cents > 100000) next.price = "Informe um valor entre R$ 20,00 e R$ 1.000,00.";
    if (form.methodologies.length === 0) next.methodologies = "Escolha pelo menos uma metodologia.";
    setErrors(next);
    const first = (["name", "headline", "bio", "price"] as const).find((k) => next[k]);
    if (first) {
      (e.currentTarget.elements.namedItem(first) as HTMLElement | null)?.focus();
      return;
    }
    if (next.methodologies) return;

    setSaving(true);
    try {
      const saved = await dataSource.saveTeacherProfile({ ...form, priceCents: cents });
      setForm(saved);
      onSaved(saved);
      toast({ tone: "success", title: "Perfil salvo", description: "Demonstração: as alterações valem até recarregar a página." });
    } catch (err) {
      toast({ tone: "error", title: "Não foi possível salvar", description: describeError(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form noValidate onSubmit={onSubmit} className="space-y-6">
      <Card className="space-y-5">
        <Input name="name" label="Nome de exibição" required value={form.name} error={errors.name} onChange={(e) => set("name", e.target.value)} />
        <Input
          name="headline"
          label="Título profissional"
          hint="Aparece abaixo do seu nome nas buscas."
          required
          maxLength={80}
          value={form.headline}
          error={errors.headline}
          onChange={(e) => set("headline", e.target.value)}
        />
        <Textarea
          name="bio"
          label="Sobre você"
          hint="Como você ensina, para quem e com que foco."
          required
          rows={5}
          maxLength={800}
          value={form.bio}
          error={errors.bio}
          onChange={(e) => set("bio", e.target.value)}
        />
        <Textarea
          name="education"
          label="Formação"
          hint="Uma formação por linha."
          rows={3}
          value={form.education}
          onChange={(e) => set("education", e.target.value)}
        />
      </Card>

      <Card className="space-y-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <Input
            name="price"
            label="Valor por aula (R$)"
            inputMode="decimal"
            required
            value={price}
            error={errors.price}
            onChange={(e) => {
              setPrice(e.target.value);
              setDirty(true);
            }}
            hint="Hipótese de comissão da plataforma: 10%."
          />
          <Select
            label="Duração da aula"
            options={DURATIONS}
            value={String(form.lessonMinutes)}
            onChange={(e) => set("lessonMinutes", Number(e.target.value))}
          />
        </div>
        <fieldset aria-describedby={errors.methodologies ? "metodologias-erro" : undefined}>
          <legend className="text-sm font-medium text-fg-strong">Metodologias</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {options(METHODOLOGY_LABELS).map((o) => (
              <Chip
                key={o.value}
                selected={form.methodologies.includes(o.value)}
                onClick={() =>
                  set(
                    "methodologies",
                    form.methodologies.includes(o.value)
                      ? form.methodologies.filter((m) => m !== o.value)
                      : ([...form.methodologies, o.value] as Methodology[]),
                  )
                }
              >
                {o.label}
              </Chip>
            ))}
          </div>
          {errors.methodologies && (
            <p id="metodologias-erro" className="mt-2 text-sm text-danger-text">
              {errors.methodologies}
            </p>
          )}
        </fieldset>
      </Card>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          variant="secondary"
          disabled={!dirty || saving}
          onClick={() => {
            setForm(initial);
            setPrice((initial.priceCents / 100).toFixed(2).replace(".", ","));
            setErrors({});
            setDirty(false);
          }}
        >
          Descartar alterações
        </Button>
        <Button type="submit" loading={saving}>
          Salvar perfil
        </Button>
      </div>
    </form>
  );
}

export default function ProfessionalProfile() {
  const profile = useAsync(() => dataSource.getTeacherProfile(), []);
  return (
    <>
      <PageHeader title="Perfil profissional" description="É assim que os alunos conhecerão você." />
      <AsyncContent state={profile} reload={profile.reload} loading="spinner">
        {(p) => <ProfileForm initial={p} onSaved={profile.setData} />}
      </AsyncContent>
    </>
  );
}
