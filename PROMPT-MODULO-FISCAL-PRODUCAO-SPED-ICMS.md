# Prompt de Implementação — Preparação do Módulo Fiscal para Produção e Geração do SPED Fiscal (EFD ICMS/IPI)

> **Objetivo deste documento:** servir como especificação executável para uma IA de codificação (ou pessoa desenvolvedora) elevar o módulo fiscal deste projeto (`api/`, NestJS + Drizzle + PostgreSQL) ao nível de **produção**, garantindo que:
>
> 1. os **impostos sejam apurados corretamente** (ICMS próprio, ICMS-ST, DIFAL/FCP, IPI, PIS e COFINS), respeitando o **regime de tributação da empresa** (Simples Nacional, Lucro Presumido, Lucro Real);
> 2. **cada documento seja escriturado conforme o regime** e a natureza da operação (mercadoria = Bloco C; transporte = Bloco D; apuração = Bloco E);
> 3. o sistema **gere o arquivo texto oficial da EFD ICMS/IPI (SPED Fiscal)** validável no PVA da Receita Federal.
>
> Este prompt foi escrito a partir de uma **revisão do código atual**. Leia integralmente antes de codificar. Não quebre o comportamento existente de NF-e/NFC-e e CT-e além do necessário. Complementa — e não substitui — o `PROMPT-ESCRITURACAO-CTE.md`, cujas regras de CT-e (Bloco D) já foram implementadas.

---

## 1. Estado atual revisado (o que já existe)

O módulo vive em `api/src/fiscal`. Bibliotecas fiscais em uso: `nfewizard-io`, `@nfewizard/cte`, `@nfewizard/danfe`, `fast-xml-parser`, `node-forge`.

### 1.1. Ingestão e parsing de XML (sólido)

- **Sincronização SEFAZ** — `services/distribuicao-dfe.service.ts` + `services/nfewizard.service.ts`: distribuição por NSU com lock atômico por `(cliente_id, tipo_documento)` na tabela `controle_nsu`.
- **Importação manual** — `services/importacao-xml-fiscal.service.ts`: lotes de até 20 arquivos (10 MB cada); `persistirDocumento(...)` é o núcleo da persistência; idempotência por `(cliente_id, chave_acesso)` com `onConflictDoNothing`; substituição de RESUMO por XML completo; tudo em `db.transaction`.
- **Parser** — `services/dfe-document.parser.ts`: aceita apenas `nfeProc` (mod 55/65) e `cteProc` (mod 57); rejeita DTD/ENTITY; valida chave de 44 dígitos com dígito verificador; exige protocolo com `cStat ∈ {100,110,150,301,302}` (110/301/302 ⇒ DENEGADA). Itens de NF-e vêm de `services/nfe-item.parser.ts`; CT-e usa `services/dacte.parser.ts` e preenche `cteEscrituracao`.
- **Extração de tributos NF-e** — `services/nfe-item.parser.ts`: cobre **todos** os grupos ICMS (`ICMS00…ICMS90`, `ICMSPart`, `ICMSST`, `ICMSSN101…900`), `ICMSUFDest` (DIFAL), `IPI` (`IPITrib`/`IPINT`), `PIS`, `PISST`, `COFINS`, `COFINSST`, `II` e `vTotTrib`. Decimais são preservados como **string** (nunca `number`), descartando valores fora de escala.

### 1.2. Schema (praticamente completo no nível de item)

Em `src/database/schema.ts`:

- `documentosFiscais` (cabeçalho): **sem campos de tributo** (só `valorTotal`, `tipoOperacaoEscriturada`, `tpNfXml`, `situacao`, `escriturado`, `escrituracaoStatus`, `manifestacaoStatus`).
- `documentosFiscaisItens`: cobertura ampla de ICMS/ICMS-ST/FCP/desoneração/diferimento/crédito-SN/DIFAL/IPI/PIS/COFINS/II.
- `documentosFiscaisCteEscrituracao`: uma linha por CT-e escriturável (Bloco D), com `escrituravel`, `motivoNaoEscrituravel`, tomador, `tpCte`/`tpServ`/`modal`, CFOP, CST/CSOSN, `valorBcIcms`/`aliquotaIcms`/`valorIcms`/`valorIcmsCreditavel`, municípios etc.
- `clientes`: `regimeTributario` (`SIMPLES_NACIONAL`/`LUCRO_PRESUMIDO`/`LUCRO_REAL`), `apuraIcms`, `inscricaoEstadual`, `tipoContribuinteIcms`, `uf`, `municipio`.

