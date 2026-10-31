# Relatório de saneamento da API e do schema — 31/10/2026

## Escopo e limite da evidência

Implementação do `PROMPT_REFATORACAO_E_OTIMIZACAO_API_CONSOLIDADO.md` em `api/`, com inspeção dos consumidores em `web/` e `extensao/`. A raiz `kontabb/` não é repositório Git. Os ensaios usaram bancos isolados no PostgreSQL local; `kontabb-development` foi consultado apenas em transações `READ ONLY`. O usuário identificou `backup-drive/documentos/kontabb-20261031-153521.sql.gz` como backup do banco implantado, e ele foi restaurado em clone isolado. Em seguida, o banco implantado foi consultado diretamente **somente em transações `READ ONLY`**; `SHOW transaction_read_only` retornou `on`. O usuário proibiu qualquer alteração nesse banco. Não houve DDL, migration, DML ou remoção de dados no ambiente implantado.

## Baseline e contratos

Antes das mudanças deste ciclo, `tsc --noEmit` falhava em specs, ESLint tinha 60 erros e Jest falhava em 7 testes de 2 suites por três XMLs NFS-e ausentes na raiz. `build` e `db:check` passavam. Foram corrigidos os tipos e a formatação localizados; os testes agora usam três XMLs reais sanitizados em `src/fiscal/services/__fixtures__/webiss/`, mantendo os casos fiscais do parser. Dados de identificação pessoal, texto livre e assinatura foram retirados das cópias; identificadores fiscais usados nas asserções foram mantidos. Os testes não dependem mais de arquivos em Downloads.

O inventário em `docs/rotas-consumidas.md` registra 216 rotas únicas a partir dos metadados NestJS. Foram verificados `GET /api/cron/storage-cleanup`, `GET /api/cron/fiscal-sync` e `PATCH /api/guias/:id/pagar`, além das chamadas da extensão e do Vercel Cron. Verbo, path, autenticação e corpo de resposta dessas rotas foram preservados. O endpoint de reconciliação de storage continua sendo alias mutativo da limpeza, conforme a documentação existente.

## Alterações implementadas

| Área | Mudança | Evidência de equivalência/segurança |
| --- | --- | --- |
| Cadastro | `findRegisteredCnpjs` consulta raízes CNPJ em lote, com `substring(cnpj, 1, 8)` e `IN`, em vez de uma query por raiz. | Teste com raízes repetidas e contagem de uma consulta; o único chamador envia raízes de dígitos. |
| CIAP | Importação busca códigos de bens existentes em lote e usa `Set` para duplicatas no mesmo arquivo. | Teste cobre bem existente e código repetido, mantendo a ordem de importação. |
| Rate limit | Expurgo diário de até 1.000 janelas vencidas há mais de 24 h, incluindo chaves SEFAZ apenas quando realmente expiradas; `SKIP LOCKED` e rechecagem no `DELETE`. A tentativa ocorre mesmo se a limpeza de storage falhar. | Teste manual em tabela temporária isolada: linha vencida há 25 h removida, linhas de 2 h e ativa preservadas. `EXPLAIN (ANALYZE, BUFFERS)` no banco local: 68 linhas, 64 elegíveis, execução da seleção em 0,065 ms; nenhum índice novo justificável nesse volume. Testes do cron cobrem autorização, resposta e falhas de ambos os jobs. |
| Pagamento | `confirmPayment` passou de CTE para transação Drizzle: atualização condicional da guia, evento fiscal quando há vínculo ativo e valor positivo do PDF, projeção do saldo, atualização do estado fiscal quando quitado e auditoria. O usuário definiu que o evento registra o valor do PDF mesmo com parcial anterior. A confirmação sem comprovante registra declaração manual; com comprovante guarda a key R2. | Testes cobrem guia sem vínculo, retry, parcial, estorno prévio, diferença de centavos, vínculo cancelado, falha de R2 e rollback/compensação após falha de auditoria. Em PostgreSQL local isolado, dois requests concorrentes geraram exatamente uma baixa, um evento novo e uma auditoria. |

