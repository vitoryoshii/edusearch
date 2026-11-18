import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";
import { ToastProvider } from "@edusearch/ui";
import "@fontsource-variable/inter";
import "./index.css";
import { router, titleFor } from "./app/router";
import { AuthProvider } from "./app/auth";
import { SessionProvider } from "./app/session";
import { ThemeProvider } from "./app/theme";
import { registerServiceWorker } from "./pwa/register";
import { dataSource, isDemo } from "./lib/data/source";

// Somente em desenvolvimento: permite que os testes de jornada simulem outra
// pessoa reservando o mesmo horário. Não existe no build de produção.
if (import.meta.env.DEV && isDemo) {
  (window as unknown as { __edusearchDemo: unknown }).__edusearchDemo = { dataSource };
}

/** Atualiza o título da aba a cada navegação (anunciado por leitores de tela). */
function useDocumentTitle() {
  useEffect(() => {
    // subscribe devolve a função de cancelamento: retorno explícito.
    const unsubscribe = router.subscribe((state) => {
      document.title = `${titleFor(state.location.pathname)} · EduSearch`;
    });
    return unsubscribe;
  }, []);
  useEffect(() => {
    document.title = `${titleFor(window.location.pathname)} · EduSearch`;
  }, []);
}

function App() {
  useDocumentTitle();
  return (
    <ThemeProvider>
      {/* Sessão real (Supabase) e sessão de demonstração são independentes. */}
      <AuthProvider>
        <SessionProvider>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </SessionProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

registerServiceWorker();
