# Ciclo de vida de guias e objetos no R2

## Política técnica atual

- A exclusão solicitada por um administrador é definitiva para os registros de
  cliente ou guia no banco da aplicação.
- A alteração do PostgreSQL, a criação do evento de auditoria e o agendamento da
  limpeza do R2 acontecem em uma única operação atômica.
- Os objetos do R2 são removidos somente depois da confirmação do banco. Falhas
  ficam em `storage_cleanup_jobs` com status `FALHOU` e podem ser repetidas sem
  alterar novamente o registro já excluído.
- O cron executa uma limpeza automática diária. Cada job é reivindicado de forma
  atômica como `PROCESSANDO`; execuções concorrentes não processam a mesma linha.
  Um claim interrompido volta a ser elegível após 15 minutos.
- Eventos de auditoria, jobs concluídos e registros de visualização não possuem
  expurgo automático até existir uma política formal de retenção.
- A auditoria guarda apenas metadados mínimos; não armazena conteúdo dos arquivos,
  credenciais, URLs assinadas ou tokens.

## Operação

O endpoint `POST /api/admin/storage/cleanup` exige uma sessão de ADMIN, processa
até 50 jobs pendentes ou com falha e pode ser chamado repetidamente. `DeleteObject`
é tratado como uma operação idempotente.

O cron `GET /api/cron/storage-cleanup` processa até 50 jobs diariamente e exige
`Authorization: Bearer <CRON_SECRET>`. A agenda `0 3 * * *` usa UTC, equivalente
a 00:00 no fuso de Bahia. O próximo cron ou a execução administrativa retomam
jobs `FALHOU` e claims abandonados.

O endpoint diagnóstico `POST /api/admin/storage/reconcile` também exige ADMIN e
compara, em lotes de até 100 itens, as referências do PostgreSQL com os objetos
do R2. A resposta usa cursores e fingerprints; keys completas não atravessam a
API. A operação é somente leitura e não remove órfãos automaticamente.

Depois de uma exclusão ou execução do job, monitore:

```sql
SELECT status, count(*)
FROM storage_cleanup_jobs
GROUP BY status;

SELECT id, object_key, tentativas, ultimo_erro, criado_em
FROM storage_cleanup_jobs
WHERE status = 'FALHOU'
ORDER BY criado_em;
```

`PROCESSANDO` por mais de 15 minutos não exige intervenção: o lease expirado é
automaticamente reivindicado. Investigue se o mesmo job acumular falhas.

## Decisão organizacional pendente

Antes de configurar expurgo automático, o responsável jurídico/contábil deve
definir prazos mínimos para guias de pagamento, documentos fiscais, eventos de
auditoria e registros de visualização.
