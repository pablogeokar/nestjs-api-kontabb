# PROMPT DE ESPECIFICAÇÃO TÉCNICA E IMPLEMENTAÇÃO
## Persistência de Itens de Documentos Fiscais (NF-e/NFC-e) para Livros Fiscais e Obrigações Acessórias (SPED EFD ICMS/IPI, EFD Contribuições, ECF)

---

### 🎯 OBJETIVO PRINCIPAL
Implementar a extração completa e a persistência relacional dos **itens de notas fiscais (tags `<det>` e `<prod>` do XML da NF-e modelo 55 e NFC-e modelo 65)** no backend do sistema **Kontabb** (NestJS + TypeScript + Drizzle ORM + PostgreSQL).

Esses dados devem ser armazenados com precisão decimal, fidelidade tributária e integridade relacional, servindo como base canônica para:
1. **Livros Fiscais de Entrada e Saída** (Registro de Entradas Modelo 1/1-A, Registro de Saídas Modelo 2/2-A e Apuração de ICMS/IPI).
2. **SPED Fiscal (EFD ICMS/IPI)**:
   - Registro 0200 (Tabela de Identificação do Item / Produto).
   - Registro C100 (Documento - Nota Fiscal de Mercadorias).
   - Registro C170 (Itens do Documento - Obrigatório para entradas e emissões próprias).
   - Registro C190 (Registro Analítico do Documento por CST, CFOP e Alíquota).
3. **SPED Contribuições (EFD Contribuições - PIS/COFINS)**:
   - Registro C170 / C175 / C180 / C190 e consolidações por CST de PIS/COFINS e CFOP.
4. **Escrituração Contábil Fiscal (ECF / E-Lalur / LACS)** e apuração de tributos (Simples Nacional PGDAS-D, Lucro Presumido e Lucro Real).

---

### 🏗️ CONTEXTO DO PROJETO (KONTABB)
- **Backend**: NestJS (`/api`)
- **Linguagem**: TypeScript
- **ORM / Database**: Drizzle ORM (`drizzle-orm`, `drizzle-kit`) + PostgreSQL (`node-postgres` / `pgTable`)
- **Parser XML**: `fast-xml-parser` (ou parsers utilitários dedicados em `/api/src/fiscal/services`)
- **Tabelas Existentes Relevantes**:
  - `clientes` (ID, CNPJ, Razão Social, Regime Tributário)
  - `documentos_fiscais` (id, cliente_id, chave_acesso, nsu, tipo_documento, modelo, serie, numero_documento, emitente_*, destinatario_*, data_emissao, valor_total, situacao, xml_key, etc.)
  - `eventos_fiscais`
  - `controle_nsu`
- **Fluxos de Entrada de XML**:
  - `DistribuicaoDfeService` (busca automática via SEFAZ / NSU)
  - `ImportacaoXmlFiscalService` (upload manual de arquivos XML/ZIP)

---

### 📦 ESCOPO DETALHADO DA DEMANDA

#### 1. MODELAGEM DO BANCO DE DADOS (Drizzle ORM)
Criar a tabela `documentos_fiscais_itens` (ou `itens_documentos_fiscais`) associada via chave estrangeira com exclusão em cascata (`onDelete: 'cascade'`) a `documentos_fiscais.id`.

A modelagem deve contemplar:

##### A. Identificação e Dados Gerais do Item (`<prod>`):
- `id`: UUID (Primary Key)
- `documento_fiscal_id`: UUID (Foreign Key para `documentos_fiscais.id`)
- `cliente_id`: UUID (Foreign Key para `clientes.id`, com index)
- `numero_item` (`nItem`): Integer (1 a 990)
- `codigo_produto` (`cProd`): Text (código interno do produto/serviço no emissor)
- `codigo_ean` (`cEAN`): Text (GTIN/EAN comercial)
- `descricao` (`xProd`): Text (descrição da mercadoria ou serviço)
- `ncm` (`NCM`): VarChar(8) (classificação fiscal NCM)
- `nve` (`NVE`): Text (Nomenclatura de Valor Aduaneiro e Estatística, opcional)
- `cest` (`CEST`): VarChar(7) (Código Especificador da Substituição Tributária)
- `ind_escala` (`indEscala`): VarChar(1) ('S' ou 'N')
- `cnpj_fabricante` (`CNPJFab`): VarChar(14)
- `codigo_beneficio_fiscal` (`cBenef`): Text
- `cfop` (`CFOP`): VarChar(4) (Código Fiscal de Operações e Prestações - ex: '5102', '1102', '5405')
- `unidade_comercial` (`uCom`): VarChar(10)
- `quantidade_comercial` (`qCom`): Numeric(15, 4)
- `valor_unitario_comercial` (`vUnCom`): Numeric(16, 4) (ou até 10 casas decimais)
- `valor_bruto_produto` (`vProd`): Numeric(15, 2)
- `codigo_ean_tributavel` (`cEANTrib`): Text
- `unidade_tributavel` (`uTrib`): VarChar(10)
- `quantidade_tributavel` (`qTrib`): Numeric(15, 4)
- `valor_unitario_tributavel` (`vUnTrib`): Numeric(16, 4)
- `valor_frete` (`vFrete`): Numeric(15, 2)
- `valor_seguro` (`vSeg`): Numeric(15, 2)
- `valor_desconto` (`vDesc`): Numeric(15, 2)
- `valor_outras_despesas` (`vOutro`): Numeric(15, 2)
- `ind_total` (`indTot`): VarChar(1) ('0' ou '1')
- `numero_pedido_compra` (`xPed`): Text
- `item_pedido_compra` (`nItemPed`): Text
- `informacoes_adicionais` (`infAdProd`): Text

