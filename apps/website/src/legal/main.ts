/**
 * Script das páginas jurídicas estáticas: estilos, fonte e tema do sistema.
 * O conteúdo já vem no HTML; sem ele, a página continua legível.
 */
import "@fontsource-variable/inter";
import "../index.css";

const media = window.matchMedia("(prefers-color-scheme: dark)");
const applyTheme = () => {
  document.documentElement.dataset.theme = media.matches ? "dark" : "light";
};
applyTheme();
media.addEventListener("change", applyTheme);

// Índice aberto no desktop (barra lateral) e recolhido no celular.
const toc = document.querySelector<HTMLDetailsElement>("details[data-toc]");
const wide = window.matchMedia("(min-width: 1024px)");
const syncToc = () => {
  if (toc) toc.open = wide.matches;
};
syncToc();
wide.addEventListener("change", syncToc);
