# Análise: itens fiscais em JSON no documento

## Decisão recomendada

Manter `documentos_fiscais_itens` como tabela relacional. A economia projetada no banco de desenvolvimento é de **21,8% no espaço conjunto dessas duas tabelas** somente para um JSONB esparso *sem índice de busca por item*. Ao adicionar um único índice GIN geral ao JSONB, a economia cai para **0,3%**, e esse índice ainda não substitui as buscas ordenadas, por intervalo e agregadas feitas hoje sobre colunas tipadas. A remoção exigiria reescrever rotas, apurações e quatro relações de chave estrangeira.

## Base da medição

Medição em 2026-11-02 no banco local `kontabb-development`. Apenas consultas agregadas de leitura e tabelas temporárias em transação revertida; nenhuma tabela persistente foi alterada.

| Relação | Linhas | Tabela principal | Índices | Total com TOAST |
| --- | ---: | ---: | ---: | ---: |
| `documentos_fiscais` | 1.910 | 3.407.872 B | 1.007.616 B | 7.585.792 B |
| `documentos_fiscais_itens` | 8.124 | 4.718.592 B | 1.810.432 B | 6.569.984 B |
| **Total atual** | | | | **14.155.776 B (13,50 MiB)** |

Há 1.874 documentos com itens e 36 sem itens. Entre os documentos com itens, a média é 4,34 itens, mediana 1, percentil 95 de 14 e máximo de 186. A tabela de itens tem 125 colunas, 13 índices físicos (PK e 12 índices declarados), duas FKs de saída e 13 restrições `CHECK`. Das 125 colunas, 59 têm pelo menos 95% de valores nulos segundo `pg_stats`; valores nulos não armazenam o valor de cada coluna na linha relacional.

### Experimento de armazenamento

Copiei os documentos para tabelas temporárias: uma cópia sem itens, outra com `jsonb_agg(to_jsonb(item) ORDER BY numero_item)`. A versão esparsa omitiu chaves nulas e os campos redundantes `documento_fiscal_id` e `cliente_id`, mas preservou `id` do item. Os 72 campos `numeric` foram serializados como strings para preservar o contrato de precisão dos valores fiscais nas APIs JavaScript. Medi `pg_table_size` da cópia e do documento embutido. Para projetar o total, somei ao tamanho atual de `documentos_fiscais` a diferença entre essas cópias e retirei o total atual de `documentos_fiscais_itens`. Portanto, os índices já existentes do documento foram mantidos na projeção, mas não foram recriados na tabela temporária.

| Cenário projetado | Total das duas relações | Economia contra o atual |
| --- | ---: | ---: |
| Atual, duas tabelas | 14.155.776 B (13,50 MiB) | — |
| JSONB completo, inclusive campos nulos e redundantes; sem índice de itens | 13.238.272 B (12,63 MiB) | 917.504 B (6,5%) |
| JSONB esparso e valores decimais como strings; sem índice de itens | 11.075.584 B (10,56 MiB) | 3.080.192 B (21,8%) |
| JSONB esparso + um GIN `jsonb_path_ops` | 14.114.816 B (13,46 MiB) | 40.960 B (0,3%) |
| JSON textual esparso, sem índice de itens | 10.534.912 B (10,05 MiB) | 3.620.864 B (25,6%) |

O GIN mediu 3.039.232 B. O JSON textual economiza mais nesse ensaio, mas obriga reinterpretação do texto nas leituras e não oferece a indexação GIN de JSONB. O índice GIN usado no ensaio auxilia buscas de contenção e JSONPath; não substitui automaticamente os índices B-tree sobre CFOP, CST, NCM, cliente e `(documento_fiscal_id, numero_item)`, nem ordenação por item e agregações fiscais. Se fossem necessários índices de expressão adicionais, a economia poderia ficar negativa.

São **projeções com a distribuição e compressão atuais**, não uma migração aplicada nem uma previsão confiável para um milhão de itens. A comparação não inclui novo código, custo de CPU, WAL, backups, índices de expressão, manutenção ou crescimento por atualizações. No conjunto de tabelas `public` do banco local (18.628.608 B), os 3.080.192 B do cenário sem índice equivaleriam a 16,5%; o cenário com GIN equivale a 0,2%. Esses percentuais mudam conforme o resto do banco cresce.

## Dependências do esquema

`documentos_fiscais_itens.id` é referenciado por:

| Tabela | Relação atual | Impacto da remoção |
| --- | --- | --- |
| `fiscal_decisoes_item` | `item_id`, decisão por item e versão de regra | Perde FK, histórico e vínculo de decisão por item |
| `classificacao_destinacao_aprendizado` | `item_id`, amostras de aprendizado | Perde FK e identidade estável do item |
| `ciap_ativo_permanente` | `documento_fiscal_item_id` | Perde vínculo verificável do ativo com o item de origem |
| `ciap_movimentos` | `documento_fiscal_item_id` | Perde vínculo verificável do movimento com o item |

