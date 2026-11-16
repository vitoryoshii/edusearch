# Branding — EduSearch

Arquivos de marca do EduSearch. Regras de uso, contraste, tamanhos mínimos e mapeamento por aplicação em **[`docs/branding.md`](../../docs/branding.md)**.

> **Status: PROVISÓRIO.** O `logo-horizontal.png` é a **referência visual temporária**. Todos os demais arquivos de marca são **provisórios** e ainda não foram aprovados oficialmente.
>
> Não edite os originais recebidos (`logo-horizontal.png`, `icon.png`). Gere versões a partir deles.

## Estrutura

```text
assets/branding/
├── logo-horizontal.png        # REFERÊNCIA TEMPORÁRIA: original recebido, alta resolução (2172×724)
├── logo-horizontal-dark.png   # Provisório: versão para fundos escuros, mesmo canvas da referência
├── icon.png                   # Provisório: original recebido, geometria diverge do logotipo (1254×1254)
├── logos/                         # Todos provisórios (derivados da referência)
│   ├── logo-primary.png           # Colorido, fundos claros
│   ├── logo-dark.png              # Fundos escuros (branco + detalhes verdes)
│   ├── logo-monochrome-dark.png   # 1 cor: azul profundo
│   ├── logo-monochrome-white.png  # 1 cor: branco
│   ├── logo-stacked.png           # Símbolo acima do nome (requer aprovação)
│   ├── symbol-primary.png         # Símbolo colorido
│   └── symbol-white.png           # Símbolo branco
├── icons/                         # Todos provisórios
│   ├── app-icon-192.png
│   ├── app-icon-512.png
│   ├── app-icon-maskable-512.png
│   ├── apple-touch-icon.png
│   ├── favicon-16.png
│   ├── favicon-32.png
│   └── favicon.ico                # 16 + 32 + 48
├── social/
│   └── social-preview.png         # Provisório, 1200×630 (Open Graph / GitHub)
└── references/                    # Mockups e kits CONCEITUAIS, preservados sem alteração
    ├── edusearch-mobile-app-mockup.png
    ├── edusearch-product-design-overview.png
    ├── edusearch-brand-kit-overview.png
    └── edusearch-brand-applications.png
```

Todos os PNG de logotipo e símbolo têm fundo transparente. Os ícones maskable, apple-touch e a prévia social são opacos, como exigem as plataformas.

## Paleta oficial

| Cor             | Hex       |
| --------------- | --------- |
| Azul-petróleo   | `#146A7A` |
| Azul profundo   | `#102E46` |
| Verde-esmeralda | `#14836E` |
| Verde-claro     | `#E8F5F3` |
| Branco-gelo     | `#F8FAFC` |

## Pendências de material original

- **Arquivos SVG** (`logos/*.svg`, `icons/favicon.svg`): não há original vetorial. Os SVG **não foram criados**, para não apresentar uma vetorização aproximada como oficial.
- **Geometria do símbolo:** `icon.png` e `logo-horizontal.png` divergem (posição e cor da borla). Os derivados seguem o `logo-horizontal.png`.
- **Favicon simplificado** para 16 px.
- **Aprovação** do `logo-stacked.png`.
- **Tipografia:** Inter segue como tipografia atual das aplicações; padronização definitiva posterior.
- **Mockups:** inconsistências conceituais (Next.js → React + Vite; "EduSearch Pay" → AbacatePay; dados fictícios).

Detalhes em [`docs/branding.md` → Pendências](../../docs/branding.md#13-pendências).
