const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export default function App() {
  return (
    <main className="flex min-h-screen items-center justify-center px-5">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <p className="text-2xl font-bold tracking-tight text-profundo">
          Edu<span className="text-petroleo">Search</span>
        </p>
        <span className="mt-6 inline-flex items-center gap-2 rounded-full bg-verde-claro px-3 py-1 text-xs font-medium text-esmeralda">
          <span className="h-1.5 w-1.5 rounded-full bg-esmeralda" aria-hidden="true" />
          Em desenvolvimento
        </span>
        <h1 className="mt-4 text-xl font-semibold text-profundo">
          O aplicativo do EduSearch está sendo construído.
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          Esta é a base do futuro aplicativo. Busca de professores, matching e agendamento chegam
          nas próximas fases do projeto.
        </p>
        <p className="mt-6 text-xs text-slate-400">API configurada: {API_URL}</p>
      </div>
    </main>
  );
}
