import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";
import { ToastProvider } from "@edusearch/ui";
import "@fontsource-variable/inter";
import "./index.css";
import { router, titleFor } from "./app/router";
import { SessionProvider } from "./app/session";
import { ThemeProvider } from "./app/theme";
import { registerServiceWorker } from "./pwa/register";

/** Atualiza o título da aba a cada navegação (anunciado por leitores de tela). */
function useDocumentTitle() {
  useEffect(
    () =>
      router.subscribe((state) => {
        document.title = `${titleFor(state.location.pathname)} · EduSearch`;
      }),
    [],
  );
  useEffect(() => {
    document.title = `${titleFor(window.location.pathname)} · EduSearch`;
  }, []);
}

function App() {
  useDocumentTitle();
  return (
    <ThemeProvider>
      <SessionProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

registerServiceWorker();
