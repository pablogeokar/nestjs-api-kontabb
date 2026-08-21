# PROMPT DE ESPECIFICAÇÃO TÉCNICA E IMPLEMENTAÇÃO
## Escrituração Fiscal Inteligente: Determinação de Sentido da Operação (Entrada/Saída), Cadastro de CFOPs, Mapeamento de CFOPs Equivalentes e Apuração de ICMS no Backend Kontabb

---

### 🎯 OBJETIVO PRINCIPAL

Implementar no backend do **Kontabb** (`/api`, NestJS + TypeScript + Drizzle ORM + PostgreSQL) o mecanismo de **escrituração fiscal inteligente** para Livros Fiscais de Entrada e Saída, Apuração de ICMS/IPI e obrigações acessórias (SPED EFD ICMS/IPI e EFD Contribuições).

O sistema deve:
1. **Identificar automaticamente o sentido da operação (`ENTRADA` ou `SAÍDA`)** do ponto de vista do cliente da contabilidade (`clientes.id`), distinguindo documentos emitidos pelo próprio cliente daqueles emitidos por terceiros (fornecedores/prestadores).
2. **Converter/mapear o CFOP do XML** para o seu **CFOP equivalente de escrituração**. Por exemplo: quando um fornecedor emite uma NF-e de venda para o cliente com o CFOP `5.102` (Saída no XML do fornecedor), o sistema Kontabb deve escriturá-la no Livro de Entradas do cliente com o CFOP `1.102` (Compra para Comercialização).
3. **Implementar a Tabela Canônica de CFOPs (`cfops`)** com suporte a busca, filtros e gerenciamento.
4. **Implementar a Tabela de Equivalências de CFOP (`cfop_equivalencias`)** permitindo regras padrões do sistema (globais) e regras customizadas por cliente (override por empresa).
5. **Permitir a Re-escrituração / Reprocessamento Fiscal** de documentos e itens fiscais já importados no banco de dados.
6. **Revisar a Apuração do ICMS e Consolidação SPED C190**: Garantir que a apuração analítica C190, os Livros de ICMS e as telas do Módulo Fiscal apresentem os dados agrupados pelo **CFOP escriturado equivalente** (ex: `1102`, `2102`) e classifiquem corretamente o ICMS destacado em notas de terceiros como **Crédito de ICMS** (Entrada) em vez de Débito de Saída.

---

### 🏗️ CONTEXTO DO PROJETO (KONTABB)

- **Backend Location**: `/api`
- **Framework**: NestJS (`@nestjs/common`, `@nestjs/core`, `@nestjs/swagger`)
- **Linguagem**: TypeScript 5.x
- **ORM / Database**: Drizzle ORM (`drizzle-orm`) + PostgreSQL (`node-postgres` / `postgres`)
- **Schema Central**: `/api/src/database/schema.ts`
- **Módulo Fiscal**: `/api/src/fiscal`
- **Entidades Fiscais Existentes**:
  - `clientes`: Contém `id`, `cnpj`, `cpf`, `tipoPessoa`, `razaoSocial`, etc.
  - `documentos_fiscais`: Guarda o cabeçalho das NF-e (modelo 55), CT-e (modelo 57) e NFC-e (modelo 65).
  - `documentos_fiscais_itens`: Guarda os itens (`<det>` / `<prod>`) extraídos do XML.
- **Serviços Atuais de Ingestão de XML**:
  - `DistribuicaoDfeService`: Sincronização automática com a SEFAZ via NSU.
  - `ImportacaoXmlFiscalService`: Upload de arquivos XML/ZIP manuais.
  - `FiscalItensService`: Relatórios, resumos de livros fiscais, apuração C190 e consulta analítica de itens.

---

### 💡 REGRA DE NEGÓCIO DA ESCRITURAÇÃO FISCAL

#### 1. Determinação do Sentido da Operação Escriturada (`tipoOperacaoEscriturada`)

A classificação da operação no Livro Fiscal do Cliente (`clienteId`) obedece à seguinte matriz de decisão:

