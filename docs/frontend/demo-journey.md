# Jornada de demonstração do marketplace (Fase 2.2)

Jornada de ponta a ponta que funciona **sem backend**: entrar em modo demonstração, encontrar um professor, receber uma recomendação, reservar uma aula e ver o agendamento, inclusive na visão do professor.

> Tudo é **simulado no navegador** com dados fictícios. Não há autenticação real, IA (Gemini), Google Calendar/Meet nem pagamentos (AbacatePay).

## Roteiro para avaliadores (≈ 3 minutos)

1. Abra `http://localhost:5190` e clique em **Explorar demonstração**. Escolha **Quero aprender** e depois **Continuar como aluno**.
2. **Buscar:**
   - Em *Disciplina*, escolha *Matemática* (3 professores).
   - Em *Valor por aula*, escolha *Até R$ 80,00* (2 professores).
   - Em *Período*, escolha *Noite* (1 professora).
   - Para ver o estado vazio, escolha o nível *Graduação* e depois clique em *Limpar busca e filtros*.
3. **Assistente IA:**
   - Escreva um objetivo, escolha *Matemática* e *Pré-vestibular / ENEM* e marque uma dificuldade (por exemplo, *Resolver exercícios e provas*).
   - Escolha as preferências e clique em **Ver professores recomendados**.
   - Abra *Como a compatibilidade é calculada* para ver os critérios.
4. Abra o perfil da **Profa. Marina Duarte** e clique em um dos **Próximos horários disponíveis**.
5. Clique em **Continuar** e depois em **Confirmar agendamento**. Aparece o aviso *Aula reservada* e a aula ganha o selo *Nova reserva* em **Minhas aulas**.
6. **Detalhes** mostra o código da reserva. **Cancelar** devolve o horário à agenda da professora.
7. Nos **Detalhes** da aula, clique em **Ver na agenda do professor**: a demonstração abre a visão do professor reservado e mostra a aula da *Ana (demonstração)*. Isso vale para qualquer professor, não só para a Marina.
8. Opcional: em *Escolha seu perfil → Quero ensinar*, ou em *Configurações → Professor exibido*, escolha outro professor fictício para ver a agenda, as aulas e os recebimentos dele.

## Fluxos e regras

### Identidades fictícias (`src/lib/demo.ts`)

| Visão | Pessoa | O que vê |
| ----- | ------ | -------- |
| Aluno | Ana (`s-ana`) | Aulas em que `studentId = s-ana` |
| Professor | **Qualquer um dos 6 professores fictícios** (padrão: Profa. Marina, `t-marina`) | Aulas em que `teacherId` é o professor da sessão |

- O professor exibido é guardado na sessão de demonstração (`teacherId`). O adapter mock o lê como a API real lerá o usuário pelo JWT, por isso a interface `DataSource` não recebe esse id.
- Uma reserva da Ana com **qualquer** professor aparece na agenda **desse** professor e em nenhuma outra.
- Formas de trocar o professor exibido:
  - *Escolha seu perfil → Quero ensinar*.
  - *Configurações → Professor exibido*.
  - O atalho **Ver na agenda do professor**, nos detalhes de uma aula do aluno.
- Trocar de perfil usa `switchRole(sessão, destino)`. A sessão e o destino mudam juntos, e o guard de rotas leva ao destino certo, sem cair na home do outro perfil.

### Horários disponíveis

- A janela vai **de amanhã até 7 dias à frente**.
- **Todos os professores** têm grade semanal editável (*Professor → Disponibilidade*, na visão de cada um). Os horários vão de hora em hora dentro dos intervalos, e a aula precisa terminar dentro do intervalo. Mudar a grade muda os horários que o aluno vê.
- **Grades iniciais:**
  - Profa. Marina: seg–sex, 14h–17h e 19h–21h.
  - Demais professores: seg–sáb, conforme os períodos de cada um (manhã 8h–12h, tarde 14h–18h, noite 19h–21h).
- **Horário livre** = candidato futuro sem nenhuma aula *agendada* do professor que se sobreponha a ele.

### Regras da reserva (`src/lib/data/mock/adapter.ts`)

| Regra | Resultado |
| ----- | --------- |
| Horário já reservado (ex.: outra aba) | `409`: "Este horário acabou de ser reservado. Escolha outro." O botão de confirmar é desabilitado e aparece o atalho *Escolher outro horário*. |
| Aluno já tem aula sobreposta (outro professor) | `409`: "Você já tem uma aula neste horário (…)" |
| Horário fora da grade ou no passado | `409`: "Este horário não está mais disponível." |
| Disciplina que o professor não ensina | `422` |
| Cancelar aula futura agendada | Status vira *Cancelada* e o horário **volta a ficar livre** na hora |
| Cancelar aula passada, concluída ou já cancelada | `409`: "Esta aula não pode mais ser cancelada." |