O evento fiscal usa o valor decimal persistido em `guias.valor`, extraído do PDF, e `paid_at` quando informado; sem ele, usa a data corrente de Bahia. O tipo do evento é `PAGAMENTO_PARCIAL` se ainda resta saldo, ou `PAGAMENTO` se a projeção quita a obrigação. O status da obrigação fiscal só vira `PAGO` quando `projetarSaldoObrigacao` demonstra quitação. Se o vínculo tiver valor ausente ou zero, a transação falha sem registrar baixa: não existe valor confiável para fabricar um evento. Se o vínculo estiver cancelado, a guia de upload pode ser paga, sem criar evento numa obrigação congelada. O `UPDATE guias ... WHERE status <> 'PAGO'` dentro da transação serializa confirmações concorrentes da mesma guia; upload de comprovante de tentativa perdedora é compensado no R2. Outros métodos com CTE parametrizada foram mantidos, pois a conversão não traz benefício demonstrado e ampliaria o risco.

Na revisão seguinte, a baixa passou a rejeitar com HTTP 400 específico uma guia de upload pendente cuja obrigação fiscal vinculada **já tem saldo quitado**. A transação é revertida e um comprovante enviado na tentativa é removido do R2. Isso evita duplicar um pagamento integral já registrado na trilha; eventos parciais prévios continuam permitidos e o novo evento mantém o valor integral do PDF. Há testes de serviço e controller para essa borda.

Preflight somente leitura no banco local encontrou **zero** guias de upload pagas e vinculadas sem evento de origem `guia-upload:<id>`, e **zero** guias fiscais `PAGO` sem qualquer evento. A consulta posterior ao banco implantado também retornou zero nos quatro diagnósticos de consistência de pagamentos. Eventos históricos não devem ser inventados a partir de status.

## Auditoria do schema

O schema possui 57 tabelas, e o journal contém `0000`–`0003`. No banco local de desenvolvimento, o tracker `drizzle.__drizzle_migrations` também tem quatro entradas. As quatro migrations foram aplicadas com sucesso no banco isolado. A baseline `0000` não foi editada.

| Objeto candidato | Uso encontrado no código | Linhas no banco local | FK inbound no banco local | Decisão |
| --- | --- | ---: | --- | --- |
| `sped_contabilistas` | Sem leitor/writer de produção localizado | 0 | Nenhuma | Preservar para restaurar os backups atuais. |
| `fiscal_lancamentos` | Sem leitor/writer; comentários históricos sobre migração futura | 0 | Nenhuma | Preservar pelo mesmo motivo. |
| `fiscal_perfis_vigencia` | Sem leitor/writer; comentário histórico de design | 0 | Nenhuma | Preservar pelo mesmo motivo. |
| `ciap_competencias_apropriadas` | `INSERT` em `CiapService` | 0 | Nenhuma | Preservar enquanto writer existe; investigar retenção histórica. |
| `ciap_movimentos` | Dois caminhos de `INSERT` em `CiapService` | 0 | `ciap_apropriacoes` e autorreferência | Preservar; integra a trilha patrimonial. |
| `sped_arquivos_gerados` | `INSERT` e `UPDATE` em geração de EFD | 0 | Nenhuma | Preservar como histórico de geração. |
| `classificacao_destinacao_aprendizado` | `INSERT`/`DELETE` e **leitura ativa** via alias `aprendizado` em `ClassificacaoDestinacaoService` | **48** | Nenhuma | Preservar. O relatório histórico que a chamava somente-escrita estava incorreto. |
| `fiscal_regras_versoes` | Leitura em `FiscalNormativeCatalogService`; sem writer encontrado | 0 | Nenhuma | Preservar, pois remover quebra consulta viva. |
| `fiscal_decisoes_item` | Leituras de métricas/inventário; sem writer encontrado | 0 | Nenhuma | Preservar, pois remover quebra consulta viva. |