| CNPJ/CPF Emitente do XML | CNPJ/CPF Destinatário do XML | Tag XML `tpNF` / `tpCTe` | Sentido da Operação Escriturada (`tipoOperacaoEscriturada`) | Tipo de Livro Fiscal |
| :--- | :--- | :--- | :--- | :--- |
| **Diferente** do cliente (`emitente != cliente.cnpj`) | Igual ou associado ao cliente | `1` (Saída no XML) | **`ENTRADA`** | **Livro de Registro de Entradas** |
| **Diferente** do cliente (`emitente != cliente.cnpj`) | Igual ou associado ao cliente | `0` (Entrada no XML) | **`ENTRADA`** | **Livro de Registro de Entradas** |
| **Igual** do cliente (`emitente == cliente.cnpj`) | Qualquer terceiro | `1` (Saída no XML) | **`SAIDA`** | **Livro de Registro de Saídas** |
| **Igual** do cliente (`emitente == cliente.cnpj`) | Qualquer terceiro / Próprio | `0` (Entrada no XML) | **`ENTRADA`** (Ex: Devolução de Compras) | **Livro de Registro de Entradas** |

> **Nota para CT-e (Modelo 57)**: Quando o cliente for o **tomador do serviço de transporte** ou **destinatário** da carga enviada por terceiro, o transporte de compras é escriturado como **`ENTRADA`** (Aquisição de Serviço de Transporte - CFOP 1.35x / 2.35x).

---

#### 2. Mapeamento e Equivalência de CFOPs

Ao escriturar um documento fiscal de **ENTRADA** cujo XML contenha um CFOP de **SAÍDA** (iniciado em `5`, `6` ou `7`), o sistema **deve converter o CFOP** para seu equivalente de entrada (iniciado em `1`, `2` ou `3`).

##### Hierarquia de Resolução do CFOP Escriturado:
1. **Regra Customizada do Cliente (`cfop_equivalencias`)**:
   Verifica se existe uma regra ativa onde `cliente_id == clienteId` AND `cfop_origem == cfopXml` AND `ativo == true`.
2. **Regra Padrão do Sistema (`cfop_equivalencias` Global)**:
   Verifica se existe uma regra ativa onde `cliente_id IS NULL` AND `cfop_origem == cfopXml` AND `ativo == true`.
3. **Algoritmo Padrão SEFAZ (Fallback Automático)**:
   Se não houver regra cadastrada, aplica a regra de troca do primeiro dígito:
   - `5.XXX` ➡️ `1.XXX` (Operação Estadual de Entrada)
   - `6.XXX` ➡️ `2.XXX` (Operação Interestadual de Entrada)
   - `7.XXX` ➡️ `3.XXX` (Operação com o Exterior de Entrada)
   - *Se a operação escriturada for SAÍDA e o XML for de Entrada*: `1.XXX` ➡️ `5.XXX`, `2.XXX` ➡️ `6.XXX`, `3.XXX` ➡️ `7.XXX`.
4. **Validação de Existência**:
   Confirma se o CFOP de destino resultante existe na tabela `cfops`. Se não existir, utiliza o código de fallback padrão (ex: `1949` / `2949` para outras entradas) e sinaliza o item como necessitando revisão.

---

#### 3. Apuração e Consolidação do ICMS (Créditos vs Débitos e Registro SPED C190)

Na apuração do ICMS e na consolidação do registro SPED C190:
- **Documentos/Itens de ENTRADA**: Os valores de ICMS destacados (`valorBcIcms`, `valorIcms`, `valorBcIcmsSt`, `valorIcmsSt`) nas notas de fornecedores representam **DIREITO A CRÉDITO DE ICMS** (ou ICMS retido por ST a ressarcir/restituir), quando o CST/CSOSN indicar operação tributada com direito a crédito (ex: CST `00`, `10`, `20`, `70` / CSOSN `101`, `201`).
- **Documentos/Itens de SAÍDA**: Os valores de ICMS destacados representam **DÉBITOS DE ICMS** (ICMS a recolher / tributação sobre vendas e prestações).
- **Exibição do CFOP na Apuração C190 e Livros Fiscais**: O CFOP exibido nas tabelas de apuração analítica deve ser **SEMPRE o CFOP escriturado equivalente** (ex: `1102`, `2102`, `1403`, `2403`) do cliente, e **nunca o CFOP bruto do fornecedor** (`5102`, `6102`).
- **Consolidação Apuração de ICMS**:
  $$\text{Total Débitos (Saídas)} = \sum \text{valorIcms (Itens de Saída)}$$
  $$\text{Total Créditos (Entradas)} = \sum \text{valorIcms (Itens de Entrada com direito a crédito)}$$
  $$\text{Saldo Apurado do Período} = \text{Total Débitos} - \text{Total Créditos}$$

