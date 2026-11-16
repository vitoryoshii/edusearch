# Identidade visual — EduSearch

Guia de uso da marca EduSearch. Os arquivos ficam em [`assets/branding/`](../assets/branding/).

## 1. Apresentação

| Elemento   | Definição oficial |
| ---------- | ----------------- |
| Nome       | **EduSearch** (sempre com "E" e "S" maiúsculos, sem espaço) |
| Descrição  | Marketplace educacional inteligente que conecta alunos e professores por meio de recomendações personalizadas. |
| Slogan     | *Encontre o professor certo para você.* |
| Contexto   | Projeto independente para o HackBrasil 2026, Trilha 03 — Acesso à Educação |
| Atributos  | Confiança · Educação · Clareza · Inovação |

Os nomes EduMatch, EduMeet e Aulevo **não** fazem parte da identidade vigente e não devem ser usados.

## 2. Conceito do símbolo

O símbolo combina um **capelo acadêmico** (educação, conquista) com uma **lupa** (busca, descoberta). Juntos, eles traduzem a proposta do produto: encontrar o professor certo.

- **Capelo:** gradiente do azul-petróleo para o azul profundo. Transmite solidez e confiança.
- **Lupa:** aro branco sobre o capelo, com lente no tom da marca. É o "Search" do nome.
- **Detalhes verdes:** a borla e o cabo da lupa, em verde. Indicam progresso e resultado positivo.

A referência oficial do símbolo é a versão presente em `assets/branding/logo-horizontal.png`. Todas as variantes foram derivadas dela.

## 3. Paleta de cores

| Cor             | Hex       | RGB           | Papel |
| --------------- | --------- | ------------- | ----- |
| Azul-petróleo   | `#146A7A` | 20, 106, 122  | **Cor principal**: botões, links, destaques |
| Azul profundo   | `#102E46` | 16, 46, 70    | Títulos, textos fortes, fundos escuros |
| Verde-esmeralda | `#14836E` | 20, 131, 110  | Estados positivos, confirmações, detalhes |
| Verde-claro     | `#E8F5F3` | 232, 245, 243 | Fundos suaves e seções de destaque |
| Branco-gelo     | `#F8FAFC` | 248, 250, 252 | Fundo principal das interfaces |

**Regra:** o azul é a cor dominante. O verde é reservado a estados positivos e detalhes, e não deve ser usado como cor principal de uma peça.

## 4. Tipografia

O kit de marca de referência (`references/edusearch-brand-kit-overview.png`) define:

| Uso                        | Família        | Pesos          |
| -------------------------- | -------------- | -------------- |
| Títulos, destaques, botões | **Montserrat** | 600, 700, 800  |
| Textos e conteúdo          | **Open Sans**  | 400, 500, 600  |