`fiscal_fechamentos`, `fiscal_pagamentos_eventos`, `fiscal_entregas`, `clientes.cpf` e `documentos_fiscais_itens.cod_cta_sped` têm uso real e não são candidatas a retirada. Nas colunas investigadas, `folhas_pagamento.documento_id`, `documentos_fiscais_itens.cod_obs_sped`, `regras_fiscais.apropria_credito_pis_cofins` e `fiscal_catalogos_versoes.data_carga` tinham zero valores não nulos tanto no banco local quanto no implantado; isso não prova ausência de uso por integrações ou fluxo futuro. Nenhuma migration de remoção foi gerada ou aplicada.

### Continuação da fase 4: preflight e dependências

O `scripts/preflight-migrations.sql` antigo falhava na primeira consulta às guias porque usava a tabela removida `documentos`. Também classificava CNPJ alfanumérico legítimo como inválido, omitira `SUSPENSO` em `guias.email_status`, rejeitava NFS-e válida e tratava folhas de tipos diferentes na mesma competência como duplicatas. O script agora usa os nomes e checks atuais, limita a unicidade mensal a `FOLHA_MENSAL` e abre transação `READ ONLY`. Executado no PostgreSQL local com `ON_ERROR_STOP=1`: **22 consultas, nenhuma linha de violação, sem escrita**. A matriz completa por objeto, incluindo uso, SQL cru, índices, consumo externo e backup, está em `docs/schema-candidates-matrix.md`.

O novo `scripts/preflight-schema-audit.sql` reúne contagens, índices, FKs inbound, dependências de colunas, tracker de migrations e quatro diagnósticos de pagamento, com `BEGIN READ ONLY` e timeout de 15 s. Executou com sucesso no banco local. Seus quatro hashes do tracker coincidiram com SHA-256 dos arquivos `drizzle/0000`–`0003` locais. O script é um preflight para clone/ambiente alvo, não uma autorização para DROP.

| Coluna candidata | Total de linhas no banco local | Valores não nulos | Dependência de catálogo |
| --- | ---: | ---: | --- |
| `folhas_pagamento.documento_id` | 39 | 0 | FK para `guias` |
| `documentos_fiscais_itens.cod_obs_sped` | 8.124 | 0 | Nenhuma dependência inbound localizada no catálogo |
| `regras_fiscais.apropria_credito_pis_cofins` | 0 | 0 | Default |
| `fiscal_catalogos_versoes.data_carga` | 0 | 0 | Default |

As nove tabelas candidatas estão presentes no banco local e têm 26 índices ao todo. `ciap_movimentos` recebe duas FKs inbound (de `ciap_apropriacoes` e dela própria). Nenhuma referência direta aos nove nomes de tabela foi localizada em `web/`, `extensao/` ou `backup-restore/`; este último descobre tabelas dinamicamente, permite exclusões por flag e faz `TRUNCATE` antes do restore. O backup identificado pelo usuário foi posteriormente localizado em `backup-drive/documentos/` e ensaiado como descrito abaixo. O usuário informou que não conhece consumidores externos das três tabelas sem uso encontrado; integrações fora do workspace não foram inspecionadas.

Os diagnósticos locais de pagamentos retornaram zero para guia de upload paga sem evento de origem, guia fiscal `PAGO` com saldo aberto, guia de upload pendente com obrigação fiscal já quitada e origem de upload duplicada. A verificação posterior no banco implantado também retornou zero nos quatro casos. `docs/database-rebuild.md` e `README.md` foram alinhados ao journal atual e o runbook passou a usar uma variável dedicada para o banco novo, preservando o `.env` da API em operação.

### Ensaio local de migration, com autorização para descartar o banco de testes

