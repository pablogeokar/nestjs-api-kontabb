# Reaplicar parâmetros do Simples Nacional em produção

As apurações gravadas referenciam `fiscal_simples_tabelas`. Algumas já estão fechadas; por isso, não use `TRUNCATE` nem apague tabelas normativas antigas. A limpeza aqui é **lógica**: a seed cadastra a versão `LC_155_2016_REV_2026_11_R2`, desativa versões antigas que concorrem com ela até 2026 e preserva todas as linhas históricas. A operação ocorre em uma transação.

A versão R2 contém os cinco anexos, as seis faixas de cada anexo e a partilha correta por faixa, inclusive a 3ª faixa do Anexo III. Os sublimites de 2025 e 2026 são atualizados para R$ 3.600.000,00 nas 27 UFs, mesmo quando já existia valor diferente ou inativo. A seed não cadastra sublimites para 2027; a apuração desse ano exige configuração normativa própria.

## 1. Prévia

Configure `DATABASE_URL` no ambiente de execução e, na pasta `api`, rode:

```bash
npm run db:simples:prever
```

O comando usa o `.env` da pasta `api`. A prévia mostra host, nome do banco, versões existentes, quantas apurações as referenciam e divergências de sublimite. Ela não altera dados.

## 2. Execução

Após conferir o host e o nome do banco na prévia, execute:

```bash
npm run db:simples:reaplicar
```

O script cria automaticamente uma cópia em `~/.kontabb/backups/simples-nacional/`, com nome único e permissão `0600`, antes de alterar o banco. Ele imprime o caminho, executa a seed e verifica se a nova versão está ativa com 5 anexos e 30 faixas, e se os 54 registros de sublimite de 2025/2026 estão corretos. A execução repetida da seed é idempotente; se os valores da versão R2 forem diferentes dos previstos no código, ela falha em vez de modificar uma versão histórica.

Se precisar fixar o destino ou a identidade do banco, o script ainda aceita `--snapshot`, `--expect-database` e `--expect-host` como parâmetros opcionais.

## 3. Conferência das apurações

O sistema mostra a última apuração **salva**. Aplicar a seed não altera o valor de um rascunho existente: clique em **Recalcular** para criar uma nova versão vinculada à R2 e compare o resultado com o PGDAS-D. Apurações fechadas continuam vinculadas à versão usada no fechamento; uma correção nelas exige o fluxo de retificação fiscal. A cópia JSON permite recuperar os parâmetros anteriores, enquanto as versões antigas permanecem armazenadas no banco.

Referências: [Anexos da LC 123/2006](https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm), [sublimite de 2025](https://www8.receita.fazenda.gov.br/simplesnacional/Noticias/NoticiaCompleta.aspx?id=24d7bd11-494d-4ed4-8e28-bb59a8d480e7) e [sublimite de 2026](https://www8.receita.fazenda.gov.br/simplesnacional/Noticias/NoticiaCompleta.aspx?id=94c10cc2-7eb5-4ef0-bfb2-5479e72caff8), publicados pelo CGSN.
