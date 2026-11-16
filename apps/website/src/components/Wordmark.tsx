/**
 * Identificação tipográfica PROVISÓRIA do EduSearch.
 * Substituir pelo logotipo oficial quando os arquivos forem adicionados em assets/branding/.
 */
export default function Wordmark({ inverted = false }: { inverted?: boolean }) {
  return (
    <span
      className={`text-xl font-bold tracking-tight ${inverted ? "text-white" : "text-profundo"}`}
    >
      Edu<span className={inverted ? "text-verde-claro" : "text-petroleo"}>Search</span>
    </span>
  );
}