- Após confirmar, a navegação usa `replace`: o botão "voltar" do navegador não reabre o resumo de uma reserva já feita.
- Nenhuma cobrança é feita. O valor exibido é o preço por aula do professor.

### Matching demonstrativo

Regra local, determinística e explicada na própria tela. Não é IA.

| Critério | Pontos | Observação |
| -------- | -----: | ---------- |
| Disciplina | 40 | **Obrigatório**: sem ele, o professor não é recomendado |
| Nível de ensino | 20 | Se não atende, vira ponto de atenção |
| Metodologia preferida | 15 | Sem preferência informada, conta como compatível |
| Dificuldades | 5 | Mapeadas para metodologias (ver abaixo) |
| Horários (períodos) | 10 | Se não atende, vira ponto de atenção |
| Orçamento | 10 | Acima do orçamento vira ponto de atenção |

Dificuldade → metodologias que ajudam:

| Dificuldade | Metodologias |
| ----------- | ------------ |
| Falta de base | base teórica |
| Exercícios e provas | resolução de exercícios |
| Aplicar na prática | aulas práticas, projetos |
| Falar e me expressar | conversação |
| Organizar os estudos | projetos, base teórica |

A ordenação usa pontuação (decrescente), depois preço (crescente) e depois nome.

### Perfil e especialidades de cada professor

Cada professor fictício tem perfil, especialidades e grade próprios. Edições feitas na visão de um professor (nome, título, bio, valor, duração, metodologias, disciplinas, níveis) passam a valer para o aluno na busca, no matching e no perfil daquele professor. Valor e duração novos valem para **novas** reservas.

## Estrutura de estado

```text
sessionStorage
├── edusearch-demo-session   { role, name, teacherId? }      ← sessão de demonstração (src/app/session.tsx)
├── edusearch-demo-data      { version: 3, lessons[],        ← "banco" da demonstração (adapter mock)
│                              profiles{}, specialties{},       por professor (chave = id do professor)
│                              availability{} }
└── edusearch-match-request  último pedido do assistente     ← para recarregar /aluno/recomendados
localStorage
└── edusearch-theme          system | light | dark
```

- Dados fictícios apenas: nenhuma senha, token ou dado pessoal real.
- O estado é por aba: fechar a aba descarta tudo.
- **Sair da demonstração** e *Configurações → Restaurar dados* voltam ao estado inicial.
- `version` invalida dados salvos por versões anteriores da estrutura.

## Dados sintéticos (`src/lib/data/mock/fixtures.ts`)

- **6 professores fictícios.** Nenhuma avaliação ou credencial "verificada"; as formações são marcadas como fictícias.
- **16 aulas iniciais:**
  - 6 da Ana: 2 futuras, 3 concluídas e 1 cancelada.
  - 7 de outros alunos fictícios com a Marina.
  - 3 de outros alunos com o Prof. Rafael e a Profa. Luiza, para que mais de um professor tenha agenda própria.
- Todas as datas são relativas ao dia atual, então a demonstração não "envelhece".

## Arquitetura e integração futura

As telas continuam dependendo apenas da interface `DataSource`. Nesta fase não foi criado nenhum endpoint nem contrato novo. A troca do mock pela API exigirá:

| Necessidade | Método | Observação para o contrato |
| ----------- | ------ | -------------------------- |
| Horários livres | `listTeacherSlots` | Calcular no servidor: grade − aulas agendadas, com fuso |
| Reservar | `createBooking` | Reproduzir as regras acima, incluindo o `409` para conflito e sobreposição |
| Cancelar | `cancelLesson` | Política de prazo e reembolso a definir; liberar o horário |
| Matching | `matchTeachers` | Gemini deve devolver `score`, `reasons[]` e `cautions[]` legíveis |
| Visões aluno/professor | `listStudentLessons`, `listTeacherLessons`, perfil, especialidades, disponibilidade, recebimentos | Identificar o usuário pelo JWT do Supabase; na demonstração vem da sessão (`teacherId`) |
| Reset da demonstração | `resetDemoData?` | Opcional, **só no mock**; a API não implementa |

Detalhes gerais em [api-integration.md](api-integration.md).

## Testes

`scripts/journey.mjs` percorre a jornada pela interface (cliques e digitação), no Chrome headless, contra o **servidor de desenvolvimento** (StrictMode). Execução: `pnpm --filter @edusearch/web journey`. Resultados em [qa.md](qa.md#fase-22--jornada-funcional-do-marketplace).