O usuário autorizou apagar `kontabb-development`. Para manter uma referência intacta, foi criado `kontabb_schema_trial_20261031` por `pg_dump`/`pg_restore` do banco local (28 MB; 57 tabelas; 48 linhas de aprendizado). Ambos os preflights passaram no clone. O ensaio em `scripts/dry-run-unused-tables.sql` verificou que `sped_contabilistas`, `fiscal_lancamentos` e `fiscal_perfis_vigencia` estavam vazias, executou `DROP TABLE ... RESTRICT` dentro de uma transação e confirmou o retorno das três tabelas após `ROLLBACK`.

Uma linha sintética foi então inserida em `sped_contabilistas` **somente no clone**. O mesmo ensaio abortou com erro antes de qualquer `DROP`, como exigido pela guarda de dados. A linha de teste foi removida do clone, e clone e dump temporário foram descartados. O `kontabb-development` original segue com 57 tabelas e 48 linhas de aprendizado. O arquivo de ensaio não faz parte do journal Drizzle e **não é migration de deploy**. Naquele momento ainda não havia inventário do backup informado como implantado nem preflight do schema/tracker do alvo. Por isso não foi versionado um `0004` destrutivo.

O utilitário `backup-restore` também foi ensaiado com dados locais: backup de **57 tabelas e 13.390 registros**; `dry-run` de restore em banco vazio recém-migrado validou **104 FKs** e reverteu sem persistir linhas; restore real no banco isolado trouxe as 57 tabelas/13.390 registros; os dois preflights passaram (22 consultas de integridade sem violações), o ensaio `DROP ... RESTRICT` voltou a passar com `ROLLBACK` e o `AppModule` iniciou e fechou usando o banco restaurado. O banco de restore e o backup temporário foram descartados. Isso comprova o fluxo com dados **locais**, não a cobertura de um backup do ambiente implantado.

### Ensaio do backup identificado como implantado

O usuário apontou `backup-drive/documentos/kontabb-20261031-153521.sql.gz` e confirmou que foi gerado a partir do banco implantado. O arquivo passou por `gzip -t` (SHA-256 `f6af225420db1d6eb2f09e7a2d873e1721a0bcad601c90053ee2ba5274c79035`); seu manifesto declara **57 tabelas e 13.389 registros**. A origem foi informada pelo usuário, pois o cabeçalho do arquivo não registra o host nem o banco fonte. O diretório `backup-drive/documentos/` está ignorado pelo Git.

Em `kontabb_backup_trial_20261031`, banco isolado criado vazio, foram aplicadas as migrations locais `0000`–`0003`. O restore `--dry-run` do arquivo validou **104 FKs** e reverteu; o restore transacional real importou as 57 tabelas/13.389 registros. `scripts/preflight-migrations.sql` executou **22 consultas sem linhas de violação**. `scripts/preflight-schema-audit.sql` confirmou nove tabelas candidatas presentes, três tabelas sem uso encontrado com **zero linhas e nenhuma FK inbound**, `classificacao_destinacao_aprendizado` com **48 linhas**, quatro colunas candidatas sem valores não nulos e os quatro diagnósticos de pagamento com **zero ocorrências**. O ensaio `DROP TABLE ... RESTRICT` com `ROLLBACK` passou, restaurando as três tabelas. O `AppModule` iniciou e encerrou com esse clone. Nenhuma alteração foi aplicada ao banco implantado.

As contagens do backup coincidiram com as do banco local de testes em 56 das 57 tabelas; apenas `session` tinha 42 no arquivo e 43 no teste. Isso não permite comprovar a origem do arquivo. Como o backup contém **somente dados**, o tracker de quatro migrations observado no clone foi criado neste ensaio; a consulta direta posterior ao banco implantado é a evidência do tracker original. O clone do backup foi descartado ao encerrar a auditoria; `kontabb-development` permaneceu intacto.

### Preflight direto no banco implantado, sem alterações

Após o usuário fornecer a conexão e proibir alterações, as consultas foram executadas no Neon PostgreSQL 18.6 em transações `BEGIN READ ONLY`, com `SHOW transaction_read_only = on` e `statement_timeout` local de 15 s. A conexão foi encerrada ao fim. A primeira tentativa, com timeout nos parâmetros de inicialização, foi recusada pelo pooler **antes de qualquer consulta**; a conexão bem-sucedida definiu o timeout dentro da transação.

