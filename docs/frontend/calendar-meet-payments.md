# Agenda, aula online, checkout Pix e incentivos (Fase 2.3)

Frontend dos módulos de **calendário (Google Agenda)**, **aula online (Google Meet)**, **checkout Pix (AbacatePay)** e **comissão e incentivos do professor**. Nenhuma integração externa está ativa: tudo o que depende de backend é simulado e identificado na interface.

## O que funciona na demonstração × o que depende do backend

| Módulo | Funciona na demonstração | Depende do backend (não implementado) |
| ------ | ------------------------ | ------------------------------------- |
| Reserva | Reserva solicitada → aguardando pagamento → confirmada; o horário fica reservado enquanto o pagamento está pendente; conflitos (409) | Persistência, concorrência real e regras definitivas |
| Checkout Pix | Resumo, estados da cobrança, contagem regressiva, ações **"Simular…"** (confirmação, falha, expiração), bloqueio de confirmação repetida | Criação da cobrança na AbacatePay, QR Code e Copia e Cola reais, webhooks e conciliação |
| Calendário | Semana e mês, aulas anteriores e próximas, disponibilidade, bloqueio de dias, conflitos, exportação **.ics local** | Sincronização real com o Google Agenda (OAuth e eventos) |
| Aula online | Tela própria com dados da aula, seis estados, instruções, materiais fictícios e painel pré-aula ilustrativo | Criação da reunião no Google Meet e envio do link |
| Recebimentos | Comissão de **15%**, parcela do professor e saldo estimado (só pagamentos confirmados) | Cálculo oficial, tarifas do gateway, split, repasses e saques |
| Incentivos | Comissão padrão e atual, metas e conquistas de exemplo, painel de indicações | Regras aprovadas de desconto, validação de indicações, antifraude e estornos |

## Ciclo da reserva e do pagamento

```text
Reserva solicitada ──(gerar cobrança)──▶ Aguardando pagamento ──(confirmação)──▶ Em processamento ──▶ Confirmada
  (aula pending_payment,                  (cobrança pending,                                           (aula scheduled,
   sem cobrança)                            prazo de validade)                                          pagamento confirmed)
          │                                        │
          ├── cancelar ───────▶ Cancelada          ├── falha ──▶ Falha (pode gerar nova cobrança)
          │                                        └── expirar ─▶ Expirada → reserva cancelada, horário liberado
```

- **Reserva solicitada:** a aula existe em `pending_payment` e ainda não tem cobrança. O horário já fica reservado.
- **Aguardando pagamento:** a cobrança Pix foi criada (`pending`) e tem validade. Na demonstração, a validade é de 15 minutos e o prazo aparece como simulado.
- **Confirmada:** só depois da confirmação do pagamento. Na demonstração, isso acontece apenas pela ação explícita **"Simular confirmação de pagamento"**.
- **Cancelar:**
  - Se a reserva ainda não foi paga, a cobrança aberta é cancelada.
  - Se já foi paga, o pagamento continua registrado e o reembolso fica "a definir". **Nenhum reembolso é simulado.**
- **Idempotência:** criar a cobrança de novo devolve a cobrança aberta, e confirmar de novo é recusado (`409`).
- **Atualização:** com a cobrança aberta, a tela consulta o status a cada 3 segundos. É assim que a confirmação chegará da API no sistema real.

### Estados financeiros

| Estado | Rótulo | Na demonstração |
| ------ | ------ | --------------- |
| `creating` | Aguardando criação da cobrança | Indicador de carregamento |
| `pending` | Aguardando pagamento | QR Code simulado (não pagável), Copia e Cola indisponível, prazo |
| `processing` | Pagamento em processamento | Transitório, durante a simulação |
| `confirmed` | Pagamento confirmado | Sempre com "(simulação)" |
| `expired` | Cobrança expirada | Reserva cancelada e horário liberado |
| `cancelled` | Cobrança cancelada | Reserva cancelada |
| `failed` | Falha no pagamento | É possível gerar nova cobrança |

### QR Code e Pix Copia e Cola

- O componente só exibe uma imagem quando a cobrança vier **não simulada** e com `pix.qrCodeImageUrl`. Na demonstração, mostra um placeholder **sem nenhum padrão parecido com um QR Code** e com o texto "não pagável".
- O botão **Copiar** fica desabilitado sem `pix.copyPasteCode` real. Nenhum payload Pix é gerado no frontend.

## Calendário

- **Aluno (Minhas aulas):** cartões de próxima aula, pagamento e progresso; alternância **Calendário | Lista**; no calendário, **Semana | Mês**. A lista mantém as abas *Próximas / Concluídas / Canceladas*.
- **Professor (Agenda):**
  - Aulas confirmadas, aguardando pagamento e canceladas, além dos horários livres.
  - **Bloquear dia:** o dia deixa de oferecer horários, e as aulas já marcadas continuam ativas.
  - **Conflitos:** aula ativa em dia bloqueado ou fora da grade atual.
  - Os detalhes da aula mostram o nível e o objetivo do aluno fictício.
- **Teclado:**
  - Na grade do mês: setas (±1 dia e ±1 semana), Home/End (início e fim da semana) e PageUp/PageDown (mês).
  - Nos controles segmentados: setas.