Manter um `id` dentro de cada objeto JSON preservaria o valor de identificação para a API, mas não permitiria essas FKs diretamente para elementos de um array. Também seria necessário reconstruir validações hoje garantidas pelos `NOT NULL`, `CHECK`, unicidade `(documento_fiscal_id, numero_item)` e tipos `numeric`.

## Superfície da API

Rotas confirmadas pelos controllers. Os pares `/fiscal` e `/admin/fiscal` usam os mesmos serviços com escopos de acesso distintos.

| Rotas | Dependência | Mudança necessária |
| --- | --- | --- |
| `GET /{fiscal,admin/fiscal}/itens` e `GET /{fiscal,admin/fiscal}/documentos/:id/itens` | `FiscalItensService.listItens`: filtros, paginação, joins e ordenação por item | Expandir array em linhas, converter tipos, refazer filtros, contagem e paginação |
| `PATCH /admin/fiscal/itens/:itemId/cfop`; `PATCH /{fiscal,admin/fiscal}/regras/itens/:itemId/destinacao` | Busca e bloqueio de uma linha pelo ID; alteração individual | Procurar item dentro do JSON, controlar concorrência e regravar documento |
| `GET /{fiscal,admin/fiscal}/relatorios/c190`, `/produtos-0200`, `/livros-icms`, `/apuracao-icms` | `FiscalItensService`: agregação e filtros por item | Reescrever consultas analíticas e preservar precisão decimal |
| `GET /{fiscal,admin/fiscal}/relatorios/livros-iss` e `/livros-iss/pdf` | `FiscalIssLivroService`: campos de serviço do item | Reescrever leitura e ordenação dos itens de serviço |
| `GET /fiscal/apuracao/{icms,difal-entrada,pis-cofins,onboarding/matriz,rollout/inventario,rollout/metricas}` e rotas administrativas correspondentes quando existentes | Serviços de apuração, matriz e inventário consultam itens | Reescrever filtros e cálculos; validar resultados fiscais |
| `GET` preview e `POST` gerar em `/{fiscal,admin/fiscal}/sped/efd-icms-ipi/{preview,gerar}` | Builder EFD consome linhas tipadas dos itens | Adaptar leitura e confirmar registros SPED equivalentes |
| `POST /{fiscal,admin/fiscal}/documentos/importar-xml`, importação por chaves, sincronização e `POST /admin/fiscal/reprocessar-escrituracao` | Importação, reconciliação e escrituração escrevem/reavaliam itens | Reescrever upsert/reconciliação sem apagar correções manuais |
| `GET /{fiscal,admin/fiscal}/documentos` | Consulta `EXISTS` sobre itens para sinal de revisão | Reescrever filtro e resumo de revisão |
| `GET /{fiscal,admin/fiscal}/simples/apuracao` e operações administrativas de apuração/fechamento | Simples Nacional agrega itens | Reescrever apuração e conferir valores |

As rotas de CT-e (`/cte`, relatórios `d100` e `d190`) usam a tabela própria de escrituração de CT-e e **não** entram nessa dependência direta. A lista acima agrupa famílias de rotas; serviços com consultas à tabela também aparecem fora dos endpoints listados, especialmente CIAP e classificação de destinação.

## Integridade e concorrência

- `fiscal-item-reconciliation.ts` reconcilia por número/código, conserva o UUID e decisões manuais em reimportações e insere só itens novos. A versão JSON precisaria repetir essa política em toda substituição do array.
- `regras-fiscais.service.ts` bloqueia a linha do item (`FOR UPDATE OF documentos_fiscais_itens`) e altera só esse item. No JSON, uma edição regrava o valor da coluna do documento, amplia o escopo do bloqueio e aumenta a escrita de TOAST/WAL conforme o tamanho do array.
- `escrituracao-fiscal.service.ts` usa `atualizado_em` do item para concorrência otimista. Um array JSON precisaria de versão por item e compare-and-swap para não sobrescrever alterações paralelas.
- JSONB armazena números decimais no PostgreSQL, mas expô-los como números JSON à aplicação JavaScript pode perder precisão; o contrato atual de `numeric` em string deve ser mantido.

## Encaminhamento

Não fazer a migração destrutiva nem eliminar a tabela a partir do ganho observado. Para reduzir espaço com risco menor, primeiro medir consultas reais e uso dos índices da tabela de itens antes de remover índices que comprovadamente não sirvam ao tráfego; medir no ambiente de produção, porque as estatísticas locais não representam a carga real. Caso seja necessário guardar uma representação documental integral, um JSONB **adicional** ou o XML já arquivado pode servir como snapshot, mantendo as linhas normalizadas para consultas e decisões fiscais.

Referências técnicas: [tipos JSON do PostgreSQL 17](https://www.postgresql.org/docs/17/datatype-json.html) e [armazenamento TOAST](https://www.postgresql.org/docs/17/storage-toast.html).