Ambas são open source (SIL OFL). A implementação atual do website e do app usa **Inter**, e a prévia social também. Ver [Pendências](#13-pendências).

## 5. Versões para modo claro e escuro

| Fundo                                           | Logotipo recomendado         |
| ----------------------------------------------- | ---------------------------- |
| Claro (branco, `#F8FAFC`, `#E8F5F3`)            | `logo-primary`               |
| Escuro (`#102E46`, `#146A7A`)                   | `logo-dark`                  |
| Claro, impressão em 1 cor ou carimbo            | `logo-monochrome-dark`       |
| Escuro ou fotografia escura, 1 cor              | `logo-monochrome-white`      |

- **`logo-primary`:** versão colorida original.
- **`logo-dark`:** símbolo e nome em branco, com os detalhes verdes (borla e cabo da lupa) preservados.
- **Monocromáticas:** usam *knock-out*, em que as áreas brancas do símbolo (aro e brilho da lupa) ficam vazadas e deixam ver o fundo.

Em páginas que suportam tema do sistema (como o README no GitHub), use `<picture>` com `prefers-color-scheme` para alternar entre `logo-primary` e `logo-dark`.

## 6. Regras de aplicação

- Prefira a versão **horizontal**. Use a **empilhada** quando a largura for limitada e o **símbolo** isolado quando o nome já estiver visível ou o espaço for quadrado (avatar, app, favicon).
- Sempre redimensione **proporcionalmente**, a partir dos arquivos oficiais.
- Garanta contraste adequado entre logotipo e fundo (ver seção 8).
- Em fundos fotográficos, use uma versão monocromática sobre uma área uniforme da imagem.

## 7. Área de proteção e tamanho mínimo

**Área de proteção:** mantenha livre, em todos os lados, um espaço mínimo igual à **altura da letra "E"** de "EduSearch" (≈ 57% da altura total do logotipo horizontal). Para o símbolo isolado, use 25% da largura do símbolo.

| Versão              | Tamanho mínimo (tela)   | Tamanho mínimo (impressão) |
| ------------------- | ----------------------- | -------------------------- |
| Horizontal          | 120 px de largura       | 30 mm de largura           |
| Empilhada           | 80 px de largura        | 20 mm de largura           |
| Símbolo             | 24 px de largura        | 8 mm de largura            |
| Ícone de aplicativo | 32 px                   | —                          |

Abaixo de 24 px, o detalhe da lupa perde legibilidade. Ver a pendência do favicon simplificado.

## 8. Contraste e acessibilidade

Razões de contraste calculadas pela fórmula WCAG 2.x:

| Combinação                              | Contraste | Uso adequado |
| --------------------------------------- | --------- | ------------ |
| `#102E46` sobre `#F8FAFC`               | 13,37:1   | Qualquer texto |
| `#FFFFFF` sobre `#102E46`               | 13,99:1   | Qualquer texto |
| `#102E46` sobre `#E8F5F3`               | 12,51:1   | Qualquer texto |
| `#FFFFFF` sobre `#146A7A`               | 6,23:1    | Qualquer texto (AA) |
| `#146A7A` sobre `#F8FAFC`               | 5,95:1    | Qualquer texto (AA) |
| `#146A7A` sobre `#E8F5F3`               | 5,57:1    | Qualquer texto (AA) |
| `#FFFFFF` sobre `#14836E`               | 4,67:1    | Texto normal (AA, limite) |
| `#14836E` sobre `#F8FAFC`               | 4,46:1    | Somente texto grande ≥ 18,66 px negrito / 24 px, ícones |
| `#14836E` sobre `#E8F5F3`               | 4,17:1    | Somente texto grande e ícones |
| `#14836E` sobre `#102E46`               | 3,00:1    | Somente elementos gráficos (não texto) |

Recomendações:

- Texto em verde-esmeralda: apenas em tamanho grande ou acompanhado de ícone ou rótulo. Nunca use a cor como único indicador de estado.
- Logotipo sobre fundo escuro: sempre `logo-dark` ou `logo-monochrome-white`. O `logo-primary` sobre `#102E46` fica ilegível.
- Imagens do logotipo devem ter texto alternativo `alt="EduSearch"`.

## 9. Exemplos de utilização correta

- `logo-primary` no header claro do website, com a área de proteção respeitada.
- `logo-dark` no rodapé ou em seções com fundo `#102E46`.
- `app-icon-*` (símbolo branco sobre o gradiente petróleo → azul profundo) como ícone de aplicativo.
- `social-preview.png` como imagem Open Graph ao compartilhar o site.
- `logo-monochrome-dark` em documentos impressos em uma cor.

## 10. Aplicações proibidas

- ❌ Distorcer, esticar, inclinar ou rotacionar o logotipo.
- ❌ Alterar as cores fora das variantes oficiais, ou aplicar gradientes, sombras, contornos ou brilhos adicionais.
- ❌ Reorganizar os elementos (por exemplo, nome à esquerda do símbolo) ou alterar a proporção entre símbolo e nome.
- ❌ Redesenhar o símbolo ou substituí-lo por outro capelo ou lupa.
- ❌ Usar `logo-primary` sobre fundos escuros, ou `logo-dark` sobre fundos claros.
- ❌ Aplicar sobre fundos visualmente poluídos sem área uniforme.
- ❌ Escrever o nome de outra forma ("Edusearch", "Edu Search", "EDUSEARCH" no logotipo) ou usar nomes antigos.
- ❌ Usar os mockups conceituais como se fossem telas reais do produto.

## 11. Nomenclatura dos arquivos

Padrão: `kebab-case`, em inglês, no formato `<tipo>-<variante>[-<tamanho>].<ext>`.

| Prefixo      | Significado | Exemplos |
| ------------ | ----------- | -------- |
| `logo-`      | Símbolo + nome | `logo-primary`, `logo-dark`, `logo-stacked` |
| `symbol-`    | Somente o símbolo | `symbol-primary`, `symbol-white` |
| `app-icon-`  | Ícone de aplicativo e PWA | `app-icon-192`, `app-icon-maskable-512` |
| `favicon`    | Ícone do navegador | `favicon-16`, `favicon-32`, `favicon.ico` |
| `social-`    | Prévias para redes | `social-preview` |
| `edusearch-` | Referências e mockups | `edusearch-mobile-app-mockup` |

## 12. Inventário e mapeamento por aplicação

### Arquivos disponíveis

| Arquivo | Dimensões | Fundo | Origem |
| ------- | --------- | ----- | ------ |
| `logo-horizontal.png` | 2172×724 | Transparente | **Original oficial** (alta resolução, com área de respiro) |
| `icon.png` | 1254×1254 | Transparente | **Original oficial**, versão alternativa do símbolo (ver pendências) |
| `logo-horizontal-dark.png` | 2172×724 | Transparente | Derivado: versão para fundos escuros, mesmo canvas do original |
| `logos/logo-primary.png` | 1895×365 | Transparente | Derivado: recorte do original |
| `logos/logo-dark.png` | 1895×365 | Transparente | Derivado: branco + detalhes verdes |
| `logos/logo-monochrome-dark.png` | 1895×365 | Transparente | Derivado: `#102E46`, knock-out |
| `logos/logo-monochrome-white.png` | 1895×365 | Transparente | Derivado: `#FFFFFF`, knock-out |
| `logos/logo-stacked.png` | 1393×630 | Transparente | Derivado: símbolo acima do nome (proposta, requer aprovação) |
| `logos/symbol-primary.png` | 461×365 | Transparente | Derivado: símbolo recortado |
| `logos/symbol-white.png` | 461×365 | Transparente | Derivado: símbolo branco, knock-out |
| `icons/app-icon-512.png` / `-192.png` | 512 / 192 | Cantos transparentes | Símbolo branco sobre gradiente oficial |
| `icons/app-icon-maskable-512.png` | 512×512 | Opaco (sangrado) | Símbolo dentro do círculo seguro de 80% (com folga) |
| `icons/apple-touch-icon.png` | 180×180 | Opaco | O iOS aplica os cantos arredondados |
| `icons/favicon-16.png` / `-32.png` / `favicon.ico` | 16 / 32 / 16+32+48 | Cantos transparentes | Símbolo branco sobre gradiente |
| `social/social-preview.png` | 1200×630 | Opaco | Logotipo, slogan e identificação do HackBrasil |
| `references/*.png` | ~1448×1086 | — | Mockups e kits conceituais (somente referência) |

**Como os derivados foram gerados:** só recorte, escala e mapeamento de cor do original, sem redesenho. As proporções do símbolo e do nome são as do original.

### Mapeamento por aplicação

> Mapeamento recomendado para as próximas fases. **Não foi aplicado nas aplicações nesta etapa.**

| Aplicação | Uso | Asset |
| --------- | --- | ----- |
| README / GitHub | Logo do topo (tema claro / escuro) | `logos/logo-primary.png` / `logos/logo-dark.png` |
| GitHub | *Social preview* do repositório (Settings) | `social/social-preview.png` |
| `apps/website` | Header e rodapé claros | `logos/logo-primary.png` (convertido para WebP) |
| `apps/website` | Seções de fundo escuro | `logos/logo-dark.png` |
| `apps/website` | Favicon | `icons/favicon.ico`, `icons/favicon-32.png` |
| `apps/website` | Open Graph (`og:image`) | `social/social-preview.png` |
| `apps/web` (PWA) | `manifest.webmanifest` → `icons` | `app-icon-192.png`, `app-icon-512.png` (`purpose: any`), `app-icon-maskable-512.png` (`purpose: maskable`) |
| `apps/web` | iOS / atalhos | `icons/apple-touch-icon.png` |
| `apps/web` | Tela de login / splash | `logos/logo-stacked.png` (após aprovação) |
| Apresentações / documentos | Capa e materiais | `logo-horizontal.png` / `logo-horizontal-dark.png` |
| Avatares (redes, GitHub org) | Perfil | `icons/app-icon-512.png` |

Estado atual das aplicações, que não foi alterado nesta etapa: o website e o app usam `public/brand/logo.webp` e favicons gerados na fase anterior a partir de `logo-horizontal.png` e `icon.png`.

## 13. Pendências

| Pendência | Motivo | Necessário |
| --------- | ------ | ---------- |
| **Logotipos e símbolos em SVG** (`logo-primary.svg`, `logo-dark.svg`, `logo-monochrome-*.svg`, `logo-stacked.svg`, `symbol-*.svg`, `favicon.svg`) | Não existe original vetorial. Vetorizar o PNG produziria uma recriação aproximada, que não deve ser tratada como equivalente oficial. | Arquivo-fonte vetorial (SVG, AI, PDF ou Figma) do designer |
| **Divergência do símbolo** | `icon.png` tem a borla à direita, branca e com contorno; `logo-horizontal.png` tem a borla à esquerda e verde. Os mockups também variam. | Definição de qual geometria é a oficial. Os derivados atuais seguem o `logo-horizontal.png` |
| **Favicon simplificado** | Em 16 px o símbolo completo perde legibilidade. O kit sugere uma versão simplificada, que não existe como arquivo. | Versão simplificada do símbolo, de preferência em SVG |
| **Logo empilhado** | Gerado com a proporção do horizontal; no kit o símbolo aparece maior. | Aprovação ou arquivo oficial |
| **Tipografia** | O kit define Montserrat + Open Sans; o website e o app usam Inter. | Decisão do time antes de alinhar as aplicações |
| **Mockups** | Contêm dados fictícios e elementos fora do escopo aprovado (Next.js, "EduSearch Pay", armazenamento em nuvem). | Manter como referência conceitual; atualizar se houver nova versão |