O catálogo do alvo contém **57 tabelas** em `public` e o tracker `drizzle.__drizzle_migrations` tem quatro entradas, `0000`–`0003`, com hashes e timestamps iguais aos observados no clone/local. `scripts/preflight-schema-audit.sql` passou: as nove candidatas existem, as três sem uso encontrado (`sped_contabilistas`, `fiscal_lancamentos`, `fiscal_perfis_vigencia`) têm **zero linhas** e nenhuma FK inbound, `classificacao_destinacao_aprendizado` tem **48 linhas**, e as quatro colunas candidatas têm **zero valores não nulos**. Consultas extras ao catálogo não localizaram views que mencionem essas três tabelas nem triggers não internos nelas. O servidor PostgreSQL 18 registrou as restrições `NOT NULL` das colunas candidatas como dependências de catálogo adicionais às vistas no clone PostgreSQL 17; elas permanecem preservadas.

Os quatro diagnósticos de pagamentos históricos retornaram **zero**: guia de upload paga sem evento de origem, obrigação fiscal `PAGO` com saldo aberto, upload pendente com obrigação já quitada e origem de upload duplicada. `scripts/preflight-migrations.sql` produziu **22 conjuntos de zero linhas de violação**. Seus resultados foram redirecionados temporariamente para evitar expor linhas de clientes caso houvesse anomalia; o arquivo temporário foi eliminado. Nenhum `DROP`, migration, backfill, `UPDATE`, `INSERT` ou `DELETE` foi executado no alvo. A ausência de referências no catálogo e no workspace não comprova que não exista SQL externo; o usuário informou que não conhece consumidores externos.

### Continuação da fase 4: decisão de preservação e segurança do ensaio

O usuário confirmou que não há uso planejado nem exigência de retenção para `sped_contabilistas`, `fiscal_lancamentos` e `fiscal_perfis_vigencia`. Os comentários antigos em `schema.ts`/`FiscalItensService` descrevem intenção futura, mas não há writer/leitor ativo dessas tabelas. Ainda assim, a retirada agora prejudicaria a recuperação: o backup informado como implantado contém comandos `COPY` para todas as 57 tabelas, inclusive as três vazias.

Em banco isolado recém-migrado, foram removidas as três tabelas, restando 54. O `backup-restore --dry-run` com o arquivo de 57 tabelas falhou no primeiro `COPY` ausente (`fiscal_perfis_vigencia`, SQLSTATE `42P01`) e reverteu a transação. Depois do rollback, `clientes` continuou com zero linhas. Esse clone foi descartado. Para manter restauráveis os backups existentes, **não foi gerada a migration `0004`** nem removidas as declarações de `schema.ts`. Se uma retirada futura justificar o custo, primeiro será necessário adaptar e distribuir o utilitário de restore, ensaiar backups antigos no schema novo e revisar consumidores externos.

O script reversível `scripts/dry-run-unused-tables.sql` foi corrigido para obter `ACCESS EXCLUSIVE` nas três tabelas antes de verificar se estão vazias. Isso fecha a janela em que uma escrita concorrente poderia ocorrer entre a guarda e o `DROP`. No clone do backup de 13.389 registros, o ensaio passou e o `ROLLBACK` restaurou as três tabelas; com uma linha sintética em `sped_contabilistas`, abortou antes do `DROP` e preservou as três. O clone também foi descartado. Nenhum desses ensaios tocou o banco implantado.

### Continuação: helper de restore compatível, sem migration de produção

