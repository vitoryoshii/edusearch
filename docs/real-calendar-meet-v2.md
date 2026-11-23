# Agenda real V2 e Google Calendar/Meet

## Fonte de verdade

- `GET /v1/me/lessons` devolve somente aulas das quais a conta autenticada participa. Ela contém o estado da reserva, o estado financeiro resumido (`awaiting_payment`/`expired`), a situação de sincronização e a URL do Meet, quando a API a confirmou.
- `GET /v1/me/availability` devolve a disponibilidade semanal configurada pelo professor. A agenda a apresenta como **recorrente**; ela não a anuncia como slot livre, pois conflitos e elegibilidade continuam sendo calculados no backend ao reservar.
- `lessons.calendar_sync_status`, `google_event_id` e `meet_url` são persistidos pelo backend. A interface nunca cria URL de Meet nem marca sincronização localmente.

## Lacunas encontradas e correção

O componente visual anterior (`CalendarView`) é usado pela demonstração e depende de seus view models locais. A agenda autenticada possuía conexão Google e edição de disponibilidade, mas levava as aulas reais somente para “Minhas aulas”.

`RealLessonCalendar` passa a consumir diretamente o contrato autenticado e oferece os modos dia, semana e mês, detalhes da aula, cancelamento permitido pelo servidor, tentativa de ressincronização exclusiva do professor e link Meet apenas quando a URL é confiável. Os horários são formatados em `America/Sao_Paulo`.

## Garantias mantidas

- Reserva continua idempotente e o backend continua sendo a autoridade para conflito/HTTP 409.
- O `BookingPanel` revalida os slots e limpa a seleção se o horário deixa de existir.
- A sincronização cria eventos com identificador persistente e o backend já evita criar novo evento para aula sincronizada.
- Pagamentos e agenda são desacoplados: a interface só mostra estados retornados pela API; não confirma Pix, split ou repasse.

## Homologação pendente

Os testes automatizados usam o cliente Google falso. Antes da demonstração pública, ainda é necessário validar em uma conta Google autorizada: consentimento, token revogado, criação de evento, Meet retornado pelo Google, repetição idempotente e cancelamento do evento. Essa homologação não deve consultar agendas pessoais fora dos escopos já aprovados.