---

### 📦 ESCOPO DETALHADO DA IMPLEMENTAÇÃO

#### 1. MODELAGEM DO BANCO DE DADOS (Drizzle ORM em `api/src/database/schema.ts`)

##### A. Tabela Canônica de CFOPs (`cfops`)
```typescript
export const cfops = pgTable(
  'cfops',
  {
    codigo: varchar('codigo', { length: 4 }).primaryKey(), // Ex: '1102', '5102'
    descricao: text('descricao').notNull(),
    tipoOperacao: varchar('tipo_operacao', { length: 10 }).notNull(), // 'ENTRADA' | 'SAIDA'
    abrangencia: varchar('abrangencia', { length: 15 }).notNull(), // 'ESTADUAL' | 'INTERESTADUAL' | 'EXTERIOR'
    grupo: text('grupo'), // Ex: 'Compras de Mercadorias', 'Vendas de Mercadorias'
    descricaoDetalhada: text('descricao_detalhada'),
    ativo: boolean('ativo').notNull().default(true),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
  },
  (table) => [
    index('idx_cfops_tipo').on(table.tipoOperacao),
    index('idx_cfops_abrangencia').on(table.abrangencia),
    check('chk_cfops_codigo', sql`${table.codigo} ~ '^[1-7][0-9]{3}$'`),
    check('chk_cfops_tipo', sql`${table.tipoOperacao} IN ('ENTRADA', 'SAIDA')`),
    check('chk_cfops_abrangencia', sql`${table.abrangencia} IN ('ESTADUAL', 'INTERESTADUAL', 'EXTERIOR')`),
  ],
);
```

##### B. Tabela de Equivalências de CFOP (`cfop_equivalencias`)
```typescript
export const cfopEquivalencias = pgTable(
  'cfop_equivalencias',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clienteId: uuid('cliente_id').references(() => clientes.id, { onDelete: 'cascade' }), // Null = Regra Global Padrão
    cfopOrigem: varchar('cfop_origem', { length: 4 })
      .notNull()
      .references(() => cfops.codigo, { onDelete: 'cascade' }),
    cfopDestino: varchar('cfop_destino', { length: 4 })
      .notNull()
      .references(() => cfops.codigo, { onDelete: 'cascade' }),
    tipoOperacao: varchar('tipo_operacao', { length: 20 }).notNull().default('SAIDA_PARA_ENTRADA'),
    descricao: text('descricao'),
    ativo: boolean('ativo').notNull().default(true),
    criadoEm: timestamp('criado_em').notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uidx_cfop_eq_cliente_origem').on(table.clienteId, table.cfopOrigem),
    index('idx_cfop_eq_origem').on(table.cfopOrigem),
    index('idx_cfop_eq_cliente').on(table.clienteId),
    check('chk_cfop_eq_tipo', sql`${table.tipoOperacao} IN ('SAIDA_PARA_ENTRADA', 'ENTRADA_PARA_SAIDA')`),
  ],
);
```

##### C. Alterações/Adições em `documentos_fiscais`
Adicionar os seguintes campos na tabela `documentos_fiscais`:
- `tipoOperacaoEscriturada`: `varchar('tipo_operacao_escriturada', { length: 10 }).notNull().default('ENTRADA')` (Com check `IN ('ENTRADA', 'SAIDA')`)
- `tpNfXml`: `varchar('tp_nf_xml', { length: 1 })` ('0' ou '1')

##### D. Alterações/Adições em `documentos_fiscais_itens`
Adicionar os seguintes campos na tabela `documentos_fiscais_itens`:
- `cfopXml`: `varchar('cfop_xml', { length: 4 })` (Armazena o CFOP bruto que veio na tag `<prod><CFOP>` do XML).
- `cfop`: `varchar('cfop', { length: 4 }).notNull()` (Passa a armazenar o **CFOP escriturado equivalente**, preservando total compatibilidade com consultas e relatórios existentes).
- `tipoOperacaoEscriturada`: `varchar('tipo_operacao_escriturada', { length: 10 }).notNull().default('ENTRADA')`

---

