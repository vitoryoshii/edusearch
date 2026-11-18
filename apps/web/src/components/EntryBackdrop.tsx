/**
 * Curvas abstratas da tela de entrada (referência mobile aprovada):
 * azul-petróleo e verde-esmeralda nos cantos, sobre o branco-gelo.
 * Puramente decorativas (aria-hidden) e fora do fluxo do conteúdo.
 */
function Curves({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 320 220" aria-hidden="true" focusable="false" className={className} preserveAspectRatio="xMaxYMin meet">
      <path className="fill-petroleo" d="M320 0H138c34 42 76 64 124 80 30 10 48 30 58 60V0Z" />
      <path className="fill-esmeralda" fillOpacity="0.9" d="M320 0h-92c22 27 52 40 92 46V0Z" />
      <path className="stroke-petroleo" strokeOpacity="0.28" strokeWidth="1.5" fill="none" d="M104 0c50 58 124 92 216 170" />
      <path className="stroke-esmeralda" strokeOpacity="0.35" strokeWidth="1.5" fill="none" d="M88 0c58 74 140 112 232 198" />
    </svg>
  );
}

export function EntryBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <Curves className="absolute -top-px -right-px w-[78vw] max-w-[560px] opacity-95 dark:opacity-55" />
      <Curves className="absolute -bottom-px -left-px w-[70vw] max-w-[480px] rotate-180 opacity-90 dark:opacity-45" />
    </div>
  );
}
