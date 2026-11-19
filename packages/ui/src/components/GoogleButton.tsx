import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "../lib/cn";

/**
 * "G" multicolorido oficial do Google, exatamente como renderizado pelo botão
 * do Google Identity Services (48×48, cores padrão). NÃO alterar cores,
 * proporções ou geometria. Se o time preferir, substitua pelo arquivo do
 * pacote oficial: https://developers.google.com/static/identity/images/signin-assets.zip
 */
export function GoogleGLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false" className={className}>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
      <path fill="none" d="M0 0h48v48H0z" />
    </svg>
  );
}

export interface GoogleButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** Texto de chamada permitido pelas diretrizes (pt-BR). */
  label?: "Continuar com o Google" | "Fazer login com o Google" | "Inscrever-se com o Google";
  /**
   * Quando `false`, o botão aparece no estado desabilitado do Material
   * (sem enganar o usuário) e continua focável para leitores de tela, com a
   * explicação ligada por `aria-describedby`.
   */
  available?: boolean;
  /** Formatos permitidos pelas diretrizes: retangular ou pílula. */
  shape?: "rectangular" | "pill";
}

/**
 * Botão "Continuar com o Google" seguindo
 * https://developers.google.com/identity/branding-guidelines :
 * - Claro: fundo #FFFFFF, borda interna 1px #747775, texto #1F1F1F.
 * - Escuro: fundo #131314, borda interna 1px #8E918F, texto #E3E3E3.
 * - Texto 14/20 em Google Sans Medium (com fallback), G de 20px,
 *   12px antes do G, 10px entre G e texto, 12px após o texto.
 * - Desabilitado: padrão Material (conteúdo a 38% de opacidade).
 * Altura escalada para 44px (alvo de toque), mantendo a proporção do G.
 */
export const GoogleButton = forwardRef<HTMLButtonElement, GoogleButtonProps>(function GoogleButton(
  { label = "Continuar com o Google", available = true, shape = "rectangular", className, onClick, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-disabled={available ? undefined : true}
      onClick={available ? onClick : (e) => e.preventDefault()}
      className={cn(
        "group relative inline-flex h-11 w-full items-center justify-center border pr-3 pl-3",
        shape === "pill" ? "rounded-full" : "rounded-control",
        " transition-[background-color,border-color,box-shadow] duration-150",
        "[font-family:'Google_Sans','Google_Sans_Text',Roboto,var(--font-sans)] text-sm leading-5 font-medium",
        "border-[#747775] bg-white text-[#1F1F1F] dark:border-[#8E918F] dark:bg-[#131314] dark:text-[#E3E3E3]",
        available
          ? "hover:bg-[#F7F8F8] hover:shadow-card active:bg-[#EFF0F0] dark:hover:bg-[#1C1C1E] dark:active:bg-[#232326]"
          : "cursor-not-allowed border-[#1F1F1F1F] dark:border-[#8E918F1F]",
        className,
      )}
      {...rest}
    >
      <span className={cn("inline-flex items-center", !available && "opacity-[0.38]")}>
        <GoogleGLogo className="mr-2.5 h-5 w-5 shrink-0" />
        <span>{label}</span>
      </span>
    </button>
  );
});