#### 2. SEED DE DADOS E MIGRAÇÕES
1. Criar migration Drizzle com `npx drizzle-kit generate`.
2. Criar script de Seed (`/api/src/database/seeds/cfops.seed.ts`) populando:
   - **Tabela `cfops`**: Inserir os principais CFOPs da Tabela Oficial CONFAZ/SEFAZ (1101, 1102, 1201, 1202, 1401, 1403, 1405, 1551, 1556, 1949, 2101, 2102, 2201, 2202, 2401, 2403, 2405, 2551, 2556, 2949, 3101, 3102, 5101, 5102, 5201, 5202, 5401, 5403, 5405, 5551, 5556, 5949, 6101, 6102, 6201, 6202, 6401, 6403, 6405, 6551, 6556, 6949, 7101, 7102, etc.).
   - **Tabela `cfop_equivalencias` (Globais)**:
     - `5101` ➡️ `1101` (Venda de produção ➡️ Compra para industrialização)
     - `5102` ➡️ `1102` (Venda de mercadoria ➡️ Compra para comercialização)
     - `6101` ➡️ `2101` (Venda interestadual produção ➡️ Compra interestadual industrialização)
     - `6102` ➡️ `2102` (Venda interestadual ➡️ Compra interestadual comercialização)
     - `5405` ➡️ `1403` (Venda ST retida antes ➡️ Compra com ST)
     - `6403` ➡️ `2403` (Venda ST interestadual ➡️ Compra interestadual ST)
     - `5353` ➡️ `1353` (Frete municipal/estadual)
     - `6353` ➡️ `2353` (Frete interestadual)
     - `5551` ➡️ `1551` (Venda ativo imobilizado ➡️ Compra ativo imobilizado)
     - `5556` ➡️ `1556` (Devolução/Material uso consumo)

---

#### 3. NOVO MÓDULO E SERVIÇO DE CFOP (`CfopModule`, `CfopService`)

Criar a estrutura em `/api/src/fiscal/services/cfop.service.ts` (e exportar no `FiscalModule`):

```typescript
@Injectable()
export class CfopService {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Determina o sentido da operacao (ENTRADA ou SAIDA) para o cliente.
   */
  determinarTipoOperacaoEscriturada(
    clienteCnpjCpf: string,
    emitenteCnpjCpf: string,
    tpNfXml: string,
  ): 'ENTRADA' | 'SAIDA' {
    const limpoCliente = clienteCnpjCpf.replace(/\D/g, '');
    const limpoEmitente = emitenteCnpjCpf.replace(/\D/g, '');

    if (limpoEmitente !== limpoCliente) {
      // Documento emitido por terceiro destinado ao cliente
      return 'ENTRADA';
    }

    // Documento emitido pelo próprio cliente
    if (tpNfXml === '0') {
      return 'ENTRADA'; // Entrada própria (ex: Devolução de Compra)
    }

    return 'SAIDA';
  }

  /**
   * Resolve o CFOP equivalente para escrituracao fiscal.
   */
  async resolverCfopEquivalente(params: {
    clienteId: string;
    cfopXml: string;
    tipoOperacaoEscriturada: 'ENTRADA' | 'SAIDA';
  }): Promise<string> {
    const { clienteId, cfopXml, tipoOperacaoEscriturada } = params;

    // Se for SAIDA e o CFOP ja for de SAIDA (5, 6, 7), mantem.
    // Se for ENTRADA e o CFOP ja for de ENTRADA (1, 2, 3), mantem.
    const primeiroDigito = cfopXml.charAt(0);
    const ehCfopEntrada = ['1', '2', '3'].includes(primeiroDigito);
    const ehCfopSaida = ['5', '6', '7'].includes(primeiroDigito);

    if ((tipoOperacaoEscriturada === 'ENTRADA' && ehCfopEntrada) ||
        (tipoOperacaoEscriturada === 'SAIDA' && ehCfopSaida)) {
      return cfopXml;
    }

    // 1. Busca equivalencia especifica do cliente
    const eqCliente = await this.database.db.query.cfopEquivalencias.findFirst({
      where: and(
        eq(cfopEquivalencias.clienteId, clienteId),
        eq(cfopEquivalencias.cfopOrigem, cfopXml),
        eq(cfopEquivalencias.ativo, true),
      ),
    });
    if (eqCliente) return eqCliente.cfopDestino;

    // 2. Busca equivalencia global do sistema
    const eqGlobal = await this.database.db.query.cfopEquivalencias.findFirst({
      where: and(
        isNull(cfopEquivalencias.clienteId),
        eq(cfopEquivalencias.cfopOrigem, cfopXml),
        eq(cfopEquivalencias.ativo, true),
      ),
    });
    if (eqGlobal) return eqGlobal.cfopDestino;

    // 3. Fallback Algoritmico SEFAZ (Troca do 1o digito)
    let cfopConvertido = cfopXml;
    if (tipoOperacaoEscriturada === 'ENTRADA' && ehCfopSaida) {
      if (primeiroDigito === '5') cfopConvertido = `1${cfopXml.slice(1)}`;
      else if (primeiroDigito === '6') cfopConvertido = `2${cfopXml.slice(1)}`;
      else if (primeiroDigito === '7') cfopConvertido = `3${cfopXml.slice(1)}`;
    } else if (tipoOperacaoEscriturada === 'SAIDA' && ehCfopEntrada) {
      if (primeiroDigito === '1') cfopConvertido = `5${cfopXml.slice(1)}`;
      else if (primeiroDigito === '2') cfopConvertido = `6${cfopXml.slice(1)}`;
      else if (primeiroDigito === '3') cfopConvertido = `7${cfopXml.slice(1)}`;
    }

    // 4. Valida se o CFOP resultante existe na tabela cfops
    const cfopValido = await this.database.db.query.cfops.findFirst({
      where: eq(cfops.codigo, cfopConvertido),
    });

    return cfopValido ? cfopConvertido : (tipoOperacaoEscriturada === 'ENTRADA' ? '1949' : '5949');
  }
}
```

