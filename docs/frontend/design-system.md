# Design system — `@edusearch/ui`

Pacote em `packages/ui`, consumido diretamente do código-fonte (sem etapa de build) por `apps/website` e `apps/web`.

```css
/* index.css de cada app */
@import "tailwindcss";
@import "@edusearch/ui/theme.css";
@source "../../../packages/ui/src";
```

## Tokens

Três camadas em `packages/ui/src/styles/theme.css`:

1. **Paleta da marca** (fixa): `petroleo #146A7A`, `profundo #102E46`, `esmeralda #14836E`, `verde-claro #E8F5F3`, `gelo #F8FAFC`.
2. **Tokens semânticos** (`--es-*`), redefinidos no tema escuro.
3. **Utilitários Tailwind** gerados a partir deles.

| Utilitário | Claro | Escuro | Uso |
| ---------- | ----- | ------ | --- |
| `bg-bg` | `#F8FAFC` | `#0B1E2E` | Fundo da página |
| `bg-surface` | `#FFFFFF` | `#102E46` | Cards, painéis |
| `bg-surface-muted` | `#F1F5F9` | `#15384F` | Áreas secundárias, abas |
| `bg-soft` | `#E8F5F3` | `#123B4A` | Destaques suaves |
| `text-fg-strong` | `#102E46` | `#F1F5F9` | Títulos |
| `text-fg` | `#334155` | `#CBD5E1` | Texto corrido |
| `text-fg-muted` | `#5B6B7F` | `#94A3B8` | Texto secundário |
| `border-line` / `border-line-strong` | `#E2E8F0` / `#CBD5E1` | `#1F4560` / `#2C5874` | Bordas |
| `bg-primary` / `hover:bg-primary-hover` | `#146A7A` / `#0F5663` | `#146A7A` / `#1A7A8A` | Ação principal |
| `text-link` | `#146A7A` | `#5CC0CF` | Links e texto de destaque |
| `bg-primary-soft` | `#E7F1F3` | `#123B4A` | Fundo de ícones e item ativo |
| `text-success-text` / `bg-success-soft` | `#0E6E5C` / `#E8F5F3` | `#4FD1B5` / `#11403F` | **Somente** estados positivos |
| `text-warning-text`, `text-danger-text` | `#B45309`, `#B42318` | `#FCD34D`, `#FCA5A5` | Avisos e erros |

Também: raios `rounded-control` (10px), `rounded-card` (16px), `rounded-panel` (20px); sombras `shadow-card`, `shadow-raised`, `shadow-overlay`; animações `animate-fade-in`, `animate-slide-up`, `animate-pulse-soft` (todas desativadas com `prefers-reduced-motion`).

### Contraste

Todos os pares de texto foram verificados (WCAG 2.x, AA ≥ 4,5:1). `fg-muted` foi escurecido de `#64748B` para `#5B6B7F` para passar também sobre `surface-muted` e `soft` (mínimo de 4,74:1). `success-text` (`#0E6E5C`) é uma variante mais escura do verde-esmeralda, usada para texto pequeno; o `#14836E` original segue nos elementos gráficos.

### Tema claro e escuro

O tema é o atributo `data-theme` no `<html>`, aplicado antes da renderização por um script inline (sem "flash").

- **Website:** segue o sistema operacional.
- **App:** preferência *Sistema / Claro / Escuro* em Configurações, salva em `localStorage` (`edusearch-theme`, apenas preferência visual).
- Variante Tailwind: `dark:` (ex.: `dark:hidden`).

## Componentes

| Componente | Notas de acessibilidade |
| ---------- | ----------------------- |
| `Button`, `IconButton`, `buttonClasses()` | Alvos ≥ 44px (md/lg). `IconButton` exige `label`. `buttonClasses` estiliza `<a>`/`<Link>`. `loading` define `aria-busy`. |
| `Input`, `Select`, `Textarea`, `Field` | Rótulo sempre presente (`hideLabel` o oculta visualmente). Dica e erro ligados por `aria-describedby`; `aria-invalid` no erro. Fonte de 16px no mobile, que evita zoom no iOS. `Select` é nativo. |
| `Card` | `as`, `padding`, `tone` (`default`/`soft`/`muted`), `interactive`. |
| `Badge` | Tons `neutral`, `primary`, `success`, `warning`, `danger`, `demo` (tracejado, para conteúdo fictício). |
| `Avatar` | Iniciais, sem fotos de pessoas. Decorativo por padrão. |
| `Chip` | Alternância com `aria-pressed`. |
| `Switch` | `role="switch"` sobre checkbox nativo. |
| `ProgressBar` | `role="progressbar"` com valores ARIA. |
| `Dialog` | `<dialog>` nativo: foco preso, Esc e clique fora fecham, foco volta ao gatilho. Variante `sheet` para mobile. |
| `Dropdown` | Padrão ARIA *menu button*: setas, Home/End, Esc. `triggerHasText` quando o gatilho tem texto visível (WCAG 2.5.3). |
| `Tabs` | Padrão ARIA *tabs*: setas, Home/End, painéis com `aria-labelledby`. |
| `Skeleton`, `LoadingState` | `role="status"` com texto para leitores de tela. |
| `Toast` / `useToast` | Região `aria-live="polite"`, fechamento manual, até 3 simultâneos. |
| `EmptyState`, `ErrorState` | `ErrorState` usa `role="alert"` e oferece "Tentar novamente". |
| `Logo` | Troca o logotipo claro/escuro pelo tema (`logo.webp` / `logo-dark.webp`). |
| Ícones | Traço 1.75px, `aria-hidden` por padrão. |

### Regras

- Azul é a cor dominante. Verde **apenas** para estado positivo, e nunca como único indicador (sempre com texto ou ícone).
- Não use `hidden` direto em componentes que já definem `display` (ex.: `Button`, `Avatar`). Use variantes (`max-sm:hidden`) ou um elemento envolvente.
- Grids de uma coluna no mobile devem usar `grid-cols-1` (`minmax(0,1fr)`) para não estourar a largura.
- Sem gradientes fortes, glassmorphism ou ilustrações decorativas.

## Logos e ícones

| Uso | Arquivo | Origem |
| --- | ------- | ------ |
| Logo em fundo claro | `public/brand/logo.webp` | `assets/branding/logo-horizontal.png` (referência temporária) |
| Logo em fundo escuro | `public/brand/logo-dark.webp` | `assets/branding/logos/logo-dark.png` (provisório), apenas reescalado |
| Favicons e apple-touch | `public/favicon*.{ico,png}`, `apple-touch-icon.png` | `assets/branding/icons/` (provisórios) |
| Ícones PWA | `apps/web/public/icons/app-icon-{192,512,maskable-512}.png` | `assets/branding/icons/` (provisórios) |

Nenhum símbolo foi redesenhado. As pendências de marca (SVG oficial, favicon simplificado) seguem em [`docs/branding.md`](../branding.md).
