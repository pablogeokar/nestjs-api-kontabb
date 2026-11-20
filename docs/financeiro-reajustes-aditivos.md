# Reajustes anuais e aditivos contratuais

## Viabilidade e decisão

O cadastro anterior mantinha somente os parâmetros mais recentes do contrato.
Isso não permitia reconstruir um instrumento anterior nem faturar uma competência
antiga com suas condições próprias. A implementação acrescenta versões com
vigência mensal e mantém o agendamento financeiro diário existente.

O percentual anual é **informado e revisado pela equipe antes de confirmar**.
Não há consulta automática ao IPCA nem reajuste sem revisão. A justificativa deve
identificar o índice e o período conferidos. O sistema disponibiliza uma minuta de
aditivo; registrá-la não significa que as partes já a assinaram.

## Fluxo operacional

1. Em Financeiro → Contratos, abrir **Reajustes e aditivos**.
2. Informar percentual, competência de vigência, justificativa, local e data da assinatura.
3. Selecionar **Revisar novos valores** e conferir a mensalidade e cada serviço.
4. Confirmar para registrar o reajuste e gerar o aditivo numerado.
5. Imprimir a minuta no histórico para colher as assinaturas fora do sistema.

Ao editar os parâmetros de um contrato, informar a competência e o motivo da
alteração. Mudanças efetivas em valores, serviços, adicionais, descontos, prazos,
fechamento, vencimento e condições geram aditivos automaticamente. Salvar os
mesmos dados ou somente observações internas não gera um aditivo.

A listagem mostra as últimas condições registradas e sua competência de vigência.
Uma condição futura não antecipa o faturamento: a geração da fatura, inclusive seu
dia de fechamento, usa a versão válida na competência faturada. O histórico
mostra os valores anteriores e posteriores e as alterações de cada aditivo.

## Regras e garantias

- O intervalo mínimo anual parte do início do contrato ou da última vigência anual.
  Quando o aniversário cai no meio de um mês, a primeira competência elegível é o
  mês seguinte, para respeitar 12 meses completos sem criar rateio diário.
- O percentual positivo tem até quatro casas decimais e é aplicado aos honorários
  de cada serviço, arredondando em centavos. A nova mensalidade é a soma desses
  serviços. Cadastros antigos precisam ter os serviços e as partes discriminados
  antes do primeiro reajuste anual.
- Valores fixos de adicionais e descontos não são reajustados implicitamente.
  Sua alteração deve ser explicitada na edição do contrato e constará no aditivo.
- Não é permitida vigência anterior à competência atual, ao início do contrato ou
  à última alteração já registrada. A data original de início não é redefinida.
- Competências com faturas já emitidas, inclusive canceladas, ficam preservadas.
  Escolher uma vigência posterior a todas as faturas já emitidas para o cliente.
- Um bloqueio transacional por cliente coordena alterações e faturamento. A versão
  esperada impede confirmar dados que foram modificados por outra pessoa.
- A sequência de aditivos é única por contrato. Cada registro conserva as condições
  anteriores/posteriores, as partes, a justificativa e o usuário responsável.
- Itens removidos são arquivados, preservando referências e valores históricos.
- O PDF original passa a usar os dados anteriores ao primeiro aditivo. PDFs de
  aditivos usam suas próprias informações preservadas, sem consultar o cadastro
  atual do cliente para substituir as partes.
- O histórico começa após a implantação; não é possível recuperar modificações
  feitas anteriormente. Completar e revisar cadastros legados antes de reajustar.
  A conclusão de um cadastro ainda sem instrumento completo estabelece sua base
  original; alterações posteriores passam a gerar aditivos. Registros antigos
  incompletos não recebem dados de qualificação inventados.

## API

Todas as rotas exigem sessão de ADMIN ou COLABORADOR:

| Método | Rota relativa a `/api/admin/financeiro/contratos/cliente/:clienteId` |
| --- | --- |
| GET | `/aditivos` |
| POST | `/reajustes/previa` |
| POST | `/reajustes` |
| GET | `/aditivos/:aditivoId/pdf` |

O reajuste recebe `percentual`, `competenciaInicio` (`MM/AAAA`), `motivo` e
`versaoEsperada`; `dataAssinatura` e `localAssinatura` complementam a minuta.
A edição existente aceita `competenciaInicioAditivo`, `motivoAditivo`,
`versaoEsperada`, `dataAssinaturaAditivo` e `localAssinaturaAditivo`.

## Implantação

1. Fazer backup conforme o procedimento operacional do ambiente.
2. Aplicar a migration `0005_sloppy_jocasta.sql` com `pnpm db:migrate` na API.
3. Publicar a API e depois o frontend.
4. Conferir uma prévia de reajuste, o histórico e a impressão de uma minuta.

A migration é aditiva: contratos existentes recebem versão 1; nenhum valor de
mensalidade é alterado por ela. A tabela de aditivos é criada vazia, e itens atuais
permanecem sem data de remoção. Não há migração de banco no deploy do frontend.

Não é necessário um cron adicional. A chamada diária já configurada em
`/api/cron/financeiro-rotina-mensal` resolve a versão vigente antes de selecionar o
fechamento e antes de gerar os lançamentos da fatura.

## Validação em ambiente isolado

Os testes novos de persistência exigem `TEST_DATABASE_URL` apontando para um banco
descartável cujo nome termine em `_test`. Os testes existentes do financeiro usam
`DATABASE_URL`; definir ambas para o mesmo banco isolado. Nunca executar a suíte
de integração contra o banco operacional.

Executar as suítes `src/financeiro`, a verificação `db:check`, os builds da API e do
frontend e o teste Playwright `tests/e2e/contrato-aditivos.spec.ts`. A fixture de
interface é gerada por `node scripts/prepare-contratos-fixture.mjs` no frontend;
o teste usa chamadas HTTP simuladas no navegador, enquanto a API é validada
separadamente por HTTP e por integração com PostgreSQL real.