---

#### 4. INTEGRAÇÃO NOS SERVIÇOS DE INGESTÃO E PARSING DE XML

##### A. Atualização em `dfe-document.parser.ts`
Garantir que a extração do XML capture o atributo `<tpNF>` (em `<ide><tpNF>`) da NF-e/NFC-e ou `<tpCTe>` / `<tpServ>` do CT-e, e inclua no `ParsedDocumentoFiscal`:
```typescript
export interface ParsedDocumentoFiscal {
  // ... campos existentes
  tpNfXml: '0' | '1';
}
```

##### B. Atualização em `DistribuicaoDfeService` e `ImportacaoXmlFiscalService`
Ao persistir o documento fiscal e seus itens no banco:
1. Obter o CNPJ do cliente (`cliente.cnpj`).
2. Calcular `tipoOperacaoEscriturada = cfopService.determinarTipoOperacaoEscriturada(cliente.cnpj, emitenteCnpjCpf, tpNfXml)`.
3. Salvar `documentos_fiscais.tipo_operacao_escriturada`.
4. Para cada item do documento fiscal:
   - `cfopXml = item.cfop` (CFOP original retornado pelo parser XML).
   - `cfopEscriturado = await cfopService.resolverCfopEquivalente({ clienteId, cfopXml, tipoOperacaoEscriturada })`.
   - Inserir em `documentos_fiscais_itens`:
     - `cfopXml`: `cfopXml`
     - `cfop`: `cfopEscriturado`
     - `tipoOperacaoEscriturada`: `tipoOperacaoEscriturada`

---

#### 5. ATUALIZAÇÃO DO `FiscalItensService` (Livros Fiscais e Apuração do ICMS)

Atualizar as consultas do `FiscalItensService` (ex: `getC190`, `getResumoLivros`, `listarItensFiscais`) em `/api/src/fiscal/services/fiscal-itens.service.ts`:

