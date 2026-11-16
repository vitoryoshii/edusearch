# Identidade visual — EduSearch

Guia de uso da marca EduSearch. Os arquivos ficam em [`assets/branding/`](../assets/branding/).

> **Status da marca: PROVISÓRIA.**
>
> - A **referência visual temporária** é o logotipo horizontal [`assets/branding/logo-horizontal.png`](../assets/branding/logo-horizontal.png).
> - Todas as demais variantes (versões escura e monocromáticas, empilhada, símbolos, ícones, favicons e prévia social) são **provisórias**. Foram derivadas desse logotipo e **ainda não foram aprovadas oficialmente**.
> - A identidade definitiva depende dos arquivos vetoriais originais e da aprovação do time (ver [Pendências](#13-pendências)).

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

A referência visual **temporária** do símbolo é a versão presente em `assets/branding/logo-horizontal.png`. Todas as variantes provisórias foram derivadas dela.

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

| Situação | Família | Onde |
| -------- | ------- | ---- |
| **Atual (em uso)** | **Inter** (open source, SIL OFL) | Website, aplicativo e prévia social |
| Proposta em avaliação | Montserrat (títulos) + Open Sans (textos) | Sugerida no kit conceitual `references/edusearch-brand-kit-overview.png` |

**Inter continua sendo a tipografia das aplicações.** A padronização definitiva será decidida depois. Até lá, não troque a fonte das aplicações nem dos materiais.

## 5. Versões para modo claro e escuro

> Variantes **provisórias**. Use-as apenas como apoio enquanto não houver versões oficiais aprovadas. A referência visual é o logotipo horizontal.

| Fundo                                           | Variante provisória          |
| ----------------------------------------------- | ---------------------------- |
| Claro (branco, `#F8FAFC`, `#E8F5F3`)            | `logo-horizontal.png` (referência) ou `logos/logo-primary.png` (recorte) |
| Escuro (`#102E46`, `#146A7A`)                   | `logos/logo-dark.png`        |
| Claro, impressão em 1 cor ou carimbo            | `logos/logo-monochrome-dark.png` |
| Escuro ou fotografia escura, 1 cor              | `logos/logo-monochrome-white.png` |

- **`logo-primary`:** é o próprio logotipo horizontal, apenas recortado.
- **`logo-dark`:** símbolo e nome em branco, com os detalhes verdes (borla e cabo da lupa) preservados.
- **Monocromáticas:** usam *knock-out*, em que as áreas brancas do símbolo (aro e brilho da lupa) ficam vazadas e deixam ver o fundo.

O logotipo horizontal tem texto escuro e **não é legível em fundos escuros**. Para esses casos ainda não há versão aprovada.

## 6. Regras de aplicação

- Prefira a versão **horizontal**. Use a **empilhada** quando a largura for limitada e o **símbolo** isolado quando o nome já estiver visível ou o espaço for quadrado (avatar, app, favicon).
- Sempre redimensione **proporcionalmente**, a partir dos arquivos de `assets/branding/`.
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
- Logotipo sobre fundo escuro: use `logo-dark` ou `logo-monochrome-white` (provisórios). O logotipo horizontal sobre `#102E46` fica ilegível.
- Imagens do logotipo devem ter texto alternativo `alt="EduSearch"`.

## 9. Exemplos de utilização correta

- `logo-horizontal.png` (referência temporária) no header claro do website, com a área de proteção respeitada.
- `logo-dark` (provisório) no rodapé ou em seções com fundo `#102E46`.
- `app-icon-*` (provisório; símbolo branco sobre o gradiente petróleo → azul profundo) como ícone de aplicativo.
- `social-preview.png` (provisório) como imagem Open Graph ao compartilhar o site.
- `logo-monochrome-dark` (provisório) em documentos impressos em uma cor.

## 10. Aplicações proibidas

- ❌ Distorcer, esticar, inclinar ou rotacionar o logotipo.
- ❌ Alterar as cores fora das variantes documentadas, ou aplicar gradientes, sombras, contornos ou brilhos adicionais.
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

| Arquivo | Dimensões | Fundo | Status |
| ------- | --------- | ----- | ------ |
| `logo-horizontal.png` | 2172×724 | Transparente | **Referência visual temporária** (original recebido) |
| `icon.png` | 1254×1254 | Transparente | Provisório: original recebido, geometria diverge do logotipo |
| `logo-horizontal-dark.png` | 2172×724 | Transparente | Provisório (derivado) |
| `logos/logo-primary.png` | 1895×365 | Transparente | Provisório: recorte da referência |
| `logos/logo-dark.png` | 1895×365 | Transparente | Provisório (derivado) |
| `logos/logo-monochrome-dark.png` | 1895×365 | Transparente | Provisório (derivado) |
| `logos/logo-monochrome-white.png` | 1895×365 | Transparente | Provisório (derivado) |
| `logos/logo-stacked.png` | 1393×630 | Transparente | Provisório: proposta de composição, não aprovada |
| `logos/symbol-primary.png` | 461×365 | Transparente | Provisório (derivado) |
| `logos/symbol-white.png` | 461×365 | Transparente | Provisório (derivado) |
| `icons/app-icon-512.png` / `-192.png` | 512 / 192 | Cantos transparentes | Provisório (derivado) |
| `icons/app-icon-maskable-512.png` | 512×512 | Opaco (sangrado) | Provisório: símbolo dentro do círculo seguro de 80% |
| `icons/apple-touch-icon.png` | 180×180 | Opaco | Provisório (derivado) |
| `icons/favicon-16.png` / `-32.png` / `favicon.ico` | 16 / 32 / 16+32+48 | Cantos transparentes | Provisório: aguarda favicon simplificado |
| `social/social-preview.png` | 1200×630 | Opaco | Provisório (composição com Inter) |
| `references/*.png` | ~1448×1086 | — | Referências **conceituais** (preservadas sem alteração) |

**Como os derivados foram gerados:** só recorte, escala e mapeamento de cor do logotipo horizontal, sem redesenho. As proporções do símbolo e do nome são as da referência.

### Mapeamento por aplicação

> Mapeamento **sugerido** para as próximas fases, com assets provisórios. **Não foi aplicado nas aplicações nesta etapa.**

| Aplicação | Uso | Asset |
| --------- | --- | ----- |
| README / GitHub | Logo do topo | `logo-horizontal.png` (referência temporária) |
| GitHub | *Social preview* do repositório (Settings) | `social/social-preview.png` (provisório) |
| `apps/website` | Header e rodapé claros | `logo-horizontal.png` (convertido para WebP, como já está em uso) |
| `apps/website` | Seções de fundo escuro | `logos/logo-dark.png` (provisório) |
| `apps/website` | Favicon | `icons/favicon.ico`, `icons/favicon-32.png` (provisórios) |
| `apps/website` | Open Graph (`og:image`) | `social/social-preview.png` (provisório) |
| `apps/web` (PWA) | `manifest.webmanifest` → `icons` | `app-icon-192.png`, `app-icon-512.png` (`purpose: any`), `app-icon-maskable-512.png` (`purpose: maskable`) (provisórios) |
| `apps/web` | iOS / atalhos | `icons/apple-touch-icon.png` (provisório) |
| Apresentações / documentos | Capa e materiais | `logo-horizontal.png` |

Estado atual das aplicações, que não foi alterado nesta etapa: o website e o app usam `public/brand/logo.webp` (gerado a partir de `logo-horizontal.png`), favicons gerados a partir de `icon.png` e a fonte Inter.

## 13. Pendências

| # | Pendência | Situação | Necessário para resolver |
| - | --------- | -------- | ------------------------ |
| 1 | **Logotipos e símbolos em SVG vetorial** (`logo-primary.svg`, `logo-dark.svg`, `logo-monochrome-dark.svg`, `logo-monochrome-white.svg`, `logo-stacked.svg`, `symbol-primary.svg`, `symbol-white.svg`) | Não existe original vetorial. **Nenhum SVG foi criado**: vetorizar o PNG produziria uma recriação aproximada, que não deve ser apresentada como oficial. | Arquivo-fonte vetorial (SVG, AI, PDF ou Figma) do designer |
| 2 | **Favicon** (`favicon.svg` e versão simplificada) | Os favicons PNG/ICO atuais são provisórios. Em 16 px o símbolo completo perde legibilidade; o kit conceitual sugere uma versão simplificada que não existe como arquivo. | Símbolo simplificado, de preferência em SVG |
| 3 | **Logo empilhado** | `logo-stacked.png` é uma proposta provisória com a proporção do logotipo horizontal. No kit conceitual o símbolo aparece maior. | Aprovação do time ou arquivo oficial |
| 4 | **Divergência do símbolo** | `icon.png` tem a borla à direita, branca e com contorno; `logo-horizontal.png` tem a borla à esquerda e verde. | Definição da geometria oficial (os derivados seguem o `logo-horizontal.png`) |
| 5 | **Tipografia definitiva** | Inter segue em uso. Montserrat + Open Sans são apenas uma proposta do kit. | Decisão do time |
| 6 | **Inconsistências dos mockups** | Ver detalhamento abaixo. | Manter como referência conceitual; atualizar se houver nova versão |

### Inconsistências dos mockups conceituais

Os arquivos em `assets/branding/references/` são preservados **sem alteração** como referências conceituais. Onde divergem do projeto, **prevalece a documentação**:

| O mockup mostra | Definição oficial do projeto |
| --------------- | ---------------------------- |
| "App (PWA) — Next.js" na arquitetura | Frontend em **React + Vite + TypeScript** |
| "EduSearch Pay" como gateway de pagamentos | Gateway planejado: **AbacatePay** (Pix, split e repasse) |
| "Armazenamento Cloud (Drive/S3)" | Fora do escopo aprovado atual |
| Professores, fotos, avaliações, preços e progresso | **Dados fictícios e ilustrativos**, sem professores reais nem métricas |
| Variações do símbolo (borla à direita, só o capelo sem lupa) | Referência temporária: símbolo do `logo-horizontal.png` |
| Subtítulo "Sistema de Busca Educacional" e slogan "Conectamos você ao aprendizado certo" | Slogan oficial: **"Encontre o professor certo para você."** |
| Tipografia Montserrat + Open Sans | Tipografia atual: **Inter** |
| Split "Professor 90% / Plataforma 10%" | Coerente com a **hipótese** comercial de 10% (ainda não validada) |