- **Google Agenda:**
  - Cartão com estado conectado ou não conectado, com **"Simular conexão"** (nenhuma conta é acessada e nenhum token é guardado).
  - **"Adicionar ao Google Agenda"** só para aula confirmada e com a conexão simulada; os estados de sincronização (pendente, sincronizando, adicionada, falha) são simulados.
- **Exportar .ics (arquivo local):** arquivo iCalendar (RFC 5545) gerado no navegador, sem link de reunião. Não é a sincronização com o Google Agenda.

## Aula online (Google Meet)

- A mesma tela serve ao aluno (`/aluno/aulas/:id`) e ao professor (`/professor/aulas/:id`).
- **Estados**, derivados do horário e da reserva:

  | Estado | Quando |
  | ------ | ------ |
  | Agendada | Mais de 24 h antes do início |
  | Aguardando horário | Até 24 h antes |
  | Pronta para iniciar | 15 min antes do início |
  | Em andamento | Entre o início e o fim |
  | Finalizada | Após o fim |
  | Cancelada | Reserva cancelada |

  O seletor "Pré-visualizar estados" (só na demonstração) muda apenas a aparência, identificada como pré-visualização.
- **Botão "Entrar no Google Meet"** só aparece com uma URL `https://meet.google.com/xxx-xxxx-xxx` vinda da API (`isTrustedMeetUrl`). Sem link, a tela mostra "Link disponível após a confirmação…" ou "Google Meet ainda não conectado". **Nenhum link é inventado.**
- **Painel pré-aula:** os botões de microfone e câmera são ilustrativos ("nenhum dispositivo é acessado"). Não há videochamada, iframe ou simulação de reunião.

## Comissão e incentivos

- **Regra oficial:** comissão padrão do EduSearch de **15%** (`STANDARD_COMMISSION_BPS = 1500` em `src/lib/commission.ts`).
  - Os cálculos usam centavos e basis points inteiros, com arredondamento meio para cima: `(valor × 1500 + 5000) ÷ 10000`.
  - A comissão e a parcela do professor somam exatamente o valor da aula.
  - Exemplo: R$ 100,00 → R$ 15,00 de comissão e R$ 85,00 de parcela bruta do professor.
  - Tarifas do gateway são contabilizadas **à parte** (exibidas como "A informar").
- **Histórico:** até a Fase 2.2 a demonstração usava a hipótese de **10%**, citada assim no QA das fases anteriores.
- **Recebimentos:**
  - Os totais consideram **só pagamentos confirmados**.
  - Reservas aguardando pagamento aparecem como "Não recebido", fora dos totais.
  - Aula paga e cancelada aparece como "Cancelada após pagamento", com "Reembolso a definir".
  - Não existe estado "repassado".
- **Incentivos:**
  - **Comissão atual = padrão (15%)**, porque **nenhuma faixa de desconto foi aprovada**. Benefícios ativos: nenhum. Economia acumulada: R$ 0,00.
  - Metas e conquistas usam dados verificáveis da demonstração (aulas concluídas, perfil completo), identificados como **exemplo**. As recompensas são "a definir". Não há níveis Bronze/Prata/Ouro nem percentuais arbitrários.
- **Indicações:**
  - O código é ilustrativo (`DEMO-NOME`), o link público é **null** ("disponível após a integração") e "Copiar link" fica desabilitado.
  - Os números de exemplo são sintéticos, e **cadastros não geram recompensa**.
- **Responsabilidade:** o frontend apenas **exibe**. O cálculo oficial (comissão, descontos, split) será feito pelo backend FastAPI e aplicado ao fluxo financeiro da AbacatePay.

## Marcas de terceiros

Não há arquivos oficiais do Google Meet, do Google Agenda nem da AbacatePay no repositório, e não baixei nenhum (isso dependeria de autorização). Por isso a interface usa apenas os **nomes em texto** e ícones genéricos do design system. Aplicar as marcas oficiais exige obter os arquivos e seguir as diretrizes de cada empresa. Fica como pendência.

## Componentes e arquivos

| Arquivo | Conteúdo |
| ------- | -------- |
| `src/lib/commission.ts` | Regra de 15%, divisão do valor e formatação de basis points |
| `src/lib/calendar.ts` | Datas locais, semana e grade do mês, conflitos |
| `src/lib/meeting.ts` | Validação de URL do Meet e estados da aula online |
| `src/lib/ics.ts` | Exportação .ics local |
| `components/CalendarView.tsx` | Calendário semanal e mensal compartilhado |
| `components/LessonDetailsDialog.tsx` | Detalhes da aula e cancelamento, compartilhados |
| `components/Integrations.tsx` | `GoogleCalendarCard`, `MeetJoinPanel` |
| `components/Pix.tsx` | `PixQrCode`, `PixCopyPaste` |
| `components/StatusBadges.tsx` | Status da aula e do pagamento |
| `pages/student/Checkout.tsx` | Checkout Pix |
| `pages/shared/OnlineLesson.tsx` | Aula online (aluno e professor) |
| `pages/teacher/Agenda.tsx`, `Earnings.tsx`, `Benefits.tsx` | Agenda, recebimentos e comissão/incentivos do professor |
| `packages/ui`: `SegmentedControl`, `ProgressRing` | Novos componentes do design system |