### 1.3. Apuração e "relatórios SPED" (parcial — só JSON)

- `services/fiscal-itens.service.ts`: `getC190` (análogo ao C190), `getResumoLivros`, `getApuracaoIcms`, `getProdutos0200` — **apenas ICMS** e **em JSON**. Respeita Simples Nacional via `simplesNacionalSemApuracaoIcms` (em `src/clientes/clientes.types.ts`), zerando débito/crédito.
- `services/fiscal-cte.service.ts`: `getD100`, `getD190`, `getResumoLivros`, `getApuracaoFrete` — Bloco D em JSON; declara `leiaute_efd_icms_ipi: '020'`, `guia_pratico: '3.2.2'`.
- Endpoints em `controllers/cliente-fiscal.controller.ts` e `controllers/admin-fiscal.controller.ts`: `relatorios/c190`, `relatorios/d100`, `relatorios/d190`, `relatorios/produtos-0200`, `relatorios/livros-icms`, `relatorios/apuracao-icms`, `relatorios/cte/apuracao-icms`.

---

## 2. Diagnóstico: lacunas que impedem a produção

Ordenadas por criticidade para a geração do SPED e correção da apuração.

### 2.1. CRÍTICO — Não existe geração do arquivo EFD ICMS/IPI

Não há **nenhum** montador de blocos nem escritor do arquivo texto pipe-delimitado (`|`). Só há endpoints JSON que **emulam** C190/D100/D190/0200. Faltam integralmente:

- **Bloco 0** (abertura/cadastros): `0000`, `0001`, `0005`, `0100`, `0150` (participantes), `0190` (unidades), `0200` (itens/produtos), `0990`.
- **Bloco C** (mercadorias, mod 55/65): `C001`, `C100` (cabeçalho por documento), `C101` (DIFAL), `C110`, `C170` (itens por documento), `C190` (analítico), `C990`.
- **Bloco D** (transporte, mod 57): `D001`, `D100`, `D190`, `D990`.
- **Bloco E** (apuração): `E001`, `E100`, `E110`/`E111`/`E116` (apuração ICMS próprio), `E200`/`E210` (ICMS-ST), `E500`/`E510`/`E520`/`E530` (apuração IPI), `E990`.
- **Bloco H** (inventário) — quando aplicável.
- **Bloco 1** (obrigatório com `1001`/`1010`/`1990`) e **Bloco 9** (`9001`, `9900`, `9990`, `9999`) — totalizadores.

> Sem o Bloco 9 (contadores por registro) e sem os `xxx990`/`xxx001` de abertura/fechamento por bloco, o arquivo **não passa no PVA**.

### 2.2. CRÍTICO — Cadastros do Bloco 0 não são persistidos

`0150` (participantes/transportadoras), `0190` (unidades de medida), `0200` (itens/produtos) e `0100` (contabilista) hoje só existem como agregação em memória (`getProdutos0200`). Para `C100`/`C170`/`D100` o arquivo exige `COD_PART` e `COD_ITEM` **referenciando registros 0150/0200 declarados no próprio arquivo**. É preciso persistir esses cadastros (ou derivá-los deterministicamente no momento da geração) com códigos estáveis por empresa/período.

### 2.3. ALTO — Apuração cobre só ICMS

- **IPI não é apurado** (Bloco E500+). Relevante para indústria/equiparado em Lucro Real/Presumido.
- **PIS/COFINS não são apurados por regime.** O EFD ICMS/IPI **não** contempla PIS/COFINS (isso é EFD-Contribuições), então o correto aqui é **não** gerar débito/crédito de PIS/COFINS no SPED Fiscal — mas os valores por item já existem e podem alimentar uma futura EFD-Contribuições. Deixar isso explícito para não induzir erro.
- **ICMS-ST** (E200/E210) e **DIFAL/partilha** (E300 e ajustes) não têm apuração dedicada, apesar de os valores por item existirem.