O utilitário `backup-restore` ganhou a opção explícita `-skip-missing-empty-tables` na versão v1.2. O restore verifica o **conteúdo real** do bloco `COPY`, sem confiar na contagem do cabeçalho: apenas tabelas ausentes nomeadas na opção e com bloco vazio são ignoradas. Uma linha, bloco incompleto ou outra tabela ausente continua causando erro e rollback. O comportamento padrão sem a opção permanece igual. `backup-drive` ganhou um campo opcional para enviar essa lista ao helper; os nomes são validados e o campo começa vazio. Binários locais macOS e Windows foram recompilados, mas ainda não houve distribuição de uma nova versão do aplicativo.

Em clone com schema de 54 tabelas, criado somente para esse ensaio, o backup de 57 tabelas passou no `--dry-run` e no restore real com a opção: **54 tabelas e 13.389 registros** importados, **3 blocos vazios** ignorados e **98 FKs** validadas. O clone manteve 19 clientes, 8.124 itens fiscais, 48 linhas de aprendizado e as quatro migrations; o `AppModule` iniciou e encerrou. Um backup sintético com linha em tabela ausente foi recusado e fez rollback, preservando essas contagens. Sem a opção, o mesmo backup antigo continuou falhando em `fiscal_perfis_vigencia` e revertendo. Nenhum dos ensaios usou o banco implantado. O clone e o backup sintético temporário foram descartados.

Essa mudança remove o bloqueio técnico no **código-fonte** do restore. A migration de retirada ainda não foi gerada: é preciso distribuir o helper atualizado aos operadores do Backup Drive, homologar a recuperação com essa versão e revisar consumidores externos antes de versionar DDL destrutivo. A restrição do usuário de não alterar o banco em produção continua vigente.

Os binários locais macOS e Windows do helper v1.2 foram recompilados. `flutter build macos` encontrou primeiro um banco de build do Xcode bloqueado por outra compilação; outra tentativa falhou no CodeSign devido ao atributo `com.apple.provenance` nos artefatos locais. Depois de remover esse atributo **somente** do helper local e do bundle gerado, o build passou. `codesign --verify --deep` validou o app, e o helper embarcado mostrou v1.2 e a nova flag. O bundle foi compactado localmente em `backup-drive/build/release/backup-drive-macos-20261031-helper-v1.2.zip` (25 MB, SHA-256 `2d985f0d087e666d8540278d39690a983fdb0f7c6b2c86cca07add2e14ae55ab`); `unzip -tq` passou. A assinatura é **ad hoc**, sem TeamIdentifier; não há notarização, publicação ou instalação do aplicativo. A distribuição continua pendente.

### Continuação: preparo de entrega para macOS Intel/Apple Silicon e Windows

O usuário confirmou que outros Macs e Windows também usam a restauração. O primeiro pacote macOS acima tinha aplicativo universal, mas helper somente arm64. `backup-drive/scripts/build-macos-release.sh` agora compila o helper para arm64 e x86_64, une os binários, assina o helper localmente, compila o app e verifica as duas arquiteturas, a versão v1.2, a nova opção, a assinatura do bundle e o ZIP. A fase de cópia do Xcode passou a executar em cada build; antes ela reutilizava o helper antigo apesar da recompilação. O novo ZIP local é `backup-drive/build/release/backup-drive-macos-helper-v1.2.zip`, SHA-256 `235b41db1c9a56d7f749029f491dcf1956b951b75d18ebefb93fe5114a6bba5b`. A extração em diretório temporário confirmou as duas arquiteturas do helper e `codesign --verify --deep --strict` do app extraído. A execução x86_64 não pôde ser testada neste Mac porque Rosetta não está instalado; as duas slices foram verificadas com `lipo`.

`backup-drive/scripts/build-windows-release.ps1` compila o helper x64 em Windows, compila o app Flutter, exige que o helper embarcado tenha exatamente o mesmo SHA-256 do recém-compilado e verifica versão/opção antes de compactar. O helper PE x64 foi compilado localmente; o script e o aplicativo Windows ainda precisam ser executados/testados em host Windows. Neste Mac há apenas identidade **Apple Development**, sem `Developer ID Application`; o pacote macOS permanece com assinatura ad hoc, sem notarização, instalação ou distribuição. Não foi feita homologação em máquinas dos operadores. Esses gates e a revisão de SQL externo continuam antes de uma eventual migration `0004`. Nenhum banco de produção foi modificado.

