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
| `SegmentedControl` | Grupo de rádio (`role=radiogroup`): uma opção ativa; setas mudam a seleção. Usado em Semana/Mês, Calendário/Lista e na pré-visualização de estados. |
| `ProgressRing` | Anel de progresso do mockup, com `role=progressbar` e valores ARIA. |
| `Skeleton`, `LoadingState` | `role="status"` com texto para leitores de tela. |
| `Toast` / `useToast` | Região `aria-live="polite"`, fechamento manual, até 3 simultâneos. |
| `EmptyState`, `ErrorState` | `ErrorState` usa `role="alert"` e oferece "Tentar novamente". |
| `Logo` | `variant="full"` (símbolo + nome) ou `"symbol"` (compacto). `surface="auto"` troca a versão pelo tema; `"dark"`/`"light"` fixam a versão pelo fundo. Use `decorative` quando o nome já está visível. |
| `GoogleButton`, `GoogleGLogo` | Botão "Continuar com o Google" conforme as diretrizes oficiais (ver abaixo). Com `available={false}`, usa o estado desabilitado do Material com `aria-disabled` e continua focável. |
| `PasswordInput` | Campo de senha com mostrar/ocultar (`aria-pressed`, alvo de 44px) e sem autocorreção. |
| `Checkbox` | Checkbox nativo estilizado, com erro ligado por `aria-describedby`. |
| Ícones | Traço 1.75px, `aria-hidden` por padrão. |

### Regras

- Azul é a cor dominante. Verde **apenas** para estado positivo, e nunca como único indicador (sempre com texto ou ícone).
- Não use `hidden` direto em componentes que já definem `display` (ex.: `Button`, `Avatar`). Use variantes (`max-sm:hidden`) ou um elemento envolvente.
- Grids de uma coluna no mobile devem usar `grid-cols-1` (`minmax(0,1fr)`) para não estourar a largura.
- Sem gradientes fortes, glassmorphism ou ilustrações decorativas.

## Botão do Google

Implementado em `packages/ui/src/components/GoogleButton.tsx`, seguindo https://developers.google.com/identity/branding-guidelines:

| Item | Especificação aplicada |
| ---- | ---------------------- |
| Texto | "Continuar com o Google" (equivalente pt-BR de *Continue with Google*) |
| Tema claro | Fundo `#FFFFFF`, borda interna 1px `#747775`, texto `#1F1F1F` |
| Tema escuro | Fundo `#131314`, borda interna 1px `#8E918F`, texto `#E3E3E3` |
| Tipografia | 14/20, peso médio; família `Google Sans` → `Roboto` → Inter (fallback) |
| Espaçamento | 12px antes do G, 10px entre o G e o texto, 12px após o texto; G com 20px |
| Altura | 44px (escala permitida, mantendo a proporção), para o alvo de toque |
| G | Marca multicolorida padrão, sem alterar cor, tamanho relativo ou geometria |

- **Estado atual:** desabilitado (`available={false}`), com a mensagem "O acesso com Google estará disponível após a integração." O botão não executa nenhum fluxo, não solicita escopos e não simula tokens.
- **Pendência:** a Google Sans não é carregada pelo app. Usa a fonte do sistema se estiver instalada; senão, Roboto ou Inter. Na integração real, use o botão renderizado pelo SDK Google Identity Services ou carregue a fonte. O SVG do G pode ser trocado pelo arquivo do pacote oficial (`signin-assets.zip`).

## Referência visual (Fase 2.3)

O mockup aprovado (`assets/branding/references/edusearch-mobile-app-mockup.png`) orienta as telas:

- **Botão primário:** gradiente moderado petróleo → esmeralda (`from-petroleo to-esmeralda`). O texto branco tem contraste mínimo de 4,67:1 em todo o gradiente.
- **Telas:** blocos de disciplina no início, assistente em conversa, destaque do perfil do professor, cartões de "Próxima aula", pagamento e progresso em *Minhas aulas* e navegação inferior com 4 itens.
- **Diferenças intencionais:** sem fotos de pessoas, sem selo de verificação e sem avaliações, porque os dados são fictícios; o botão do Meet só aparece com link real.
- **Regra de layout:** grids responsivos sempre com `grid-cols-1` na base, porque textos com `truncate` em colunas automáticas causam overflow (caso encontrado em *Minhas aulas*).

## Microinterações

- Botões: transição de cor e deslocamento de 1px ao pressionar. Quando desabilitados, ficam com 55% de opacidade e sem eventos de ponteiro.
- Cards interativos: realce de borda e sombra leve no hover e no foco.
- Entrada de tela: `animate-fade-in` no app e `animate-slide-up` nas telas de acesso, entre 160 e 200ms.
- Validação: o requisito de senha passa a "atendido" em tempo real. Os erros aparecem ao sair do campo ou ao enviar.
- Tudo é anulado por `prefers-reduced-motion`.

## Logos e ícones

| Uso | Arquivo | Origem |
| --- | ------- | ------ |
| Logo em fundo claro | `public/brand/logo.webp` | `assets/branding/logo-horizontal.png` (referência temporária) |
| Logo em fundo escuro | `public/brand/logo-dark.webp` | `assets/branding/logos/logo-dark.png` (provisório), apenas reescalado |
| Símbolo compacto (claro) | `public/brand/symbol.webp` (152×120) | `assets/branding/logos/symbol-primary.png` (provisório), apenas reescalado |
| Símbolo compacto (escuro) | `public/brand/symbol-dark.webp` (152×120) | `assets/branding/logos/symbol-white.png` (provisório), apenas reescalado |
| Favicons e apple-touch | `public/favicon*.{ico,png}`, `apple-touch-icon.png` | `assets/branding/icons/` (provisórios) |
| Ícones PWA | `apps/web/public/icons/app-icon-{192,512,maskable-512}.png` | `assets/branding/icons/` (provisórios) |

O painel institucional das telas de acesso fica sobre o azul profundo nos dois temas e usa sempre `logo-dark`. Nenhum símbolo foi redesenhado.

**Pendências de branding (sem mudança):** SVG oficial do logotipo e do símbolo, favicon simplificado para 16px, aprovação do `logo-stacked` (não usado no app enquanto não for aprovado) e definição da geometria do símbolo (`icon.png` × `logo-horizontal.png`). Todos os derivados continuam provisórios. As pendências de marca (SVG oficial, favicon simplificado) seguem em [`docs/branding.md`](../branding.md).