### 2.4. ALTO — Regime tributário influencia pouco a escrituração

`regimeTributario`/`apuraIcms` só **liga/desliga** o ICMS via `simplesNacionalSemApuracaoIcms`. Falta:

- Definir **quais empresas são obrigadas ao SPED Fiscal** (regra geral: Lucro Real/Presumido contribuintes de ICMS/IPI; Simples Nacional em regra **não** entrega EFD ICMS/IPI, salvo obrigação estadual específica). O sistema deve **bloquear/avisar** a geração para perfis não obrigados.
- Definir o **perfil de apuração** e os **indicadores** do `0000`/`0100` (perfil A/B/C, `IND_ATIV`, `COD_FIN` etc.).

### 2.5. MÉDIO — Conferência de integridade ausente

Os totais do documento (`<total><ICMSTot>`) do XML **não são lidos**; a apuração recalcula por soma dos itens. Falta o batimento "soma dos itens × total do XML" para detectar XML corrompido/parcial antes de escriturar. Também não há coluna `COD_SIT` (situação SPED) nem `COD_OBS`/`COD_CTA` no item NF-e.

### 2.6. MÉDIO — Versão de leiaute a confirmar

Os docs citam Guia Prático **3.2.2 / leiaute 020**, mas as referências oficiais atuais indicam Guia Prático **v3.2.0 (vigência jan/2026)** e **PVA 6.1.0** (CNPJ alfanumérico). A versão do leiaute é **função do período de apuração** e precisa ser confirmada no ATO COTEPE vigente antes de emitir arquivo definitivo (ver §8).

---

## 3. Embasamento legal e normativo

