# Credenciamento de professores

## Fonte de verdade e estados

O perfil público continua em `public.teacher_profiles`; o dossiê de credenciamento está em
`private.teacher_verifications` e é separado deliberadamente para não expor dados sensíveis pela
Data API. A submissão aceita somente `draft` ou `changes_requested` e passa para `submitted`.
Estados posteriores (`under_review`, `approved`, `rejected` e `suspended`) são decisões humanas e
serão acionados exclusivamente pelo RBAC administrativo após a integração da PR de Admin V1.

Não existe aprovação automática. Enquanto o dossiê está em análise, a submissão redefine o perfil
para `verification_status = pending` e `is_published = false`. Portanto, um professor não se torna
pesquisável, não recebe novas reservas e não passa pelas verificações financeiras de professor
publicado apenas por enviar dados ou arquivos.

## Documentos e privacidade

Os arquivos ficam no bucket privado `teacher-verification`. As políticas de `storage.objects`
permitem somente que o titular autenticado envie e leia objetos na pasta `<auth.uid()>/`; não há
política de atualização ou exclusão. Uma nova versão usa outro objeto, preservando a trilha de
auditoria.

Tipos permitidos: PDF, PNG e JPEG; limite: 10 MiB por objeto. O registro na API volta a conferir
titularidade, pasta, MIME e tamanho consultando `storage.objects`. Cada documento começa em
`quarantined`, sem atribuir qualquer qualificação verificada. A revisão humana deve aceitar ou
rejeitar o documento antes de uma decisão de credenciamento.

O endpoint nunca retorna URL pública, conteúdo de documento, data de nascimento ou os quatro
dígitos do CPF/CNPJ. O identificador fiscal integral não é duplicado no dossiê: permanece somente
no fluxo de conta de recebimento/subconta que já faz a validação junto ao provedor.

## Fluxo do professor

1. Salvar `PUT /v1/me/teacher-verification` com a declaração profissional e a versão dos termos.
2. Enviar objetos diretamente ao Storage autenticado, sob a pasta do próprio usuário.
3. Registrar cada objeto em `POST /v1/me/teacher-verification/documents`.
4. Enviar para análise em `POST /v1/me/teacher-verification/submit`.

São obrigatórios, no mínimo, um documento de identidade e uma comprovação acadêmica. O servidor
deriva o titular do JWT; a requisição não aceita `teacher_id`, estado de aprovação, revisor ou
campo de publicação.

## Operação e retenção

O bucket é privado e deve continuar sem URL pública. Links temporários, quando a interface de
revisão for integrada, devem ser emitidos apenas após autorização administrativa e com a menor
validade possível. Consultas e decisões de revisão precisam registrar o ator e justificativa no
log privado. A política final de retenção e descarte seguro depende de revisão jurídica/LGPD e não
é substituída por esta migration.

Nenhuma migration deste fluxo deve ser aplicada no Supabase hospedado sem aprovação operacional e
sem a validação prévia em banco descartável, RLS e Security Advisor.
