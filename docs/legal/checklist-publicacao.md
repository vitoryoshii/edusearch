# Checklist de publicação — Termos de Uso e Política de Privacidade

Documentos-fonte:

- [termos-de-uso.md](termos-de-uso.md) → `https://edusearch.com.br/termos-de-uso`
- [politica-de-privacidade.md](politica-de-privacidade.md) → `https://edusearch.com.br/politica-de-privacidade`

Os documentos são **rascunhos para revisão jurídica** (`status: rascunho`). Eles foram redigidos para o modelo real do EduSearch e com base na LGPD, no Marco Civil da Internet, no CDC, no ECA e na Lei nº 15.211/2025 (ECA Digital), mas **não substituem a revisão por advogado(a)**.

## Como a publicação funciona

1. Os arquivos `.md` são a única fonte do texto. O website gera as páginas a partir deles no build (`apps/website`).
2. Enquanto `status` for diferente de `aprovado`:
   - as páginas exibem o aviso **"Versão preliminar — não vigente"**;
   - as páginas usam `noindex` (não aparecem em buscadores);
   - o rodapé do website **não** exibe links para elas;
   - os marcadores `[[REVISAR: …]]` aparecem destacados como pendências.
3. O build **falha** se um documento estiver com `status: aprovado` e ainda contiver qualquer marcador `[[REVISAR: …]]`.
4. Depois da publicação, defina no aplicativo (Cloudflare Pages → `edusearch-app`):
   - `VITE_LEGAL_TERMS_URL=https://edusearch.com.br/termos-de-uso`
   - `VITE_LEGAL_PRIVACY_URL=https://edusearch.com.br/politica-de-privacidade`

   Só então os nomes dos documentos viram links na tela de acesso. Não existe aceite fictício: o app não marca caixas nem registra aceite.

## 1. Informações que o responsável precisa fornecer

Não inventadas. Marcadas nos documentos como `[[REVISAR]]`.

- [ ] Razão social ou nome completo do responsável pela Plataforma (o EduSearch é independente; não usar dados de outras empresas)
- [ ] CNPJ ou CPF
- [ ] Natureza jurídica e regime de faturamento
- [ ] Endereço completo
- [ ] Canal oficial de atendimento (e-mail ou formulário)
- [ ] Canal de privacidade e encarregado (DPO) ou justificativa de dispensa (Resolução CD/ANPD nº 2/2022 — agentes de pequeno porte)
- [ ] Adesão ao consumidor.gov.br (opcional)
- [ ] Foro para relações que não sejam de consumo (ex.: professores)

## 2. Decisões comerciais pendentes

Não publicar condições definitivas antes da validação comercial e jurídica.

- [x] Comissão padrão: **15%** sobre o valor da aula, descontada do repasse ao professor (aprovada)
- [ ] Descontos progressivos de comissão: **sem regras definitivas** — não publicar percentuais nem metas
- [ ] Programa de indicações qualificadas: **sem regulamento** — não publicar recompensas
- [ ] Premiações: **sem regulamento**
- [ ] Processador de pagamentos e funcionamento do split (**não está ativo**; não afirmar que funciona)
- [ ] Quem suporta os custos de processamento
- [ ] Política de cancelamento, remarcação, não comparecimento e reembolso (inclusive falhas em aulas online)
- [ ] Prazo, forma e condições dos repasses; retenções; documentos fiscais
- [ ] Prazo de aviso prévio para mudanças na comissão e nos Termos
- [ ] Procedimento de encerramento de conta pelo usuário e efeitos sobre aulas e valores pendentes

## 3. Privacidade e segurança — pendências

- [ ] Região do projeto Supabase e mecanismo de transferência internacional (art. 33 LGPD; cláusulas-padrão da ANPD)
- [ ] Registros mantidos pelo Supabase (IP, navegador) e prazos no plano contratado
- [ ] Prazos efetivos de exclusão, backups e registros (Supabase e Cloudflare); aplicabilidade do art. 15 do Marco Civil
- [ ] Avaliação de legítimo interesse para segurança e prevenção a fraudes
- [ ] Revisão e aprovação das políticas RLS do banco
- [ ] Provedor de e-mail transacional (SMTP) e seus termos
- [ ] Procedimento interno de resposta a incidentes (art. 48 LGPD)
- [ ] Procedimento de atendimento aos direitos do titular (art. 18 e 19 LGPD)