A escrituração e a apuração devem observar, no mínimo. Os normativos abaixo estão consolidados na página oficial da EFD ICMS/IPI da Receita Federal ([gov.br/sped → EFD ICMS IPI](https://www.gov.br/sped/pt-br/assuntos/escrituracoes-digitais/efd-icms-ipi)). *Conteúdo reescrito para conformidade com restrições de licenciamento.*

**Normativos que instituem e regem a EFD (fonte oficial):**

- **Convênio ICMS nº 143, de 15/12/2006** — instituiu a EFD ICMS/IPI.
- **Protocolo ICMS nº 77, de 18/09/2008** — dispõe sobre a obrigatoriedade da EFD.
- **Ajuste SINIEF nº 02, de 03/04/2009** — disciplina a EFD (SPED Fiscal).
- **Protocolo ICMS nº 3, de 01/04/2011** — fixa prazo para a obrigatoriedade da EFD.
- **Ato COTEPE/ICMS nº 44, de 07/08/2018** (e alterações) — **especificações técnicas do leiaute** do arquivo digital da EFD ICMS/IPI (blocos, registros, campos, validações). É a fonte normativa dos layouts do §5, junto ao **Guia Prático da EFD ICMS/IPI** vigente.
- **Decreto nº 7.212, de 15/06/2010 (RIPI)** — regulamenta o **IPI** (contribuintes, base de cálculo, créditos, período de apuração — Bloco E500+).
- **Instruções Normativas RFB** para o Livro de Registro de Controle da Produção e do Estoque (Bloco K) e casos específicos: **IN RFB nº 1.371/2013** (contribuintes do IPI em PE), **IN RFB nº 1.652/2016** e **IN RFB nº 1.672/2016** (Bloco K para fabricantes de bebidas e de produtos do fumo), **IN RFB nº 1.685/2017** (contribuintes do IPI no DF).

**Fundamentos materiais dos tributos:**

- **Lei Complementar nº 87/1996 (Lei Kandir)** — regra-matriz do ICMS, não-cumulatividade (arts. 19 e 20: direito a crédito nas entradas tributadas, inclusive **crédito de ICMS sobre frete/CT-e** quando vinculado a operação tributada), vedações e estornos (arts. 20–21).
- **Constituição Federal, art. 155, §2º** — não-cumulatividade do ICMS e partilha do **DIFAL** nas operações interestaduais a consumidor final (EC 87/2015 e LC 190/2022).
- **Convênio ICMS nº 142/2018** — regras gerais da **substituição tributária (ICMS-ST)**.
- **Lei Complementar nº 123/2006 (Simples Nacional)** — o optante recolhe ICMS no DAS e, em regra, **não se credita nem escritura ICMS/IPI na EFD ICMS/IPI**; o CT-e/NF-e é mantido para conferência, sem débito/crédito.
- **Tabela oficial de CFOP** (Convênio S/Nº de 1970 e atualizações) e **tabelas de CST/CSOSN** (ICMS, IPI, PIS, COFINS).

> **Regra de ouro:** onde houver dúvida entre creditar automaticamente ou não (frete, subcontratação, benefícios, vedações estaduais), **não creditar** e marcar `revisaoNecessaria = true` — o software não deve assumir posições fiscais controversas sem validação humana.

---

## 4. Correção e complemento da apuração

### 4.1. ICMS próprio (Bloco C/D → E110)

Reaproveitar a lógica de `fiscal-itens.service.ts::getApuracaoIcms`, mas consolidar em uma **apuração de período** que gere os campos do `E110`:

- `VL_TOT_DEBITOS` = Σ ICMS de **saídas** tributadas (CFOP de saída, CST 00/10/20/70 e equivalentes).
- `VL_TOT_CREDITOS` = Σ ICMS de **entradas** creditáveis (CST 00/10/20/70; CSOSN 101/201 quando o fornecedor é do Simples) **+ crédito de frete do CT-e** (`documentosFiscaisCteEscrituracao.valorIcmsCreditavel`, já implementado).
- `VL_SLD_APURADO` = débitos − créditos − outros créditos ± ajustes (E111).
- Ajustes (`E111`) e informações adicionais (`E115`) por código da tabela do ATO COTEPE — inicialmente vazios, com estrutura pronta.
- **Simples Nacional sem apuração:** manter o padrão atual (débitos/créditos zerados; documento apenas para conferência). Não gerar Bloco E de ICMS para essas empresas.

### 4.2. ICMS-ST (E200/E210) e DIFAL/FCP (E300)

- Agregar `valorIcmsSt`/`valorBcIcmsSt`/`valorFcpSt` por UF para compor **E200/E210** (apuração de ICMS-ST por UF, quando o cliente for substituto/responsável).
- Agregar DIFAL (`valorIcmsUfDest`, `valorIcmsUfRemetente`) e FCP (`valorFcp`, `valorFcpUfDest`) para os registros aplicáveis.
- **Na dúvida sobre condição de substituto/responsável, marcar para revisão** e não gerar débito automático.

### 4.3. IPI (E500/E510/E520)

- Apurar por período a partir de `documentosFiscaisItens` (`valorIpi`, `cstIpi`, `valorBcIpi`, `aliquotaIpi`):
  - `E510` — analítico por CFOP/CST IPI.
  - `E520` — saldo (débitos por saídas tributadas − créditos por entradas + saldo credor anterior).
- Aplicável a **industriais e equiparados**; para os demais, **não** gerar Bloco E de IPI.

### 4.4. PIS/COFINS

- **Não** apurar PIS/COFINS no arquivo EFD ICMS/IPI (fora do escopo do SPED Fiscal). Manter os valores por item apenas para futura **EFD-Contribuições** e deixar comentário/documentação explícita evitando escrituração indevida.

### 4.5. Conferência de integridade (novo)

- Ler `<total><ICMSTot>` do XML de NF-e no parser e persistir (ou comparar em tempo de geração) o **total declarado**.
- Antes de escriturar/gerar, validar: `abs(Σ itens − total_XML) ≤ tolerância (ex.: R$ 0,02)`. Divergência ⇒ marcar documento como `PENDENTE_REVISAO` e **não** incluir na geração até revisão.

---

## 5. Geração do arquivo EFD ICMS/IPI (núcleo do trabalho)

### 5.1. Arquitetura sugerida

Criar um subdomínio dedicado, por exemplo `src/fiscal/sped/`:

```
src/fiscal/sped/
  sped-efd.types.ts          # tipos de registros por bloco (0000, C100, C170, ...)
  registro.writer.ts         # serialização pipe-delimitada, contadores, ordenação
  bloco-0.builder.ts         # 0000/0001/0005/0100/0150/0190/0200/0990
  bloco-c.builder.ts         # C001/C100/C101/C110/C170/C190/C990
  bloco-d.builder.ts         # D001/D100/D190/D990  (reusar fiscal-cte.service)
  bloco-e.builder.ts         # E001/E100/E110/E111/E116/E200/E210/E500.../E990
  bloco-h.builder.ts         # inventário (opcional/condicional)
  bloco-1.builder.ts         # 1001/1010/1990
  bloco-9.builder.ts         # 9001/9900/9990/9999  (gerado por último)
  efd-icms-ipi.service.ts    # orquestra período -> monta blocos -> escreve arquivo
  efd-icms-ipi.service.spec.ts
```

Expor endpoints (admin e cliente) do tipo:

- `POST /api/fiscal/sped/efd-icms-ipi/gerar` — body: `{ periodo: 'YYYY-MM', perfil, indFinalidade, ... }` → retorna arquivo `.txt` (download) e um relatório de validação/inconsistências.
- `GET /api/fiscal/sped/efd-icms-ipi/preview` — retorna resumo (contadores por bloco, totais) sem persistir.

### 5.2. Regras de serialização (obrigatórias para o PVA)

- Codificação **Latin-1/ISO-8859-1** (ou conforme leiaute vigente), quebra de linha **CRLF**, cada linha iniciando e terminando com `|`.
- **Valores monetários** com vírgula decimal, **sem separador de milhar**, sem sinal quando positivo (ex.: `1234,56`). Preservar os decimais que já vêm como string do parser; **não** usar `number` de ponto flutuante.
- **Datas** no formato `ddmmaaaa`.
- Campos vazios como `||` (sem espaços). Campos numéricos sem valor conforme regra do registro.
- **Ordenação e hierarquia**: cada bloco na ordem `0, C, D, E, G, H, K, 1, 9`; registros-filhos logo após o pai (ex.: `C170` após seu `C100`).
- **Contadores**: `xxx990` = quantidade de linhas do bloco (incluindo abertura/fechamento); `9900` = par (registro, quantidade) para **cada** tipo de registro presente; `9990` = total do Bloco 9; `9999` = total de linhas do arquivo.

### 5.3. Bloco 0 — mapeamento a partir do cadastro

- `0000`: CNPJ, IE, nome, UF, município (`cod_mun` IBGE), `IND_PERFIL`, `IND_ATIV`, `DT_INI`/`DT_FIN` do período, `COD_FIN` (0 = regular, 1 = substituto).
- `0100`: dados do contabilista (novo cadastro — pode vir de configuração da empresa/escritório).
- `0150`: um registro por **participante** (emitente/destinatário/transportadora) distinto do período; `COD_PART` estável por CNPJ/CPF.
- `0190`: unidades de medida distintas (a partir de `unidadeComercial`).
- `0200`: um registro por **item/produto** distinto (a partir de `documentosFiscaisItens`, reusar `getProdutos0200`), com `COD_ITEM` estável, `NCM`, `CEST`, unidade.

### 5.4. Bloco C (NF-e/NFC-e mod 55/65)

- `C100`: um por documento (`IND_OPER` entrada/saída = `tipoOperacaoEscriturada`; `IND_EMIT`; `COD_PART`; `COD_MOD`; `COD_SIT` por situação; chave; datas; `VL_DOC`, `VL_MERC`, `VL_ICMS`, `VL_IPI` etc.).
- `C170`: um por item (CFOP escriturado, `COD_ITEM`, quantidades, valores, CST ICMS, `VL_BC_ICMS`, `ALIQ_ICMS`, `VL_ICMS`, ST, IPI, PIS, COFINS conforme campos do registro).
  - **NFC-e (mod 65):** normalmente escriturada de forma consolidada; avaliar dispensa de `C170` conforme regra do período (muitas UFs dispensam item a item para 65). Confirmar no Guia Prático.
- `C190`: analítico por (`CST_ICMS`, `CFOP`, `ALIQ_ICMS`) — reaproveitar `fiscal-itens.service.ts::getC190`.
- `C101`/`C110`: DIFAL e informações complementares quando aplicável.

### 5.5. Bloco D (CT-e mod 57)

Já implementado em JSON (`fiscal-cte.service.ts::getD100`/`getD190`). Portar para o writer: `D001`, `D100`, `D190`, `D990`, usando somente registros com `escrituravel = true`. `COD_SIT` já resolvido por `codSituacaoSpedCte`.

### 5.6. Bloco E — apuração (usar §4)

- ICMS: `E100` (período) → `E110` (apuração) → `E111`/`E115`/`E116` (ajustes/obrigações a recolher).
- ICMS-ST: `E200`/`E210` por UF.
- IPI: `E500` → `E510`/`E520`/`E530`.

### 5.7. Blocos 1 e 9

- `1001`/`1010` (indicadores; em regra "sem ocorrências", mas o registro é obrigatório)/`1990`.
- `9001`/`9900` (um por tipo de registro efetivamente presente)/`9990`/`9999` — **gerados por último**, após todos os demais blocos, contando as linhas realmente emitidas.

---

## 6. Alterações de schema (migrations versionadas)

Toda mudança exige **nova migration** em `api/drizzle/NNNN_*.sql`, atualização de `api/drizzle/meta/_journal.json`/snapshot e `pnpm drizzle-kit generate`. Nunca alterar o banco sem migration.

Sugestões (ajustar tipos ao padrão de `schema.ts`):

1. **`documentosFiscais`**: adicionar `codSituacaoSped` (varchar 2), `valorTotalDeclaradoXml` (numeric 15,2, nullable) e um flag `integridadeConferida` (boolean) para o batimento do §4.5.
2. **`documentosFiscaisItens`**: opcional `codObsSped`/`codCtaSped` (se houver plano de contas).
3. Novas tabelas de cadastro estável do Bloco 0 (para códigos determinísticos por empresa): `sped_participantes` (0150), `sped_itens` (0200), `sped_unidades` (0190) — ou uma estratégia de derivação determinística em tempo de geração (documentar a escolha). Recomenda-se **persistir** para estabilidade de `COD_PART`/`COD_ITEM` entre competências.
4. **`sped_arquivos_gerados`**: auditoria das gerações (`cliente_id`, `periodo`, `perfil`, `hash`, `arquivo_key`, `contadores_json`, `gerado_por`, `criado_em`).
5. **`clientes`**: opcional `obrigadoEfdIcmsIpi` (boolean) e `perfilEfd` (`A`/`B`/`C`) para controlar geração por perfil.

---

## 7. Testes obrigatórios (Jest — seguir os `*.spec.ts` existentes)

1. **Serialização** (`registro.writer.ts`): formatação de valores (vírgula, sem milhar), datas `ddmmaaaa`, campos vazios `||`, CRLF, linha começando/terminando com `|`.
2. **Contadores**: `xxx990`, `9900` (par registro/quantidade), `9990`, `9999` coerentes com o conteúdo — teste de arquivo mínimo e de arquivo com múltiplos blocos.
3. **Bloco 0**: geração determinística de `COD_PART`/`COD_ITEM` estável entre execuções; `0190` sem unidades duplicadas.
4. **Bloco C**: `C100` + `C170` + `C190` consistentes; Σ `C170` = `C100`; NFC-e conforme regra de consolidação.
5. **Bloco D**: só CT-e `escrituravel = true`; `COD_SIT` correto; casos cancelado/denegado/complementar/anulação/substituto (reaproveitar specs de CT-e).
6. **Bloco E**: `E110` bate com Σ débitos/créditos (incluindo crédito de frete CT-e); Simples Nacional não gera Bloco E; IPI só para industrial/equiparado.
7. **Regime**: Simples Nacional bloqueado/avisado na geração; Lucro Real/Presumido gera normalmente.
8. **Integridade**: documento com Σ itens ≠ total do XML fica `PENDENTE_REVISAO` e é excluído da geração.
9. **Golden file**: um arquivo `.txt` de referência (fixture) para um período pequeno, comparado byte a byte.

---

## 8. Critérios de aceitação (Definition of Done)

- [ ] O sistema **gera o arquivo texto** da EFD ICMS/IPI para um período, com Blocos 0, C, D, E, 1 e 9 (H quando aplicável) e **passa na validação do PVA** vigente.
- [ ] Contadores `xxx990`/`9900`/`9990`/`9999` corretos; serialização (Latin-1, CRLF, `|`, vírgula decimal, datas `ddmmaaaa`) conforme o Guia Prático.
- [ ] Apuração de **ICMS** (E110, incluindo crédito de frete do CT-e), **ICMS-ST** (E200/E210) e **IPI** (E520) corretas por período e por regime.
- [ ] **Simples Nacional**: não gera Bloco E de ICMS/IPI; documentos mantidos só para conferência (sem crédito/débito).
- [ ] **Lucro Presumido/Real**: apuração e geração completas.
- [ ] Cadastros `0150`/`0190`/`0200` persistidos com códigos estáveis; `C100`/`C170`/`D100` referenciam-nos corretamente.
- [ ] Conferência de integridade (Σ itens × total do XML) implementada; divergências não entram no arquivo.
- [ ] Migrations versionadas + snapshot atualizado; `pnpm build`, `pnpm lint` e `pnpm test` verdes.
- [ ] Auditoria da geração persistida (`sped_arquivos_gerados`) sem vazar dados sensíveis em logs públicos.
- [ ] Documentação criada/atualizada: `api/docs/fiscal-sped-efd-icms-ipi.md` (blocos suportados, regras por regime, limitações conhecidas).

---

## 9. Pontos a confirmar antes de codar

- **Fonte oficial primária da documentação:** a página consolidada da Receita Federal para a EFD ICMS/IPI é [gov.br/sped → Escriturações Digitais → EFD ICMS IPI](https://www.gov.br/sped/pt-br/assuntos/escrituracoes-digitais/efd-icms-ipi). Use-a como ponto de partida para obter o **Guia Prático**, o **leiaute (Ato COTEPE 44/2018 e alterações)**, os **comunicados** e a versão vigente do **PVA**. Sempre confira a data de vigência do documento contra o período de apuração alvo.
- **Versão do leiaute / Guia Prático vigente para o período.** As fontes oficiais recentes indicam **Guia Prático v3.2.0 (vigência a partir de jan/2026)** e **PVA 6.1.0** (adequação ao CNPJ alfanumérico), enquanto os docs internos citam **3.2.2 / leiaute 020**. Fixar a versão em função do período e validar os campos exatos de cada registro no Ato COTEPE/ICMS 44/2018 vigente antes de emitir arquivo definitivo. Referências: [Guia Prático e leiaute](https://www.gov.br/sped/pt-br/assuntos/escrituracoes-digitais/efd-icms-ipi), [ATO COTEPE/ICMS 44/18](https://www.confaz.fazenda.gov.br/legislacao/atos/2018/ato-cotepe-icms-44-18), [PVA EFD ICMS IPI 6.1.0](https://www.gov.br/sped/pt-br/assuntos/comunicados/efd-icms-ipi/publicacao-do-programa-efd-icms-ipi-versao-6-1.0). *Conteúdo das fontes foi reescrito para conformidade com restrições de licenciamento.*
- **Obrigatoriedade por UF e por perfil** (Ajuste SINIEF 02/2009 e legislação estadual): confirmar quais clientes são obrigados e o **perfil (A/B/C)**, pois isso muda a granularidade exigida (ex.: dispensa de C170 para NFC-e).
- **Política de crédito** (frete/CT-e, benefícios, vedações estaduais): manter a diretriz de **marcar para revisão** em vez de creditar automaticamente em casos ambíguos.
- **CNPJ alfanumérico**: o PVA 6.1.0 já contempla; garantir que validações de chave e de `0150`/participantes suportem o novo formato quando aplicável.
- **Inventário (Bloco H) e Bloco K**: confirmar se algum cliente-alvo é obrigado no período; caso não, manter fora do MVP e documentar.

---

### Resumo em uma frase para a IA executora

> Construa, sobre a apuração já existente, um **gerador do arquivo EFD ICMS/IPI (SPED Fiscal)** com os Blocos 0/C/D/E/1/9 (H quando aplicável), apurando ICMS/ICMS-ST/IPI por período **de acordo com o regime da empresa** (Simples Nacional só para conferência; Lucro Presumido/Real apuração completa), persistindo os cadastros do Bloco 0, conferindo a integridade contra o total do XML, e entregando um `.txt` que **passe no PVA vigente** — tudo com migrations versionadas, testes (incluindo golden file) e a versão do leiaute confirmada no ATO COTEPE.
