# Estratégia de identificadores e migração de UUIDs

Diagnóstico em 02/11/2026. Esta é uma proposta de migração com preservação dos
dados atuais e dos backups históricos; **nenhum tipo de coluna foi alterado**.

## Medição e decisão

O snapshot atual tem 54 tabelas, 47 chaves primárias UUID, 120 colunas UUID e
75 foreign keys UUID. `clientes.id` é referenciado por 33 foreign keys. No
PostgreSQL local, as tabelas públicas ocupam aproximadamente 18 MB: 9,2 MB de
heap e 5,5 MB de índices. Os índices de PK UUID somam 1 MB. A tabela mais
populosa, `documentos_fiscais_itens`, tem cerca de 8.124 linhas, 4,6 MB de
heap e 1,8 MB de índices. Essas medidas são desse banco, não uma projeção de
produção nem uma medição isolada do custo dos UUIDs.

Um UUID ocupa 16 bytes; `bigint`, 8; `integer`, 4. Trocar as três colunas UUID
de cada item fiscal (`id`, `documento_fiscal_id`, `cliente_id`) por `bigint`
economizaria, teoricamente, 24 bytes por item: ~195 KB em 8.124 itens ou
~24 MB em um milhão, antes de alinhamento, índices e TOAST. A economia real
precisa ser medida em um clone com os mesmos dados.

`gen_random_uuid()` no PostgreSQL 17 gera UUID v4 aleatório, o que pode
espalhar inserções no índice B-tree. A PK não determina a ordem física da
tabela nem a ordem dos resultados: consultas cronológicas precisam de
`ORDER BY` explícito e índices apropriados. Identidade sequencial também não
substitui uma coluna de data para regras fiscais ou auditoria.

| Conjunto | Decisão proposta | Motivo |
| --- | --- | --- |
| `clientes`, `contadores`, `funcionarios_rh` | Manter chave substituta; manter CNPJ/CPF como atributos de negócio com unicidade apropriada | `clientes` mistura PF/PJ e tem 33 FKs; `contadores` pode ter CPF ou CNPJ; `funcionarios_rh.cpf` é opcional. Correção de cadastro não deve reescrever toda a árvore de FKs. |
| Tabelas do Better Auth (`user`, `account`, `session`, `verification`) | Preservar IDs `text` | Contrato de autenticação externo ao plano. |
| `cfops` | Manter `codigo` como PK | Já usa chave natural curta e estável. |
| `eventos_auditoria`, `storage_cleanup_jobs` | Primeiro piloto para `bigint` identity | Não possuem FKs apontando para seus IDs. Verificar referências indiretas antes da troca. |
| `documentos_fiscais`, `documentos_fiscais_itens` | Avaliar `bigint` identity em clone | Crescem mais e têm respectivamente 6 e 4 FKs de entrada. Os itens já têm unicidade de `(documento_fiscal_id, numero_item)`, mas essa chave composta seria maior nas tabelas dependentes. |
| Demais tabelas | Manter UUID por ora | Baixo volume atual; mudar todas amplia o risco sem evidência de economia relevante. Para novas tabelas de alto volume, considerar `bigint` identity desde o início. |

`bigint` é a escolha inicial para tabelas de crescimento contínuo. Se uma
tabela tiver limite de cardinalidade bem definido, `integer` pode bastar. IDs
`bigint` expostos pela API devem ser serializados como strings, pois podem
ultrapassar o inteiro seguro do JavaScript. `GENERATED ... AS IDENTITY` e uma
PK/UNIQUE são necessários: a sequência sozinha não impõe unicidade.

## Migração com dados preservados

1. **Congelar e ensaiar o backup.** Guardar backup íntegro e um checkout do
   histórico de migrations anterior à nova baseline. Restaurar em banco
   isolado e registrar contagem e tamanho de cada tabela. O helper atual usa
   `COPY` data-only: UUIDs antigos não entram automaticamente em colunas
   `bigint` novas. O backup de 31/10/2026 é `.sql.gz` e contém comandos `COPY`
   com lista explícita de colunas, valores textuais escapados e estado de
   sequences. A conversão deve conhecer a versão do schema de origem.
2. **Auditar contratos fora das FKs.** Inventariar `ParseUUIDPipe`, `@IsUUID`,
   casts `::uuid`, geração por `crypto.randomUUID()`, tipos TypeScript,
   rotas/DTOs, `eventos_auditoria.entidade_id`,
   `storage_cleanup_jobs.entidade_id`, JSONB, arquivos e chaves de storage.
   IDs armazenados como texto não aparecem no catálogo de foreign keys.
3. **Piloto em clone.** Criar coluna `bigint` com identity e mapa
   `(id_uuid_antigo, id_bigint_novo)` para `eventos_auditoria`. Atualizar os
   consumidores e validar o restore. Só então repetir para
   `storage_cleanup_jobs`, caso o benefício justifique.
