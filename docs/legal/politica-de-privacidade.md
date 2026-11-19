---
title: Política de Privacidade
slug: politica-de-privacidade
status: rascunho
version: 0.1
updated: 2026-11-18
description: Como o EduSearch trata dados pessoais de alunos, professores e visitantes, conforme a LGPD.
---

> **Versão preliminar para revisão jurídica.** Este documento ainda não está em vigor. Os trechos marcados como pendentes dependem de informações do responsável pela plataforma e de validação jurídica antes da publicação.

## 1. Sobre esta Política

Esta Política explica como o EduSearch trata dados pessoais no site edusearch.com.br e no aplicativo app.edusearch.com.br, em conformidade com a Lei Geral de Proteção de Dados Pessoais (LGPD — Lei nº 13.709/2018) e o Marco Civil da Internet (Lei nº 12.965/2014).

Ela descreve **o que acontece hoje**, na fase de testes, e indica separadamente os **tratamentos planejados**, que só começarão depois que esta Política for atualizada.

## 2. Controlador e contatos

O controlador dos dados pessoais é [[REVISAR: razão social ou nome completo do responsável]], inscrito(a) no [[REVISAR: CNPJ ou CPF]], com endereço em [[REVISAR: endereço completo]].

- **Encarregado pelo tratamento de dados (DPO) ou canal de privacidade:** [[REVISAR: nome do encarregado ou indicação do canal, considerando a Resolução CD/ANPD nº 2/2022 para agentes de pequeno porte]]
- **Contato para assuntos de privacidade:** [[REVISAR: e-mail ou canal dedicado a privacidade]]

## 3. Situação atual da Plataforma

- **Site institucional:** apresenta o projeto. Não exige cadastro e não usa cookies de publicidade ou de análise de audiência.
- **Demonstração do aplicativo:** usa somente dados fictícios. O que você faz nela fica salvo apenas no seu navegador e não é enviado ao EduSearch.
- **Conta real:** disponível somente para pessoas convidadas para os testes, por meio da conta Google e, quando liberado, por e-mail e senha.
- **Não estão ativos:** pagamentos, repasses, verificação de documentos, integração com agenda e videoconferência, e recomendações por inteligência artificial com dados reais.

## 4. Dados que tratamos hoje

| Situação | Dados | Origem |
| --- | --- | --- |
| Visita ao site ou ao aplicativo | Endereço IP, data e hora, navegador, sistema e páginas solicitadas | Coletados automaticamente pela infraestrutura de hospedagem (Cloudflare) |
| Login com Google | Identificador da conta Google, nome, e-mail, confirmação de que o e-mail é verificado e endereço da foto de perfil | Fornecidos pelo Google, com sua autorização na tela do Google |
| Conta e sessão | Identificador interno da conta, e-mail, nome, endereço da foto, método de login, datas de criação e de último acesso e tokens de sessão | Gerados pelo serviço de autenticação (Supabase) |
| Segurança da autenticação | Registros técnicos de acesso, que podem incluir endereço IP e navegador | Serviço de autenticação [[REVISAR: confirmar os registros mantidos pelo Supabase no plano e na configuração do projeto]] |
| Login por e-mail e senha (quando liberado) | E-mail, senha protegida por hash, status de confirmação do e-mail | Informados por você |
| Preferência de perfil (aluno ou professor) | Escolha entre "Quero aprender" e "Quero ensinar" | Informada por você e guardada **apenas no seu navegador** |

**O que não coletamos hoje:** as respostas do cadastro em etapas (objetivos, disciplinas, disponibilidade, biografia, valores e formação) são uma **prévia**. Elas ficam apenas na tela enquanto você preenche, não são enviadas nem salvas e são descartadas ao sair.

Não pedimos ao Google acesso à sua agenda, ao Gmail, ao Drive ou a contatos. Pedimos apenas os dados básicos de login: identificação, e-mail e perfil.

## 5. Finalidades e bases legais

| Finalidade | Dados | Base legal (LGPD, art. 7º) |
| --- | --- | --- |
| Criar e manter sua conta e permitir o login | Dados de conta e sessão | Execução de contrato ou de procedimentos preliminares (inciso V) |
| Proteger contas, prevenir fraudes e abusos | Registros técnicos e de acesso | Legítimo interesse (inciso IX) [[REVISAR: avaliação de legítimo interesse]] |
| Guardar registros de acesso exigidos por lei, quando aplicável | Registros de acesso a aplicações | Cumprimento de obrigação legal (inciso II), conforme o art. 15 do Marco Civil da Internet |
| Entregar o site e o aplicativo com segurança | Dados técnicos de navegação | Legítimo interesse (inciso IX) |
| Atender solicitações e reclamações | Dados de contato e da solicitação | Execução de contrato (inciso V) e exercício regular de direitos (inciso VI) |
| Enviar e-mails de confirmação e de recuperação de senha (quando liberado) | E-mail | Execução de contrato (inciso V) |

