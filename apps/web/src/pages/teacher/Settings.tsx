import { PageHeader } from "../../components/PageHeader";
import { SettingsPanel } from "../../components/SettingsPanel";

export default function TeacherSettings() {
  return (
    <>
      <PageHeader title="Configurações" description="Aparência, notificações e sessão." />
      <SettingsPanel role="teacher" />
    </>
  );
}
