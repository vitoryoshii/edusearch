import { useState, type FormEvent } from "react";
import { Avatar, Button, Card, Input, Select, Textarea, useToast } from "@edusearch/ui";
import { useSession } from "../../app/session";
import { PageHeader, SectionTitle } from "../../components/PageHeader";
import { SettingsPanel } from "../../components/SettingsPanel";
import type { Level } from "../../lib/api/types";
import { LEVEL_LABELS, options } from "../../lib/format";

export default function StudentProfile() {
  const { session, signIn } = useSession();
  const toast = useToast();
  const [name, setName] = useState(session?.name ?? "");
  const [level, setLevel] = useState<Level | "">("pre-vestibular");
  const [goal, setGoal] = useState("Preparação para o ENEM, com foco em Matemática e Redação.");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2) {
      setError("Informe seu nome.");
      return;
    }
    setError(undefined);
    setSaving(true);
    window.setTimeout(() => {
      signIn({ role: "student", name: name.trim() });
      setSaving(false);
      toast({ tone: "success", title: "Perfil atualizado", description: "Demonstração: salvo apenas nesta sessão." });
    }, 500);
  };

  return (
    <>
      <PageHeader title="Perfil e configurações" />
      <div className="space-y-8">
        <section aria-labelledby="dados-pessoais">
          <SectionTitle id="dados-pessoais">Seus dados</SectionTitle>
          <Card>
            <form onSubmit={onSubmit} noValidate className="space-y-5">
              <div className="flex items-center gap-4">
                <Avatar name={name || "?"} size="lg" />
                <p className="text-sm text-fg-muted">A foto de perfil virá da sua conta Google após a integração.</p>
              </div>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Input label="Nome" required value={name} error={error} onChange={(e) => setName(e.target.value)} autoComplete="name" />
                <Select
                  label="Nível de estudo"
                  options={options(LEVEL_LABELS)}
                  value={level}
                  onChange={(e) => setLevel(e.target.value as Level)}
                />
              </div>
              <Textarea
                label="Objetivo principal"
                hint="Usado para personalizar recomendações."
                rows={3}
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
              />
              <div className="flex justify-end">
                <Button type="submit" loading={saving}>
                  Salvar alterações
                </Button>
              </div>
            </form>
          </Card>
        </section>
        <SettingsPanel role="student" />
      </div>
    </>
  );
}