Entrar com o Google **não significa consentimento** para todo e qualquer uso dos seus dados. Cada tratamento tem finalidade e base legal próprias, descritas nesta Política. Quando o consentimento for a base legal, ele será pedido de forma específica e poderá ser revogado.

## 6. Dados de alunos e professores (planejados)

Quando o cadastro completo for liberado, poderemos tratar:

- **Alunos:** objetivo de aprendizagem, disciplinas de interesse, nível, dificuldades, disponibilidade, modalidade preferida e faixa de valor por aula, para recomendar professores e organizar as aulas.
- **Professores:** biografia, disciplinas, especialidades, formação, experiência, metodologia, valores, duração das aulas, modalidade e disponibilidade, para montar o perfil público e permitir agendamentos.
- **Verificação de professores:** documentos de formação, com armazenamento privado, acesso restrito e análise humana.

Esses tratamentos só começarão após a atualização desta Política, com as finalidades, bases legais, prazos e medidas de segurança correspondentes.

## 7. Dados financeiros (planejados)

Os pagamentos ainda não estão ativos. Quando forem ativados, os dados de pagamento serão tratados por um processador de pagamentos, que será identificado nesta Política. O EduSearch não pretende armazenar dados completos de cartões ou contas bancárias de alunos. Para os repasses, serão tratados os dados necessários ao recebimento pelos professores e ao cumprimento de obrigações legais e fiscais.

[[REVISAR: processador de pagamentos, dados compartilhados, bases legais e prazos de guarda de dados fiscais]]

## 8. Agenda e reuniões (planejados)

A integração com agenda e videoconferência (por exemplo, criação de eventos e links de aula) dependerá de uma **autorização separada e específica**, solicitada apenas quando você optar por usar esse recurso. Ela não faz parte do login com Google.

## 9. Recomendações com inteligência artificial (planejadas)

A Plataforma poderá usar recursos de inteligência artificial para sugerir professores compatíveis. Antes de usar dados reais com esse fim, informaremos o fornecedor, os dados envolvidos e a forma de solicitar a revisão de decisões automatizadas, nos termos do art. 20 da LGPD.

## 10. Serviços de terceiros que usamos hoje

| Fornecedor | Função | Dados envolvidos |
| --- | --- | --- |
| Google (Google Identity Services) | Login com conta Google | Dados básicos do perfil Google, conforme seção 4 |
| Supabase | Autenticação, contas e sessões | Dados de conta, sessão e registros de segurança |
| Cloudflare | Hospedagem, entrega do site e do aplicativo e proteção contra ataques | Dados técnicos de navegação |
| Provedor de e-mail transacional (quando o login por e-mail for liberado) | Envio de confirmação e recuperação de senha | E-mail e conteúdo da mensagem [[REVISAR: provedor de SMTP]] |

Esses fornecedores atuam como operadores ou como agentes independentes, conforme seus próprios termos. Não vendemos dados pessoais.

### 10.1 Dados do Google

O uso e a transferência de informações recebidas das APIs do Google seguem a Política de Dados do Usuário dos Serviços de API do Google, incluindo os requisitos de Uso Limitado. Os dados do Google são usados apenas para identificar você e manter sua conta no EduSearch. Não são usados para publicidade.

## 11. Cookies e armazenamento no navegador

O site institucional não usa cookies próprios. O aplicativo não usa cookies próprios e guarda informações no armazenamento local do navegador:

| Item | Onde | Para quê | Quando é apagado |
| --- | --- | --- | --- |
| `edusearch-auth` | Armazenamento local | Manter sua sessão (tokens de acesso e de renovação e dados básicos da conta) | Ao sair da conta ou limpar os dados do navegador |
| `edusearch-account-role:<identificador>` | Armazenamento local | Lembrar se você escolheu aprender ou ensinar | Ao sair da conta |
| `edusearch-theme` | Armazenamento local | Lembrar o tema claro ou escuro | Ao limpar os dados do navegador |
| `edusearch-demo-session`, `edusearch-demo-data`, `edusearch-match-request` | Armazenamento da sessão da aba | Funcionamento da demonstração (dados fictícios) | Ao fechar a aba ou sair da demonstração |
| Cache do aplicativo | Cache do navegador | Abrir o aplicativo mais rápido e sem conexão (apenas arquivos do aplicativo, sem dados pessoais) | Nas atualizações do aplicativo ou ao limpar o navegador |

O botão de login do Google é carregado a partir dos servidores do Google, que podem usar cookies próprios conforme a política de privacidade do Google.

Senhas e o token de identificação do Google nunca são guardados no navegador pelo EduSearch.

## 12. Segurança da informação

Adotamos medidas técnicas e administrativas compatíveis com a fase do projeto, entre elas:

- conexões criptografadas (HTTPS);
- senhas armazenadas apenas como hash pelo serviço de autenticação, sem acesso da equipe;
- verificação criptográfica do login com Google (com proteção contra reutilização);
- chaves secretas mantidas fora do aplicativo e do site;
- acesso restrito a dados de produção;
- controle de acesso no banco de dados [[REVISAR: políticas de segurança em nível de linha (RLS) revisadas e aprovadas]].