##### A. Apuração Analítica C190 (`getC190`)
Garantir que o agrupamento por CFOP utilize o **CFOP escriturado** e diferencie a apuração por tipo de operação:
```typescript
async getC190(input: ItemFilters) {
  const where = this.buildWhere(input);
  const cst = sql<string>`COALESCE(${documentosFiscaisItens.cstIcms}, ${documentosFiscaisItens.csosnIcms}, '')`;
  const operacao = sql`COALESCE(${documentosFiscaisItens.valorBrutoProduto}, 0) + COALESCE(${documentosFiscaisItens.valorFrete}, 0) + COALESCE(${documentosFiscaisItens.valorSeguro}, 0) + COALESCE(${documentosFiscaisItens.valorOutrasDespesas}, 0) - COALESCE(${documentosFiscaisItens.valorDesconto}, 0)`;

  const rows = await this.database.db
    .select({
      tipo_operacao: documentosFiscaisItens.tipoOperacaoEscriturada,
      cst_icms_csosn: cst,
      cfop: documentosFiscaisItens.cfop, // CFOP escriturado (ex: 1102, 2102)
      cfop_xml: documentosFiscaisItens.cfopXml, // CFOP original do XML (opcional para auditoria)
      aliquota_icms: documentosFiscaisItens.aliquotaIcms,
      vl_opr: sql<string>`COALESCE(SUM(${operacao}), 0)`,
      vl_bc_icms: sql<string>`COALESCE(SUM(${documentosFiscaisItens.valorBcIcms}), 0)`,
      vl_icms: sql<string>`COALESCE(SUM(${documentosFiscaisItens.valorIcms}), 0)`,
      vl_bc_icms_st: sql<string>`COALESCE(SUM(${documentosFiscaisItens.valorBcIcmsSt}), 0)`,
      vl_icms_st: sql<string>`COALESCE(SUM(${documentosFiscaisItens.valorIcmsSt}), 0)`,
      vl_red_bc: sql<string>`COALESCE(SUM(GREATEST(COALESCE(${documentosFiscaisItens.valorBrutoProduto}, 0) - COALESCE(${documentosFiscaisItens.valorDesconto}, 0) - COALESCE(${documentosFiscaisItens.valorBcIcms}, 0), 0)), 0)`,
      vl_ipi: sql<string>`COALESCE(SUM(${documentosFiscaisItens.valorIpi}), 0)`,
    })
    .from(documentosFiscaisItens)
    .innerJoin(
      documentosFiscais,
      eq(documentosFiscais.id, documentosFiscaisItens.documentoFiscalId),
    )
    .where(where)
    .groupBy(
      documentosFiscaisItens.tipoOperacaoEscriturada,
      cst,
      documentosFiscaisItens.cfop,
      documentosFiscaisItens.cfopXml,
      documentosFiscaisItens.aliquotaIcms,
    )
    .orderBy(
      documentosFiscaisItens.tipoOperacaoEscriturada,
      documentosFiscaisItens.cfop,
      documentosFiscaisItens.aliquotaIcms,
    );

  return rows;
}
```

##### B. Resumo dos Livros Fiscais e Apuração do ICMS (`getResumoLivros`)
Substituir a regra anterior por `tipoOperacaoEscriturada`:
```typescript
async getResumoLivros(input: ItemFilters) {
  const where = this.buildWhere(input);

  return this.database.db
    .select({
      tipo_operacao: documentosFiscaisItens.tipoOperacaoEscriturada,
      cfop: documentosFiscaisItens.cfop,
      aliquota_icms: documentosFiscaisItens.aliquotaIcms,
      valor_produtos: sql<string>`COALESCE(SUM(${documentosFiscaisItens.valorBrutoProduto}), 0)`,
      base_icms: sql<string>`COALESCE(SUM(${documentosFiscaisItens.valorBcIcms}), 0)`,
      // Nas ENTRADAS representa CRÉDITO DE ICMS; nas SAÍDAS representa DÉBITO DE ICMS
      icms_creditado_debitado: sql<string>`COALESCE(SUM(${documentosFiscaisItens.valorIcms}), 0)`,
      base_icms_st: sql<string>`COALESCE(SUM(${documentosFiscaisItens.valorBcIcmsSt}), 0)`,
      icms_st: sql<string>`COALESCE(SUM(${documentosFiscaisItens.valorIcmsSt}), 0)`,
      ipi: sql<string>`COALESCE(SUM(${documentosFiscaisItens.valorIpi}), 0)`,
    })
    .from(documentosFiscaisItens)
    .innerJoin(
      documentosFiscais,
      eq(documentosFiscais.id, documentosFiscaisItens.documentoFiscalId),
    )
    .where(where)
    .groupBy(
      documentosFiscaisItens.tipoOperacaoEscriturada,
      documentosFiscaisItens.cfop,
      documentosFiscaisItens.aliquotaIcms,
    )
    .orderBy(documentosFiscaisItens.tipoOperacaoEscriturada, documentosFiscaisItens.cfop);
}
```

---

#### 6. ENDPOINTS REST E CONTROLLERS (`/fiscal/cfops`)

Criar/expandir os controllers fiscais (`admin-fiscal.controller.ts` e `cliente-fiscal.controller.ts`):

