# Capturas — Fase 2.5 (entrada única e onboarding)

As capturas são geradas pelo GitHub Actions (job **Typecheck, lint, build e testes leves**, passo *Entrada única, login Google e onboarding*) e publicadas no artefato **`screenshots-fase-2.5`**, com Google e Supabase simulados (nenhuma credencial real).

Para trazê-las para esta pasta depois que o CI rodar no Pull Request:

```bash
gh run download <id-da-execucao> --repo vitoryoshii/edusearch --name screenshots-fase-2.5 --dir docs/frontend/screenshots/fase-2.5
```

Nomes: `<tela>-<largura>-<claro|escuro>.png`.

| Tela | Larguras |
| ---- | -------- |
| `entrada-publica` (sem configuração do Google) | 320, 375, 390, 768, 1440 |
| `entrada-google` (ambiente de testes) | 320, 375, 390, 768, 1440 |
| `entrada-erro`, `entrada-nao-autorizado`, `entrada-sessao-ativa` | 390 |
| `boas-vindas` (primeiro acesso) | 320, 375, 390, 768, 1440 |
| `aluno-etapa-1`, `aluno-revisao` | 320, 390, 1440 |
| `professor-aulas` (com a prévia da comissão de 15%) | 320, 390, 1440 |
| `conta-inicio` | 390, 1440 |

Capturas atuais: execução [44423616815](https://github.com/vitoryoshii/edusearch/actions/runs/44423616815) (commit `28867c4`), 58 imagens.

> **Atenção ao revisar:** nas telas do ambiente de testes (`entrada-google`, `entrada-erro`, `entrada-nao-autorizado`), o botão "Continuar com o Google" é o **mock do teste** (sem o "G"). Em uso real, o Google Identity Services renderiza o botão oficial. A foto de perfil também é fictícia. Nas capturas de página inteira em 320–390 px, a barra fixa "Continuar" aparece no meio da imagem porque é `sticky` (no aparelho, ela fica presa ao rodapé da tela).