##### B. Grupo ICMS Normal, ST, Diferimento e Desoneração (`<imposto><ICMS>`):
- `origem_mercadoria` (`orig`): VarChar(1) ('0' a '8')
- `cst_icms` (`CST`): VarChar(3) (ex: '00', '10', '20', '30', '40', '41', '50', '51', '60', '70', '90')
- `csosn_icms` (`CSOSN`): VarChar(4) (ex: '101', '102', '201', '202', '500', '900')
- `modalidade_bc_icms` (`modBC`): VarChar(1)
- `percentual_reducao_bc_icms` (`pRedBC`): Numeric(7, 4)
- `valor_bc_icms` (`vBC`): Numeric(15, 2)
- `aliquota_icms` (`pICMS`): Numeric(7, 4)
- `valor_icms` (`vICMS`): Numeric(15, 2)
- `modalidade_bc_icms_st` (`modBCST`): VarChar(1)
- `percentual_mva_st` (`pMVAST`): Numeric(7, 4)
- `percentual_reducao_bc_icms_st` (`pRedBCST`): Numeric(7, 4)
- `valor_bc_icms_st` (`vBCST`): Numeric(15, 2)
- `aliquota_icms_st` (`pICMSST`): Numeric(7, 4)
- `valor_icms_st` (`vICMSST`): Numeric(15, 2)
- `valor_bc_fcp` (`vBCFCP`): Numeric(15, 2)
- `aliquota_fcp` (`pFCP`): Numeric(7, 4)
- `valor_fcp` (`vFCP`): Numeric(15, 2)
- `valor_bc_fcp_st` (`vBCFCPST`): Numeric(15, 2)
- `aliquota_fcp_st` (`pFCPST`): Numeric(7, 4)
- `valor_fcp_st` (`vFCPST`): Numeric(15, 2)
- `motivo_desoneracao_icms` (`motDesICMS`): VarChar(2)
- `valor_icms_desonerado` (`vICMSDeson`): Numeric(15, 2)
- `percentual_diferimento` (`pDif`): Numeric(7, 4)
- `valor_icms_diferido` (`vICMSDif`): Numeric(15, 2)
- `valor_icms_operacao` (`vICMSOp`): Numeric(15, 2)
- `aliquota_credito_sn` (`pCredSN`): Numeric(7, 4)
- `valor_credito_icms_sn` (`vCredICMSSN`): Numeric(15, 2)
- `valor_bc_icms_st_retido` (`vBCSTRet`): Numeric(15, 2)
- `aliquota_icms_st_retido` (`pST`): Numeric(7, 4)
- `valor_icms_st_retido` (`vICMSSTRet`): Numeric(15, 2)

##### C. Grupo ICMS Interestadual / DIFAL (EC 87/15 - `<ICMSUFDest>`):
- `valor_bc_icms_uf_dest` (`vBCUFDest`): Numeric(15, 2)
- `valor_bc_fcp_uf_dest` (`vBCFCPUFDest`): Numeric(15, 2)
- `percentual_fcp_uf_dest` (`pFCPUFDest`): Numeric(7, 4)
- `aliquota_icms_uf_dest` (`pICMSUFDest`): Numeric(7, 4)
- `aliquota_icms_interestadual` (`pICMSInter`): Numeric(7, 4)
- `percentual_provisorio_partilha` (`pICMSInterPart`): Numeric(7, 4)
- `valor_fcp_uf_dest` (`vFCPUFDest`): Numeric(15, 2)
- `valor_icms_uf_dest` (`vICMSUFDest`): Numeric(15, 2)
- `valor_icms_uf_remetente` (`vICMSUFRemet`): Numeric(15, 2)