### Fase 5: organização

Foram revisados os módulos `cliente`, `clientes`, `upload`, `guias`, `health`, `cadastros/contadores` e `rh` contra o inventário de 216 rotas. Os controllers já delimitam escopos de acesso distintos, e seus módulos declaram imports/exports explícitos; há dezenas de referências cruzadas que uma movimentação de arquivos exigiria atualizar. Não foi encontrada falha de DI, rota ou Swagger que um move corrigisse. A fase 5 foi encerrada **sem mover arquivos**, conforme o caráter condicional do prompt. Nenhum cálculo ou artefato fiscal foi alterado nesta continuação.

### Continuação independente da fase 2 após pular o rollout

O usuário pediu para pular a entrega/homologação do Backup Drive em outros Macs e Windows e avançar nas demais implementações. A retirada das três tabelas permanece suspensa: sem o helper v1.2 distribuído, o restore de backups antigos falha no schema de 54 tabelas. Nenhuma migration `0004` foi gerada e nenhum banco de produção foi alterado.

Em `EscrituracaoFiscalService.reprocessar`, a leitura e o parse dos XMLs do R2 agora são feitos em lotes de até quatro. Cada lote usa `Promise.all`, que devolve resultados na ordem de entrada; a resolução de CFOP, a preparação de CT-e, os contadores e a transação de escrita continuam sequenciais na ordem anterior. O tratamento de XML ausente/inválido continua retornando `null`. Um teste com cinco documentos mantém o primeiro download pendente e confirma que só os quatro primeiros são iniciados, nenhum update ocorre antes da leitura e a ordem de processamento e os contadores permanecem corretos. Não houve alteração de schema ou contrato HTTP. O limite reduz a pressão simultânea no R2; ganho de latência real ainda não foi medido.

### Continuação da fase 2: CNPJ alfanumérico em login e upload manual

O cadastro já aceita CNPJ alfanumérico, mas `ColaboradorController.login` removia as letras antes da consulta, e a página web repetia o mesmo erro na máscara e no payload. O controller agora normaliza para maiúsculas, preserva `[0-9A-Z]` nas primeiras 12 posições e exige dois dígitos finais, sem passar a validar dígitos verificadores de contas já cadastradas. Mantém CNPJ numérico e o rate limit com chave normalizada. A página reutiliza `formatCnpjInput`/`normalizeCnpjIdentifier` existentes, permite teclado textual e envia o identificador inteiro. Testes de controller cobrem os dois formatos e a rejeição de letras nas posições verificadoras; Playwright confirmou o payload alfanumérico em desktop e mobile.

O upload manual de guias também descartava letras na máscara, no `FormData` e no controller. Essas etapas agora preservam CNPJ alfanumérico; o CPF segue com normalização numérica. Teste de controller com PDF de assinatura válida e conteúdo ilegível confirmou que o identificador manual numérico ou alfanumérico chega intacto à busca do cliente, mesmo quando a extração do PDF falha. O HTML do recibo de salário no web passou a preservar letras do CNPJ sem mudar a representação numérica anterior. A extração **automática** de CNPJ em PDFs fiscais e de RH ainda usa padrões numéricos; ela não foi ampliada sem um PDF alfanumérico representativo para verificar falsas capturas e os resultados de processamento. Senhas iniciais fixas também permanecem sem mudança, pois exigem fluxo de provisionamento e compatibilidade próprios.

### Continuação da fase 2: buscas administrativas e encaminhamento de RH