4. **Migrar o grafo fiscal em clone.** Atribuir IDs novos a
   `documentos_fiscais` e `documentos_fiscais_itens`; preencher todas as FKs
   dependentes por JOIN com o mapa; migrar as referências textuais/JSONB
   identificadas no passo 2; criar índices e constraints; validar FKs e
   unicidade antes de remover UUIDs antigos. Atualizar a API e o frontend no
   mesmo corte de contrato. Não presumir que os UUIDs só aparecem em FKs.
5. **Comparar antes/depois.** Confirmar contagens, valores, ausência de órfãos,
   integridade de arquivos e hashes, consultas críticas e restore completo.
   Medir `pg_total_relation_size`, tamanho dos índices, latência de inserção e
   planos de consulta com a mesma carga. Prosseguir apenas com ganho material
   e testes funcionais aprovados.
6. **Publicar nova baseline e backup compatível.** Gerar o SQL/snapshot Drizzle
   somente após a transformação estar homologada. Produzir novo backup data-only
   com IDs `bigint`; ajustar a sequência após `COPY` com IDs explícitos. Para
   restaurar backups históricos, usar o conversor especificado abaixo.
   Não apontar a nova baseline para o banco antigo ou tentar o `COPY` antigo
   diretamente no novo schema.
7. **Corte e rollback.** Preservar o banco e o backup anteriores até validar
   login, fiscal, RH, guias, auditoria e backup/restore no novo banco. Fazer o
   corte pela URL de conexão; em falha, retornar a URL e versão da API
   anteriores. Não destruir dados originais durante o ensaio.

## Script de conversão dos backups históricos

Criar um comando versionado no projeto `backup-restore`, por exemplo
`cmd/migrate-backup`, com entradas `-input antigo.sql.gz`, `-source-version`,
`-target-version`, `-expected-sha256`, `-output convertido.sql.gz` e
`-dry-run`. Ele deve usar o
formato de backup real, sem procurar/substituir UUIDs como texto no SQL:

1. Calcular SHA-256 do arquivo, comparar com `-expected-sha256` quando
   fornecido e verificar versão/colunas esperadas de cada bloco `COPY`.
   Backups antigos não registram versão do schema: exigir `-source-version`
   explícita e conferir sua assinatura de tabelas/colunas. Backups futuros
   devem incluir versão e hash do journal em um manifesto. Nunca sobrescrever o
   backup de entrada. Recusar tabela/coluna desconhecida e tabela ausente com
   dados; aceitar as três tabelas históricas removidas somente se vazias.
2. Criar **banco temporário isolado** com o schema da versão antiga e reutilizar
   a leitura/restore existente via pacote Go compartilhado para carregar
   `.sql.gz`. Isso preserva o
   escaping do `COPY`, os tipos e os relacionamentos. Criar outro banco
   temporário com o novo schema Drizzle.
3. Construir mapas por tabela `(uuid_antigo, bigint_novo)` para todas as PKs
   alteradas. Importar tabelas em ordem de dependência, traduzindo cada FK com
   JOIN no mapa correto. Transformar referências indiretas (`entidade_id`,
   JSONB, chaves de storage) segundo regras explícitas por `entidade_tipo`;
   parar se uma referência não puder ser resolvida. Preservar documentos
   fiscais, valores e histórico sem recalcular fatos fiscais.
4. Validar contagem por tabela, unicidade, todas as FKs, checks, totais
   financeiros e amostras de arquivos. Registrar versão, hashes de entrada e
   saída, contagens e checksums das tabelas/mapeamentos em um manifesto.
   Depois exportar um **novo** `.sql.gz` data-only pelo helper e ajustar as
   sequences identity para `MAX(id)+1` após o restore. O modo `-dry-run`
   descarta ambos os bancos temporários e não publica arquivo convertido.
5. Testar o conversor em backup histórico real e em um backup novo: mesma
   contagem de linhas e dados de negócio, FKs válidas, IDs novos únicos,
   restore repetível em banco vazio e falha segura para backup truncado,
   duplicado ou com referência órfã. Só disponibilizar no Backup Drive após
   homologar a CLI e os binários empacotados para as plataformas usadas.

O arquivo histórico continua restaurável pelo esquema antigo. O conversor é
a ponte para o esquema novo; não se deve modificar os backups originais nem
remover o histórico antigo de migrations do processo de recuperação.

## Critérios para iniciar a alteração de tipos

- Confirmar que o clone representa os dados que precisam ser preservados.
- Ter inventário completo de FKs e referências indiretas por ID.
- Demonstrar economia ou melhora de escrita relevante no clone, além da
  estimativa de bytes por coluna.
- Ter restore de backup histórico e rollback ensaiados antes da troca da
  baseline atual.

Referências: documentação PostgreSQL 17 sobre
[UUID](https://www.postgresql.org/docs/17/datatype-uuid.html),
[tipos numéricos](https://www.postgresql.org/docs/17/datatype-numeric.html),
[colunas identity](https://www.postgresql.org/docs/17/ddl-identity-columns.html),
[UUID v4](https://www.postgresql.org/docs/17/functions-uuid.html) e
[organização física das páginas](https://www.postgresql.org/docs/17/storage-page-layout.html).