Nenhum sistema é totalmente imune a incidentes. Em caso de incidente de segurança que possa causar risco ou dano relevante, comunicaremos a ANPD e os titulares afetados, conforme o art. 48 da LGPD.

## 13. Compartilhamento de dados

Compartilhamos dados apenas:

- com os fornecedores da seção 10, na medida necessária para operar a Plataforma;
- entre aluno e professor, quando necessário para combinar e realizar aulas, quando esse recurso for liberado;
- com autoridades, quando houver obrigação legal, ordem judicial ou para proteger direitos.

## 14. Transferência internacional de dados

Alguns fornecedores (Google, Supabase e Cloudflare) podem tratar dados em servidores fora do Brasil. Essas transferências ocorrem conforme o art. 33 da LGPD e a regulamentação da ANPD.

[[REVISAR: região de hospedagem do projeto Supabase, países envolvidos e mecanismo de transferência adotado, como as cláusulas-padrão contratuais aprovadas pela ANPD]]

## 15. Por quanto tempo guardamos os dados

Usamos os seguintes critérios:

- **dados da conta:** enquanto a conta estiver ativa ou enquanto forem necessários para as finalidades desta Política;
- **após o pedido de exclusão:** os dados são eliminados ou anonimizados, salvo quando a lei exigir ou permitir sua conservação (art. 16 da LGPD);
- **registros de acesso a aplicações:** pelo prazo exigido pelo art. 15 do Marco Civil da Internet, quando aplicável;
- **registros técnicos dos fornecedores:** conforme a configuração e os prazos de cada fornecedor;
- **dados no seu navegador:** até você sair da conta ou limpar os dados do navegador, conforme a seção 11.

[[REVISAR: prazos efetivos de exclusão após o encerramento da conta, prazos de backups e de registros do Supabase e da Cloudflare]]

## 16. Seus direitos

Nos termos do art. 18 da LGPD, você pode solicitar:

- confirmação de que tratamos seus dados e acesso a eles;
- correção de dados incompletos, inexatos ou desatualizados;
- anonimização, bloqueio ou eliminação de dados desnecessários, excessivos ou tratados em desconformidade com a lei;
- portabilidade dos dados, conforme a regulamentação;
- eliminação dos dados tratados com base no consentimento;
- informação sobre com quem compartilhamos seus dados;
- informação sobre a possibilidade de não consentir e suas consequências;
- revogação do consentimento;
- oposição a tratamentos realizados com base em outras hipóteses legais, em caso de descumprimento da LGPD;
- revisão de decisões tomadas unicamente com base em tratamento automatizado (art. 20).

### 16.1 Como exercer seus direitos

Envie sua solicitação para [[REVISAR: canal de privacidade]]. Podemos pedir informações para confirmar sua identidade e proteger seus dados. A confirmação de existência ou o acesso aos dados serão fornecidos de forma simplificada imediatamente ou por declaração completa em até 15 dias, conforme o art. 19 da LGPD.

Você também pode apresentar reclamação à Autoridade Nacional de Proteção de Dados (ANPD).

### 16.2 Revogação do consentimento

Quando o tratamento depender do seu consentimento, você poderá revogá-lo a qualquer momento, de forma gratuita e facilitada, sem afetar os tratamentos já realizados. Revogar a autorização de acesso do EduSearch na sua conta Google interrompe novos logins com o Google, mas não exclui a conta no EduSearch. Para isso, faça um pedido de exclusão.

## 17. Crianças e adolescentes

O EduSearch é um produto educacional e poderá atender menores de 18 anos no futuro. Por isso:

- **durante a fase de testes, não são aceitas contas reais de menores de 18 anos;**
- quando esse atendimento for liberado, os dados de crianças e adolescentes serão tratados no seu melhor interesse, conforme o art. 14 da LGPD, o Estatuto da Criança e do Adolescente e a Lei nº 15.211/2025 (ECA Digital) e sua regulamentação;
- o tratamento de dados de crianças dependerá do consentimento específico de pelo menos um dos pais ou responsável legal, nos termos da lei;
- serão adotados mecanismos confiáveis de aferição de idade (a simples autodeclaração não será considerada suficiente), ferramentas para os responsáveis, configurações de privacidade mais protetivas por padrão, coleta mínima de dados e regras de comunicação e de segurança nas aulas;
- os dados de crianças e adolescentes não serão usados para publicidade direcionada ou para criação de perfis comerciais.

Se identificarmos uma conta real de menor de 18 anos criada durante a fase de testes, ela será suspensa e os dados serão tratados conforme a lei.

[[REVISAR: regras definitivas para crianças e adolescentes, conforme o checklist de publicação]]

## 18. Alterações desta Política

Esta Política pode ser atualizada para refletir novas funcionalidades, fornecedores ou exigências legais. Mudanças relevantes, especialmente o início dos tratamentos planejados, serão comunicadas antes de entrarem em vigor. A versão vigente e sua data ficam sempre disponíveis nesta página.

## 19. Contato

Para dúvidas sobre esta Política ou sobre seus dados: [[REVISAR: canal de privacidade]].