As listas administrativas de guias e folhas ainda removiam letras ao construir o filtro por CNPJ. Ambas agora usam `normalizeCnpjIdentifier`, helper que só remove a máscara e não valida dígitos. Nas guias, a busca numérica ainda consulta CPF; um CNPJ alfanumérico completo não gera um filtro parcial de CPF que poderia trazer outro cliente. Buscas apenas por nome, sem dígitos, não acrescentam filtro de CNPJ. Testes inspecionam os parâmetros SQL de CNPJ numérico/alfanumérico, CPF e busca textual. Após os parsers de folha, adiantamento de 13º e férias, o controller de RH também passa o CNPJ normalizado à busca do cliente e à chave R2; para os PDFs numéricos atuais, as chaves permanecem iguais. Os parsers em si continuam numéricos e precisam de arquivo alfanumérico representativo antes de qualquer ampliação. Nenhum arquivo existente foi renomeado e não houve alteração de schema ou dados.

## Decisões preservadas por risco

- A escrituração fiscal continua baixando e interpretando XML, pois `EscrituracaoFiscalService.reprocessar` usa campos que não têm equivalência demonstrada com os itens persistidos. Sem comparação de EFD por bytes e de contadores de erro em amostra real, reduzir downloads poderia alterar resultado fiscal.
- Pool de conexões, cache e índices não foram modificados sem medição de carga e plano de invalidação. O `EXPLAIN` local de rate limit não justifica índice adicional neste volume.
- Não houve divisão de `schema.ts`, move de módulos nem mudança da senha inicial fixa. Essas alterações exigem migração de comportamento e testes de provisionamento/compatibilidade próprios.
- Antes de qualquer DDL futuro: usar os preflights somente leitura já executados como referência, verificar integrações e consumidores SQL externos e distribuir/homologar o helper v1.2 do Backup Drive. Só então preparar migration incremental com guarda de dados e ensaiá-la em clone. O usuário proibiu alterações no banco implantado nesta etapa.

## Validação final

| Gate | Resultado |
| --- | --- |
| `pnpm exec tsc --noEmit` | Passou. |
| `pnpm exec eslint "{src,apps,libs,test}/**/*.ts"` | Passou, sem `--fix`. |
| `pnpm exec jest --runInBand --silent` | 132 suites, 2.147 testes passaram. |
| `web`: Vitest, Playwright login desktop/mobile, lint, tipos e build | 32 arquivos/230 testes unitários e 4 testes Playwright passaram; lint sem erros, com 16 avisos preexistentes; tipos e build passaram. |
| `pnpm build` | Passou. |
| `pnpm db:check` | Passou. |
| Ensaio de `dry-run-unused-tables.sql` em clone do backup | Passou com `ROLLBACK`; abortou antes do `DROP` com linha sintética. |
| Restore de backup antigo em clone com 54 tabelas | Falhou como esperado em `COPY fiscal_perfis_vigencia` (`42P01`) e reverteu; comprova incompatibilidade. |
| Helper v1.2 em clone com 54 tabelas | `dry-run` e restore real passaram: 13.389 registros, 3 tabelas vazias ignoradas, 98 FKs e boot do `AppModule`. Linha sintética em tabela ausente abortou com rollback. |
| `go test ./...`; `flutter analyze` e `flutter test test/database_backup_service_test.dart` | Passaram nos projetos `backup-restore` e `backup-drive`. |
| Script macOS de release, `lipo`, `codesign --verify --deep --strict`, extração do ZIP | Passaram; app/helper universais arm64+x86_64, helper v1.2 embarcado e ZIP local gerado. Execução Intel pendente sem Rosetta. |
| Build Go Windows x64 | Passou; PE gerado. Build/teste do app Windows dependem de host Windows. |
| `git diff --check` | Passou. |

Nenhuma migration nova foi criada ou aplicada fora dos bancos isolados de ensaio. O preflight read-only do schema/tracker implantado e a restauração do backup no schema atual passaram. O novo helper v1.2 também restaurou o backup em clone sem as três tabelas vazias; elas permanecem no schema até a distribuição e homologação do helper e a revisão de consumidores externos. Nenhuma alteração foi feita no banco em produção.
