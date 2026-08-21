# Estratégia de datas e fusos horários

## Decisão atual

- `vencimento` é um conceito civil sem horário e permanece como `date`.
- A situação `VENCIDO` é derivada comparando `vencimento` com a data civil de
  `America/Bahia`; o banco persiste somente `PENDENTE` ou `PAGO`.
- Eventos continuam temporariamente em `timestamp without time zone`. Todas as
  escritas da aplicação usam instantes UTC (`Date`) e devem ser interpretadas
  como UTC durante a futura conversão.

## Migração futura para `timestamptz`

A mudança será feita separadamente da migration de status, depois de validar uma
amostra dos horários no Neon. Para cada coluna de evento:

1. comparar valores do banco com logs/request IDs conhecidos;
2. confirmar que os valores históricos representam UTC;
3. converter com `TYPE timestamptz USING coluna AT TIME ZONE 'UTC'`;
4. validar contagens, mínimos, máximos e amostras antes/depois;
5. publicar o schema da API com `{ withTimezone: true }` somente após aplicar a
   migration.

Se a amostragem revelar valores gravados como horário local, a tabela e o período
afetados deverão ser corrigidos explicitamente; não se deve aplicar uma conversão
global baseada em suposição.

## Rollback da migration 0012

O rollback reabre o valor persistido `VENCIDO` e o recompõe pela mesma regra de
data usada na aplicação:

```sql
ALTER TABLE guias DROP CONSTRAINT IF EXISTS chk_guias_status;
ALTER TABLE guias
  ADD CONSTRAINT chk_guias_status
  CHECK (status IN ('PENDENTE', 'VENCIDO', 'PAGO'));

UPDATE guias
SET status = 'VENCIDO'
WHERE status = 'PENDENTE'
  AND vencimento < (CURRENT_TIMESTAMP AT TIME ZONE 'America/Bahia')::date;
```