##### D. Grupo IPI (`<imposto><IPI>`):
- `cst_ipi` (`CST`): VarChar(2) (ex: '00', '49', '50', '99')
- `classe_enquadramento_ipi` (`clEnq`): VarChar(5)
- `codigo_enquadramento_ipi` (`cEnq`): VarChar(3)
- `cnpj_produtor_ipi` (`CNPJProd`): VarChar(14)
- `valor_bc_ipi` (`vBC`): Numeric(15, 2)
- `aliquota_ipi` (`pIPI`): Numeric(7, 4)
- `quantidade_unidade_ipi` (`qUnid`): Numeric(15, 4)
- `valor_unidade_ipi` (`vUnid`): Numeric(15, 4)
- `valor_ipi` (`vIPI`): Numeric(15, 2)

##### E. Grupo PIS e PIS ST (`<imposto><PIS>` e `<PISST>`):
- `cst_pis` (`CST`): VarChar(2) (ex: '01', '02', '03', '04', '06', '07', '08', '09', '49', '50', '99')
- `valor_bc_pis` (`vBC`): Numeric(15, 2)
- `aliquota_pis_percentual` (`pPIS`): Numeric(7, 4)
- `quantidade_bc_pis` (`qBCProd`): Numeric(15, 4)
- `aliquota_pis_reais` (`vAliqProd`): Numeric(15, 4)
- `valor_pis` (`vPIS`): Numeric(15, 2)
- `valor_bc_pis_st` (`vBC`): Numeric(15, 2)
- `aliquota_pis_st_percentual` (`pPIS`): Numeric(7, 4)
- `valor_pis_st` (`vPIS`): Numeric(15, 2)

##### F. Grupo COFINS e COFINS ST (`<imposto><COFINS>` e `<COFINSST>`):
- `cst_cofins` (`CST`): VarChar(2) (ex: '01', '02', '03', '04', '06', '07', '08', '09', '49', '50', '99')
- `valor_bc_cofins` (`vBC`): Numeric(15, 2)
- `aliquota_cofins_percentual` (`pCOFINS`): Numeric(7, 4)
- `quantidade_bc_cofins` (`qBCProd`): Numeric(15, 4)
- `aliquota_cofins_reais` (`vAliqProd`): Numeric(15, 4)
- `valor_cofins` (`vCOFINS`): Numeric(15, 2)
- `valor_bc_cofins_st` (`vBC`): Numeric(15, 2)
- `aliquota_cofins_st_percentual` (`pCOFINS`): Numeric(7, 4)
- `valor_cofins_st` (`vCOFINS`): Numeric(15, 2)

##### G. Grupo Imposto de Importação (`<imposto><II>`) e Outros:
- `valor_bc_ii` (`vBC`): Numeric(15, 2)
- `valor_despesa_aduaneira` (`vDespAdu`): Numeric(15, 2)
- `valor_imposto_importacao` (`vII`): Numeric(15, 2)
- `valor_iof` (`vIOF`): Numeric(15, 2)
- `valor_tributos_aproximados` (`vTotTrib`): Numeric(15, 2) (Lei da Transparência / IBPT)

##### H. Metadados e Índices:
- `criado_em`: Timestamp
- `atualizado_em`: Timestamp
- **Índices recomendados**:
  - `uniqueIndex('uidx_item_doc_num')` em `(documento_fiscal_id, numero_item)`
  - `index('idx_item_cliente_id')` em `(cliente_id)`
  - `index('idx_item_cfop')` em `(cfop)`
  - `index('idx_item_cst_icms')` em `(cst_icms)`
  - `index('idx_item_csosn_icms')` em `(csosn_icms)`
  - `index('idx_item_cst_pis')` em `(cst_pis)`
  - `index('idx_item_cst_cofins')` em `(cst_cofins)`
  - `index('idx_item_ncm')` em `(ncm)`

---

#### 2. PARSER DE XML ROBUSTO PARA ITENS (`nfe-item.parser.ts` ou extensão de `dfe-document.parser.ts`)
Criar ou expandir o módulo de parsing XML para processar com segurança e tipagem estrita todas as variações de tags de itens da NF-e e NFC-e:

1. **Suporte a múltiplos itens**: O XML pode conter 1 ou centenas de tags `<det nItem="...">`. Iterar corretamente tratando quando o XML parser retorna objeto único ou array.
2. **Suporte a todas as variações do ICMS**:
   - `ICMS00`, `ICMS10`, `ICMS20`, `ICMS30`, `ICMS40`, `ICMS51`, `ICMS60`, `ICMS70`, `ICMS90`
   - `ICMSPart`, `ICMSST`
   - `ICMSSN101`, `ICMSSN102`, `ICMSSN201`, `ICMSSN202`, `ICMSSN500`, `ICMSSN900`
3. **Suporte a todas as variações do PIS e COFINS**:
   - `PISAliq`, `PISQtde`, `PISNT`, `PISOutr`
   - `COFINSAliq`, `COFINSQtde`, `COFINSNT`, `COFINSOutr`
   - `PISST`, `COFINSST`
