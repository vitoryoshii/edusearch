import { useState } from "react";
import { useNavigate } from "react-router";
import { Button, GraduationIcon, UsersIcon, cn } from "@edusearch/ui";
import { homeFor, studentSession, teacherSession, useSession } from "../../app/session";
import { TeacherPicker } from "../../components/TeacherPicker";
import { DEMO_TEACHER_ID, DEMO_TEACHER_NAME } from "../../lib/demo";
import type { Role } from "../../lib/api/types";

const ROLES: Array<{ value: Role; title: string; text: string; icon: typeof UsersIcon }> = [
  {
    value: "student",
    title: "Quero aprender",
    text: "Encontre professores compatíveis, agende aulas e acompanhe sua evolução.",
    icon: GraduationIcon,
  },
  {
    value: "teacher",
    title: "Quero ensinar",
    text: "Monte seu perfil, defina sua disponibilidade e organize suas aulas.",
    icon: UsersIcon,
  },
];

export default function ChooseRole() {
  const [role, setRole] = useState<Role>("student");
  const [teacher, setTeacher] = useState({ id: DEMO_TEACHER_ID, name: DEMO_TEACHER_NAME });
  const { pendingName, setPendingName, signIn } = useSession();
  const navigate = useNavigate();

  const onContinue = () => {
    // Aluno usa o nome do cadastro demonstrativo; professor usa o professor fictício escolhido.
    signIn(role === "student" ? studentSession(pendingName || "Ana") : teacherSession(teacher));
    setPendingName(null);
    navigate(homeFor(role), { replace: true });
  };

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-5 py-8 sm:px-8 sm:py-14">
      <h1 className="text-2xl font-semibold text-balance text-fg-strong sm:text-3xl">
        {pendingName ? `${pendingName}, como você quer usar o EduSearch?` : "Como você quer usar o EduSearch?"}
      </h1>
      <p className="mt-2 text-fg-muted">Você pode trocar de perfil depois, nas configurações.</p>

      <fieldset className="mt-8">
        <legend className="sr-only">Perfil de acesso</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {ROLES.map((r) => {
            const selected = role === r.value;
            return (
              <label
                key={r.value}
                className={cn(
                  "relative flex cursor-pointer flex-col rounded-panel border-2 bg-surface p-6 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-link",
                  selected ? "border-primary" : "border-line hover:border-line-strong",
                )}
              >
                <input
                  type="radio"
                  name="perfil"
                  value={r.value}
                  checked={selected}
                  onChange={() => setRole(r.value)}
                  className="sr-only"
                />
                <span
                  className={cn(
                    "flex h-12 w-12 items-center justify-center rounded-control",
                    selected ? "bg-primary text-primary-fg" : "bg-primary-soft text-link",
                  )}
                >
                  <r.icon className="h-6 w-6" />
                </span>
                <span className="mt-5 text-lg font-semibold text-fg-strong">{r.title}</span>
                <span className="mt-1 text-sm leading-relaxed text-fg-muted">{r.text}</span>
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute top-5 right-5 h-5 w-5 rounded-full border-2",
                    selected ? "border-primary bg-primary shadow-[inset_0_0_0_3px_var(--es-surface)]" : "border-line-strong",
                  )}
                />
              </label>
            );
          })}
        </div>
      </fieldset>

      {role === "teacher" && (
        <div className="mt-6 max-w-md animate-fade-in">
          <TeacherPicker value={teacher.id} onChange={(t) => setTeacher({ id: t.id, name: t.name })} />
        </div>
      )}

      <Button size="lg" className="mt-8 w-full sm:w-auto" onClick={onContinue}>
        Continuar como {role === "student" ? "aluno" : "professor"}
      </Button>
    </div>
  );
}
