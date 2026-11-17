import { Link, isRouteErrorResponse, useRouteError } from "react-router";
import { AlertIcon, Logo, buttonClasses } from "@edusearch/ui";

/** Tela de erro de rota (404 ou falha inesperada ao renderizar/carregar uma tela). */
export function RouteError() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  // Falha ao baixar um chunk (ex.: nova versão publicada) → recarregar resolve.
  const chunkFailed = error instanceof Error && /dynamically imported module|Importing a module script failed/i.test(error.message);

  return <ErrorScreen notFound={notFound} reload={chunkFailed} />;
}

export function ErrorScreen({ notFound = false, reload = false }: { notFound?: boolean; reload?: boolean }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <Logo className="h-8" />
      <span className="mt-10 flex h-14 w-14 items-center justify-center rounded-full bg-primary-soft text-link">
        <AlertIcon className="h-7 w-7" />
      </span>
      <h1 className="mt-5 text-2xl font-semibold text-fg-strong">
        {notFound ? "Página não encontrada" : "Algo deu errado"}
      </h1>
      <p className="mt-2 max-w-sm text-fg-muted">
        {notFound
          ? "O endereço acessado não existe ou foi alterado."
          : reload
            ? "Uma nova versão do app pode estar disponível. Recarregue a página."
            : "Não foi possível exibir esta tela. Tente novamente."}
      </p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        {!notFound && (
          <button type="button" className={buttonClasses({ variant: "secondary" })} onClick={() => window.location.reload()}>
            Recarregar
          </button>
        )}
        <Link to="/" className={buttonClasses()}>
          Voltar ao início
        </Link>
      </div>
    </main>
  );
}