4. **Suporte a IPI**:
   - `IPITrib`, `IPINT`
5. **Tratamento de Strings Numéricas e Decimais**:
   - Parsing com validação de números válidos, mantendo precisão necessária sem erros de ponto flutuante (armazenar como `string` decimal padronizada para o Drizzle `numeric`).

---

#### 3. PERSISTÊNCIA EM TRANSAÇÃO E IDEMPOTÊNCIA
Atualizar os serviços responsáveis pela gravação das notas:
1. `DistribuicaoDfeService`:
   - Ao sincronizar documentos da SEFAZ, executar o parsing dos itens e gravar na transação (`this.database.db.transaction(async (tx) => ...)`).
   - Garantir idempotência: se o documento fiscal já existir ou estiver sendo atualizado (ex: substituição de resumo por XML completo), deletar os itens antigos e inserir os novos dentro da mesma transação.
2. `ImportacaoXmlFiscalService`:
   - No upload manual de XMLs (ou lote ZIP), extrair os itens e persistir atomicamente junto com o cabeçalho do documento fiscal.

---

#### 4. ENDPOINTS E SERVIÇOS DE CONSULTA (API / DTOs)
1. **Listagem e Consulta Detalhada de Itens**:
   - Endpoint para buscar os itens de um documento fiscal específico:
     `GET /clientes/:clienteId/fiscal/documentos/:documentoId/itens` ou `GET /fiscal/documentos/:documentoId/itens`
   - Retornar os itens com todos os campos fiscais organizados por blocos (Produto, ICMS, IPI, PIS, COFINS, Totais).
2. **Filtros e Relatórios Analíticos**:
   - Suporte a filtros fiscais: busca por CFOP, CST, NCM, período de emissão e cliente.

---

#### 5. PREPARAÇÃO PARA LIVROS FISCAIS E SPED (UTILITÁRIOS / QUERIES ANALÍTICAS)
Implementar métodos utilitários ou views no repositório fiscal que facilitem:
1. **Agrupamento C190 (Analítico do Documento)**:
   - Consulta/agregação que agrupa os itens por `(CST_ICMS/CSOSN, CFOP, ALIQ_ICMS)` e soma:
     - `VL_OPR` (Valor da Operação)
     - `VL_BC_ICMS` (Base de Cálculo do ICMS)
     - `VL_ICMS` (Valor do ICMS)
     - `VL_BC_ICMS_ST` (Base de Cálculo do ICMS ST)
     - `VL_ICMS_ST` (Valor do ICMS ST)
     - `VL_RED_BC` (Valor não tributado / redução)
     - `VL_IPI` (Valor do IPI)
2. **Cadastro do Produto (SPED Registro 0200)**:
   - Extração consolidada e deduplicada dos produtos por `(cliente_id, codigo_produto)` contendo última descrição, NCM, CEST, unidade padrão, código de barras.
3. **Resumos para Livro Registro de Entradas e Saídas**:
   - Agregação por CFOP e Alíquota para cálculo do ICMS Creditado (Entradas) e ICMS Debitado (Saídas).

---

#### 6. REQUISITOS DE TESTES E VALIDAÇÃO
1. **Testes Unitários**:
   - Testar o parser de itens com fixtures de XMLs reais representando:
     - NF-e de Regime Normal (ICMS 00, 10 com ST, 20 com Redução, 40 Isento, 51 Diferido).
     - NF-e de Simples Nacional (CSOSN 101 com aproveitamento de crédito, CSOSN 102, CSOSN 500 Monofásico/ST).
     - NF-e com DIFAL (partilha interestadual).
     - NF-e com múltiplos itens (> 50 itens).
     - NFC-e modelo 65.
2. **Testes de Integração**:
   - Testar inserção, atualização idempotente e deleção em cascata (`cascade delete` ao remover documento fiscal).
   - Testar migração do banco com `pnpm drizzle-kit generate` / scripts de migration sem quebrar tabelas existentes.

---

### 📋 CHECKLIST DE ENTREGA ESPERADA
- [ ] Schema Drizzle atualizado (`schema.ts`) com a tabela `documentos_fiscais_itens` e índices apropriados.
- [ ] Migração do banco gerada e testada.
- [ ] Parser de XML (`dfe-document.parser.ts` ou `nfe-item.parser.ts`) extraindo com 100% de cobertura os campos de `<prod>`, `<imposto>`, ICMS, IPI, PIS, COFINS e II.
- [ ] Serviços `DistribuicaoDfeService` e `ImportacaoXmlFiscalService` persistindo itens em transação atômica.
- [ ] Endpoints e DTOs para consulta dos itens via REST API.
- [ ] Consultas analíticas agregadas (Base para SPED C190 e Livros Fiscais).
- [ ] Cobertura de testes unitários e de integração validando a extração e persistência.