## 4. Proteção de crianças e adolescentes — decisões necessárias

Situação atual: **não há contas reais de menores de 18 anos**. A fase de testes é restrita a pessoas convidadas. Um campo de idade apenas declarado não é proteção suficiente e não deve ser criado como solução.

Decidir e documentar antes de liberar qualquer atendimento a menores:

- [ ] **Público elegível do piloto:** somente maiores de 18 anos? Adolescentes com responsável? Crianças?
- [ ] **Aferição de idade:** mecanismo confiável compatível com o ECA Digital (sem autodeclaração isolada); fornecedor, custo e dados tratados
- [ ] **Responsáveis legais:** criação da conta pelo responsável, vínculo verificável, consentimento específico (art. 14 LGPD) e painel de supervisão
- [ ] **Proteção de dados de estudantes:** coleta mínima, privacidade máxima por padrão, sem perfilamento comercial nem publicidade direcionada
- [ ] **Comunicação aluno–professor:** somente pela Plataforma; registro e moderação; proibição de contato privado externo com menores
- [ ] **Aulas online:** sem gravação; links pessoais; presença ou ciência do responsável conforme a idade; canal de denúncia
- [ ] **Prevenção de contato inadequado:** verificação reforçada de professores (antecedentes?), regras de conduta, denúncia e bloqueio, comunicação às autoridades
- [ ] **Visibilidade de perfis:** perfis de alunos menores não públicos; exibir o mínimo de dados aos professores
- [ ] Vigência e regulamentação aplicáveis da Lei nº 15.211/2025 e orientações da ANPD

## 5. Google OAuth (Google Cloud)

- [ ] Publicar os documentos e informar as URLs na tela de consentimento OAuth (Branding)
- [ ] Domínios autorizados: `edusearch.com.br`
- [ ] Manter somente os escopos `openid`, `email` e `profile` no login
- [ ] Antes de usar Google Agenda ou Meet: novo consentimento específico, atualização da Política e verificação do app pelo Google, se exigida

## 6. Acesso por e-mail — requisitos para sair do estágio "off"

O login por e-mail (`VITE_STAGE_EMAIL_AUTH`) e o cadastro por e-mail (`VITE_STAGE_EMAIL_SIGNUP`) começam desligados. Só promover a `testing` e depois a `production` quando:

- [ ] SMTP próprio configurado e validado no Supabase (domínio com SPF/DKIM/DMARC)
- [ ] Confirmação de e-mail obrigatória e funcionando (*Confirm email* ligado)
- [ ] Recuperação de senha funcionando ponta a ponta
- [ ] Redirect URLs liberadas: `/auth/confirmacao` e `/auth/nova-senha` dos domínios usados
- [ ] Rate limiting revisado (limites de e-mail e de login do Supabase) e CAPTCHA avaliado (ex.: Cloudflare Turnstile, gratuito)
- [ ] Controle real de admissão funcionando (hook *Before User Created* com allowlist)
- [ ] Política de vinculação de identidades revisada (Google × e-mail com o mesmo endereço; o app não vincula contas automaticamente)
- [ ] Termos e Política aprovados e publicados (o app impede `production` sem os links publicados)

## 7. Publicação

- [ ] Revisão jurídica concluída e registrada
- [ ] Todos os `[[REVISAR]]` resolvidos
- [ ] `status: aprovado`, `version` e `updated` atualizados nos dois arquivos
- [ ] Build do website sem erros (a trava de marcadores pendentes passa)
- [ ] Páginas conferidas no preview do Cloudflare Pages
- [ ] Variáveis `VITE_LEGAL_*` definidas no app e novo deploy
- [ ] Comunicação aos usuários de teste, se houver mudança relevante
