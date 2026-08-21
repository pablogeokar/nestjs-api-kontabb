# Baseline de performance do PostgreSQL

## Medição de 12/07/2026

Medição somente leitura no banco configurado:

- `guias`: 28 linhas;
- `clientes`: 14 linhas;
- `visualizacoes_guias`: 6 linhas.

A consulta representativa da listagem de guias de um cliente, filtrando por
`cliente_id`, ordenando por `vencimento DESC` e limitando em 15 linhas, escolheu
`Seq Scan` seguido de `Sort`. Para esse volume, o custo estimado foi baixo e criar
um índice composto apenas aumentaria custo de escrita e armazenamento.

## Decisão

Não adicionar agora os índices candidatos `(cliente_id, vencimento)` ou
`(cliente_id, status, vencimento)`. Repetir `EXPLAIN (ANALYZE, BUFFERS)` em uma
branch segura do Neon quando ocorrer uma destas condições:

- a tabela alcançar aproximadamente 10 mil guias;
- a latência p95 da listagem ultrapassar 200 ms;
- surgirem filtros combinados frequentes por cliente, status e vencimento.

Somente depois dessa medição deve ser criada uma migration de índice, usando
criação concorrente se o volume e o runner justificarem.