##### A. Tabela Canônica de CFOPs (`/fiscal/cfops`)
- `GET /fiscal/cfops`: Listar CFOPs cadastrados com suporte a busca (`q`), `tipoOperacao` (`ENTRADA`/`SAIDA`) e paginação.
- `GET /fiscal/cfops/:codigo`: Detalhes de um CFOP específico.
- `POST /fiscal/cfops` (Admin): Cadastrar novo CFOP.
- `PUT /fiscal/cfops/:codigo` (Admin): Atualizar CFOP.

##### B. Equivalências de CFOP (`/fiscal/cfops/equivalencias`)
- `GET /fiscal/cfops/equivalencias`: Listar regras de equivalência (globais e/ou por cliente).
- `POST /fiscal/cfops/equivalencias`: Criar nova regra de equivalência (Permitir selecionar `clienteId` opcional).
- `PUT /fiscal/cfops/equivalencias/:id`: Editar regra de equivalência.
- `DELETE /fiscal/cfops/equivalencias/:id`: Remover regra de equivalência.

##### C. Reprocessamento da Escrituração Fiscal (`/fiscal/reprocessar-escrituracao`)
- `POST /fiscal/reprocessar-escrituracao`:
  - **Parâmetros**: `clienteId` (obrigatório), `dataInicio`, `dataFim` (opcionais).
  - **Ação**: Recalcula e atualiza `tipoOperacaoEscriturada`, `cfopXml` e `cfop` em todos os documentos e itens do cliente selecionado no período especificado.
  - **Retorno**: `{ documentosProcessados: number, itensAtualizados: number, sucesso: true }`.

---

### 🧪 PLANO DE TESTES E VERIFICAÇÃO

1. **Testes Unitários (`nfe-item.parser.spec.ts`, `cfop.service.spec.ts`)**:
   - Validar que documento de terceiro (`emitente != cliente`) com XML `tpNF = 1` resulta em `tipoOperacaoEscriturada = 'ENTRADA'`.
   - Validar conversão de `5102` para `1102`.
   - Validar conversão de `6102` para `2102`.
   - Validar precedência da tabela `cfop_equivalencias` em relação ao fallback algorítmico.
2. **Testes de Integração com Banco de Dados**:
   - Testar a inserção de itens fiscais via `ImportacaoXmlFiscalService` e `DistribuicaoDfeService`.
   - Verificar se `documentos_fiscais_itens.cfop` guarda o valor convertido e `cfop_xml` guarda o valor original.
3. **Testes do Livro Fiscal e Apuração C190 (`fiscal-itens.service.spec.ts`)**:
   - Verificar se a apuração C190 e o resumo dos livros exibem os CFOPs escriturados de entrada (`1102`, `2102`) para notas de terceiros.
   - Confirmar que o ICMS destacado em notas de compra é contabilizado na coluna de **Créditos de ICMS** (Entradas), enquanto vendas são debitadas (Saídas).
4. **Execução de Build e Linters**:
   - Executar `npm run db:generate`
   - Executar `npm run build`
   - Executar `npm run test`

---

### 📝 CHECKLIST DE ENTREGÁVEIS PARA A OUTRA IA

- [ ] Migration Drizzle gerada em `drizzle/` criando `cfops`, `cfop_equivalencias` e novos campos em `documentos_fiscais` e `documentos_fiscais_itens`.
- [ ] Tabela `schema.ts` atualizada com as novas definições, índices e relações.
- [ ] Script de seed para preenchimento dos CFOPs padrão e equivalências globais.
- [ ] `CfopService` implementado com a matriz de decisão e resolução de equivalência.
- [ ] Parsers XML e serviços de ingestão (`DistribuicaoDfeService`, `ImportacaoXmlFiscalService`) integrando a escrituração inteligente.
- [ ] `FiscalItensService` atualizado para utilizar `tipoOperacaoEscriturada`, garantindo que `getC190` e `getResumoLivros` apresentem os CFOPs convertidos (`1.xxx`/`2.xxx`) e classifiquem o ICMS corretamente como Crédito (Entrada) ou Débito (Saída).
- [ ] Controllers `/fiscal/cfops` e `/fiscal/cfops/equivalencias` implementados com DTOs e validações `class-validator`.
- [ ] Endpoint `/fiscal/reprocessar-escrituracao` funcional.
- [ ] Testes unitários cobrindo todos os cenários de entrada/saída, apuração do ICMS e mapeamento de CFOPs executados com sucesso.
