# Prompt de Implementação — Módulo de Recursos Humanos (RH) · Kontabb

> **Objetivo**: Implementar o módulo de RH no projeto **Kontabb**, permitindo o upload de folhas de pagamento em PDF (geradas por sistemas de folha como o Sênior / Domínio / Alterdata), a extração automática dos dados de cada funcionário e da empresa, o armazenamento estruturado no banco de dados PostgreSQL (via Drizzle ORM) e a futura geração de recibos individuais de salário no frontend Next.js.

---

## 1. Contexto do Projeto

O Kontabb é uma plataforma de gestão contábil SaaS com a seguinte stack:

| Camada | Tecnologia |
|--------|------------|
| **API** | NestJS 11 + TypeScript |
| **ORM** | Drizzle ORM (`drizzle-orm/pg-core`) |
| **Banco** | PostgreSQL via Neon Serverless (`@neondatabase/serverless`) |
| **Storage** | Cloudflare R2 (via AWS SDK) |
| **PDF Parsing** | `unpdf` (já instalado) |
| **Frontend** | Next.js 15 (App Router) |
| **Auth** | Better Auth (sessão por cookie) |

### Estrutura da API (`api/src/`)
```
app.module.ts
auth/              ← Guards, decorators, JWT
clientes/          ← CRUD de clientes (empresas)
common/            ← Logger, PDF extraction, rate-limit, tipos
  pdf-extraction.ts  ← função `extractPdfText(buffer)` existente
database/
  schema.ts        ← Todas as tabelas Drizzle (fonte da verdade)
documentos/        ← Módulo de documentos fiscais existente
storage/           ← Upload/download R2
upload/            ← Controller de upload de documentos fiscais
```

### Padrões já estabelecidos no projeto que DEVEM ser seguidos
- **Tabelas Drizzle**: sempre em `api/src/database/schema.ts`. Usar `pgTable`, `uuid`, `text`, `numeric`, `timestamp`, `date`, `integer`, `jsonb`, `index`, `uniqueIndex`, `check`, `sql`.
- **Serviços**: injetáveis (`@Injectable()`), recebem `DatabaseService`, `StorageService`, `AppLogger` via construtor.
- **Controllers**: agrupados por prefixo (`admin/rh`, `rh`), protegidos por `AuthGuard`, com `@StaffOnly()` para rotas administrativas.
- **PDF extraction**: usar `extractPdfText(buffer: Buffer): Promise<string>` de `../common/pdf-extraction`.
- **Storage keys**: seguir convenção `{cnpj}/{period}/{type}/{uuid}.pdf`.
- **Módulos**: declarar em `app.module.ts` após criar `RhModule`.
- **Rate limit**: usar `RateLimitService.consume()` em uploads.
- **Auditoria**: inserir em `eventos_auditoria` para operações críticas.
- **Nomes em português**: tabelas, colunas e variáveis de domínio em pt-BR (ex.: `folhas_pagamento`, `funcionarios_rh`).

---

## 2. Estrutura dos PDFs de Folha de Pagamento

Foram analisados dois modelos reais de folha de pagamento. Abaixo está a estrutura completa de dados que a API deve extrair.

### 2.1 Cabeçalho da Empresa (por PDF/mês)

| Campo extraído | Exemplo (AMS) | Exemplo (Olympus) |
|----------------|---------------|-------------------|
| Código da empresa | `00012` | `00034` |
| Razão social | `A M S IND E COM DE ARTEF DE PAPEIS LTDA` | `OLYMPUS ATIVIDADES FISICA LTDA` |
| Endereço | `RUA DR SIMOES FILHO, 416` | `RUA SENADOR QUINTINO, 3044 1º ANDAR` |
| CNPJ | `03.198.283/0001-16` | `18.103.272/0001-82` |
| Período (Ref.) | `01/07/2026 a 31/07/2026` | `01/07/2026 a 31/07/2026` |
| Competência (MM/YYYY) | `07/2026` | `07/2026` |
| Departamento | `TODOS` | `TODOS` |
| Página | `00001` | `00001` |

### 2.2 Dados por Funcionário (linhas repetidas)

| Campo | Exemplo (Funcionário 1 - AMS) | Observações |
|-------|-------------------------------|-------------|
| Código do funcionário | `000015` | Identificador interno do sistema de folha |
| Nome completo | `CARLOS AUGUSTO DE SOUZA MATOS` | |
| Referência (horas/dias) | `220:00` | Formato `HHH:MM` ou dias trabalhados |
| Código da folha | `001` | Ex.: `0020000` (folha normal) |
| Data de admissão | `01/10/2025` | Formato `DD/MM/YYYY` |
| Código do livro | `Folha.` | |
| Dependentes IR | `0` | |
| Dependentes SF (Sal. Família) | `0` | |
| Função/Cargo | `MOTORISTA DE CAMINHAO LEVE` | |
| **Salário base** | `2.260,00` | Rubrica 220 - Salário Base |
| **Proventos adicionais** | — | Lista de rubricas com código, descrição e valor |
| **Descontos** | `INSS Folha: 179,08` | Lista de rubricas com código, descrição e valor |
| **Total de proventos** | `2.260,00` | Soma de salário + adicionais |
| **Total de descontos** | `179,08` | Soma de todos os descontos |
| **Salário líquido** | `2.080,92` | Proventos − Descontos |
| Base INSS | `2.260,00` | Com alíquota: `7,9238%` |
| Valor INSS | `180,80` | (FGTS calculado sobre base INSS) |
| Base IRRF | `1.652,80` | Base de cálculo do IR |
| Valor FGTS | `180,80` | Recolhimento FGTS |

#### Exemplos de Rubricas encontradas nos PDFs

**Proventos (Adicionais):**
| Código | Descrição |
|--------|-----------|
| 220 | Salário Base |
| 010 | Biênio 1% |
| 025 | Triênio |
| 030 | Gratificação de Função |
| 420 | Repouso Remunerado |

**Descontos:**
| Código | Descrição |
|--------|-----------|
| 903 | INSS Folha |
| 623 | Desc. Vale Transporte |

### 2.3 Resumo/Totais da Folha (Rodapé)

| Campo | Exemplo (AMS) | Exemplo (Olympus) |
|-------|---------------|-------------------|
| Total Geral da Folha | `6.134,00` | `4.838,38` |
| Total de Descontos | `590,10` | `372,79` |
| Total Líquido | `5.543,90` | `4.465,59` |
| Total de Funcionários | `3` | `3` |
| Total INSS | `479,10` | `372,79` |
| Total FGTS | `490,72` | `387,05` |
| Total IRRF | `0,00` | `0,00` |
| Total Cotas Sal. Família | `0` | `0` |

---

## 3. Modelo de Dados — Novas Tabelas no Schema Drizzle

Adicionar ao arquivo `api/src/database/schema.ts` as seguintes tabelas:

### 3.1 `folhas_pagamento` — Cabeçalho da folha (por upload/mês/empresa)

```typescript
export const folhasPagamento = pgTable(
    'folhas_pagamento',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        clienteId: uuid('cliente_id')
            .notNull()
            .references(() => clientes.id, { onDelete: 'cascade' }),
        // Referência ao registro na tabela documentos (arquivo original no R2)
        documentoId: uuid('documento_id')
            .references(() => documentos.id, { onDelete: 'set null' }),
        competencia: text('competencia').notNull(), // "07/2026"
        periodoInicio: date('periodo_inicio').notNull(), // "2026-07-01"
        periodoFim: date('periodo_fim').notNull(),       // "2026-07-31"
        // Totais do resumo da folha
        totalBruto: numeric('total_bruto', { precision: 12, scale: 2 }).notNull(),
        totalDescontos: numeric('total_descontos', { precision: 12, scale: 2 }).notNull(),
        totalLiquido: numeric('total_liquido', { precision: 12, scale: 2 }).notNull(),
        totalFuncionarios: integer('total_funcionarios').notNull(),
        totalInss: numeric('total_inss', { precision: 12, scale: 2 }).notNull().default('0'),
        totalFgts: numeric('total_fgts', { precision: 12, scale: 2 }).notNull().default('0'),
        totalIrrf: numeric('total_irrf', { precision: 12, scale: 2 }).notNull().default('0'),
        totalSalarioFamilia: numeric('total_salario_familia', { precision: 12, scale: 2 }).notNull().default('0'),
        // Auditoria
        uploadadoPor: text('uploadado_por').references(() => user.id, { onDelete: 'set null' }),
        criadoEm: timestamp('criado_em').notNull().defaultNow(),
        atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
    },
    (table) => [
        // Garante uma única folha por cliente/competência
        uniqueIndex('uidx_folhas_cliente_competencia').on(table.clienteId, table.competencia),
        index('idx_folhas_cliente_id').on(table.clienteId),
        index('idx_folhas_competencia').on(table.competencia),
    ],
);
```

### 3.2 `funcionarios_rh` — Cadastro dos funcionários (deduplificado por empresa)

```typescript
export const funcionariosRh = pgTable(
    'funcionarios_rh',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        clienteId: uuid('cliente_id')
            .notNull()
            .references(() => clientes.id, { onDelete: 'cascade' }),
        codigoFuncionario: text('codigo_funcionario').notNull(), // "000015"
        nomeCompleto: text('nome_completo').notNull(),
        cpf: text('cpf'), // Quando disponível no PDF
        dataAdmissao: date('data_admissao'),
        cargo: text('cargo'),
        departamento: text('departamento'),
        ativo: boolean('ativo').notNull().default(true),
        criadoEm: timestamp('criado_em').notNull().defaultNow(),
        atualizadoEm: timestamp('atualizado_em').notNull().defaultNow(),
    },
    (table) => [
        // Cada funcionário é único por código dentro de uma empresa
        uniqueIndex('uidx_funcionarios_cliente_codigo').on(table.clienteId, table.codigoFuncionario),
        index('idx_funcionarios_cliente_id').on(table.clienteId),
    ],
);
```

### 3.3 `itens_folha_pagamento` — Um registro por funcionário por folha

```typescript
export const itensFolhaPagamento = pgTable(
    'itens_folha_pagamento',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        folhaId: uuid('folha_id')
            .notNull()
            .references(() => folhasPagamento.id, { onDelete: 'cascade' }),
        funcionarioId: uuid('funcionario_id')
            .notNull()
            .references(() => funcionariosRh.id, { onDelete: 'cascade' }),
        clienteId: uuid('cliente_id')
            .notNull()
            .references(() => clientes.id, { onDelete: 'cascade' }),
        // Valores do recibo
        salarioBase: numeric('salario_base', { precision: 12, scale: 2 }).notNull(),
        totalProventos: numeric('total_proventos', { precision: 12, scale: 2 }).notNull(),
        totalDescontos: numeric('total_descontos', { precision: 12, scale: 2 }).notNull(),
        salarioLiquido: numeric('salario_liquido', { precision: 12, scale: 2 }).notNull(),
        // Bases de cálculo
        baseInss: numeric('base_inss', { precision: 12, scale: 2 }),
        aliquotaInss: numeric('aliquota_inss', { precision: 6, scale: 4 }), // ex: 7.9238
        valorInss: numeric('valor_inss', { precision: 12, scale: 2 }),
        baseFgts: numeric('base_fgts', { precision: 12, scale: 2 }),
        valorFgts: numeric('valor_fgts', { precision: 12, scale: 2 }),
        baseIrrf: numeric('base_irrf', { precision: 12, scale: 2 }),
        valorIrrf: numeric('valor_irrf', { precision: 12, scale: 2 }),
        // Referência (horas/dias trabalhados)
        referencia: text('referencia'), // "220:00" ou "13,80"
        codigoFolha: text('codigo_folha'), // ex: "0020000"
        dependentesIr: integer('dependentes_ir').default(0),
        dependentesSf: integer('dependentes_sf').default(0),
        // Rubricas detalhadas (JSON)
        rubricas: jsonb('rubricas')
            .$type<Array<{
                codigo: string;
                descricao: string;
                tipo: 'PROVENTO' | 'DESCONTO';
                valor: number;
            }>>()
            .notNull()
            .default([]),
        criadoEm: timestamp('criado_em').notNull().defaultNow(),
    },
    (table) => [
        // Um funcionário aparece apenas uma vez por folha
        uniqueIndex('uidx_itens_folha_funcionario').on(table.folhaId, table.funcionarioId),
        index('idx_itens_folha_id').on(table.folhaId),
        index('idx_itens_funcionario_id').on(table.funcionarioId),
        index('idx_itens_cliente_id').on(table.clienteId),
    ],
);
```

---

## 4. Lógica de Extração do PDF — `extractDadosFolhaPagamento`

Criar uma nova função exportada em `api/src/common/pdf-extraction-rh.ts`.

### 4.1 Interface de retorno

```typescript
export interface DadosFuncionarioFolha {
  codigoFuncionario: string;
  nomeCompleto: string;
  referencia: string | null;        // "220:00"
  codigoFolha: string | null;       // "0020000"
  dataAdmissao: string | null;      // "DD/MM/YYYY"
  dependentesIr: number;
  dependentesSf: number;
  cargo: string | null;
  salarioBase: number;
  totalProventos: number;
  totalDescontos: number;
  salarioLiquido: number;
  baseInss: number | null;
  aliquotaInss: number | null;      // percentual ex: 7.9238
  valorInss: number | null;
  baseFgts: number | null;
  valorFgts: number | null;
  baseIrrf: number | null;
  valorIrrf: number | null;
  rubricas: Array<{
    codigo: string;
    descricao: string;
    tipo: 'PROVENTO' | 'DESCONTO';
    valor: number;
  }>;
}

export interface DadosFolhaPagamento {
  // Cabeçalho
  cnpj: string;                     // "03.198.283/0001-16"
  razaoSocial: string;
  competencia: string;              // "07/2026"
  periodoInicio: string;            // "2026-07-01" (ISO)
  periodoFim: string;               // "2026-07-31" (ISO)
  // Funcionários
  funcionarios: DadosFuncionarioFolha[];
  // Totais do rodapé
  totalBruto: number;
  totalDescontos: number;
  totalLiquido: number;
  totalFuncionarios: number;
  totalInss: number;
  totalFgts: number;
  totalIrrf: number;
  totalSalarioFamilia: number;
}
```

### 4.2 Estratégia de parsing do texto bruto

O texto extraído pelo `unpdf` é uma string contínua (sem quebras de linha naturais). O parser deve usar regex contextual para segmentar por funcionário e extrair os campos.

#### Etapas do parser

1. **Detectar se é folha de pagamento**: verificar se o texto contém `"FOLHA DE PAGAMENTO"` (obrigatório).

2. **Extrair CNPJ da empresa**: procurar por `CNPJ/CEI:` seguido de 14 dígitos.
   ```
   /CNPJ\/CEI:\s*(\d{14}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/
   ```

3. **Extrair Razão Social**: texto logo após o código da empresa (número de 5 dígitos) e antes de `Empresa :`.
   ```
   /^\d{5}(.+?)Empresa\s*:/
   ```

4. **Extrair período**: procurar por `Ref.:` com datas `DD/MM/YYYY a DD/MM/YYYY`.
   ```
   /Ref\.:\s*\(\s*[^)]*\)\s*(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2})\/(\d{2})\/(\d{4})/
   ```
   - `periodoInicio` = `${ano1}-${mes1}-${dia1}`
   - `periodoFim` = `${ano2}-${mes2}-${dia2}`
   - `competencia` = `${mes1}/${ano1}`

5. **Segmentar funcionários**: o separador entre recibos é `*************** ____/____/______`. Usar este padrão para split dos blocos individuais.

6. **Para cada bloco de funcionário, extrair**:
   - **Código + Nome**: `(\d{6})\s+([A-Z\s]+?)\s+` no início do bloco
   - **Admissão**: `(\d{2}\/\d{2}\/\d{4})Admissão`
   - **Dep IR / Dep SF**: `Dep IR\s*:\s*(\d+).*?Dep SF\s*:\s*(\d+)`
   - **Cargo**: `Função\s*:\s*([A-ZÁÉÍÓÚÃÕÂÊÎÔÛÇÀÈÌÒÙ\w\s.]+?)(?=Salário Base|\d{3}:)`
   - **Rubricas** (proventos): extrair pares `{descrição} {valor} {código}` antes do separador
   - **Totais do funcionário**: três números consecutivos no formato `N.NNN,NN N.NNN,NN N.NNN,NN` após as rubricas
   - **Base INSS + alíquota**: `Base INSS:\s*([\d.,]+)\s*\(Aliq\.:\s*([\d.,]+)%\)`
   - **Valor FGTS**: `Base FGTS:\s*([\d.,]+)\s*\(Valor:\s*([\d.,]+)\)`
   - **Base IRRF**: `Base IRRF Folha:\s*([\d.,]+)`

7. **Extrair totais do rodapé** (seção `Resumo da folha`):
   ```
   /Total Geral da Folha.*?([\d.,]+).*?Total de Descontos.*?([\d.,]+).*?Total Líquido.*?([\d.,]+)/s
   /Total Funcionários.*?(\d+)/
   /Total INSS.*?([\d.,]+)/
   /Total FGTS.*?([\d.,]+)/
   /Total IRRF.*?([\d.,]+)/
   /Total Cotas Sal\. Família.*?(\d+)/
   ```

8. **Converter valores monetários**: função auxiliar `parseBRL(str: string): number`:
   ```typescript
   function parseBRL(str: string): number {
     return parseFloat(str.replace(/\./g, '').replace(',', '.'));
   }
   ```

---

## 5. Novo Módulo NestJS — `RhModule`

### 5.1 Arquivos a criar em `api/src/rh/`

```
api/src/rh/
  rh.module.ts
  rh-upload.controller.ts      ← POST /admin/rh/upload
  rh-admin.controller.ts       ← GET /admin/rh/* (admin/staff)
  rh-cliente.controller.ts     ← GET /rh/* (cliente autenticado)
  rh.service.ts                ← Lógica de negócio
```

### 5.2 `rh.module.ts`

```typescript
@Module({
  imports: [DatabaseModule, StorageModule, CommonModule, ClientesModule],
  controllers: [RhUploadController, RhAdminController, RhClienteController],
  providers: [RhService],
  exports: [RhService],
})
export class RhModule {}
```

Registrar em `app.module.ts`:
```typescript
import { RhModule } from './rh/rh.module';
// ...
imports: [..., RhModule],
```

### 5.3 `rh-upload.controller.ts` — POST `/admin/rh/upload`

**Responsabilidades:**
- Receber até 10 PDFs de folha de pagamento via `multipart/form-data` (campo `files`).
- Para cada arquivo:
  1. Validar assinatura PDF (`hasValidFileSignature`).
  2. Extrair texto com `extractPdfText`.
  3. Chamar `extractDadosFolhaPagamento(text)` — retorna `DadosFolhaPagamento | null`.
  4. Verificar se é uma folha de pagamento válida (se retornou `null`, falhar com mensagem).
  5. Buscar o cliente pelo CNPJ extraído (`ClientesService.findClientForUpload`).
  6. Verificar duplicidade: `folhas_pagamento` com mesmo `clienteId + competencia`.
  7. Fazer upload do PDF original para R2 com key: `rh/{cnpj}/{competencia}/folha-{uuid}.pdf`.
  8. Chamar `RhService.processarFolhaPagamento(dados, clienteId, r2Key, actorUserId)`.
- Retornar resultado por arquivo (sucesso/erro com motivo).

**Body da request:**
```
POST /admin/rh/upload
Content-Type: multipart/form-data
files: File[] (PDF, máx 10, 10MB cada)
```

**Resposta de sucesso:**
```json
{
  "success": true,
  "total": 2,
  "processed": 2,
  "failed": 0,
  "results": [
    {
      "fileName": "FOLHA AMS.pdf",
      "success": true,
      "cnpj": "03.198.283/0001-16",
      "competencia": "07/2026",
      "totalFuncionarios": 3,
      "message": "Folha processada com sucesso."
    }
  ]
}
```

### 5.4 `rh.service.ts` — Método principal

```typescript
async processarFolhaPagamento(input: {
  dados: DadosFolhaPagamento;
  clienteId: string;
  r2Key: string;
  actorUserId: string;
  requestId?: string;
}): Promise<{ ok: boolean; folhaId?: string; code?: string }>
```

**Lógica interna (em uma transação SQL ou sequência ordenada):**

1. **Inserir em `documentos`** com `tipo = 'FOLHA-PAGAMENTO'` (novo tipo), `periodo = competencia`, `arquivoKey = r2Key`, `status = 'PENDENTE'`, `emailStatus = 'SEM_EMAIL'`. Retornar `documentoId`.

2. **Inserir em `folhas_pagamento`** com todos os totais e `documentoId`. Retornar `folhaId`.

3. **Upsert dos funcionários** em `funcionarios_rh`: para cada funcionário no array `dados.funcionarios`:
   - Verificar se já existe pelo `clienteId + codigoFuncionario`.
   - Se existir: atualizar `cargo`, `dataAdmissao`, `nomeCompleto`, `atualizadoEm`.
   - Se não existir: inserir novo.
   - Retornar o `funcionarioId`.

4. **Inserir em `itens_folha_pagamento`**: para cada funcionário, inserir com todos os campos calculados + array de rubricas JSON.

5. **Inserir em `eventos_auditoria`**: `acao = 'FOLHA_PAGAMENTO_UPLOADADA'`, `entidade_tipo = 'FOLHA_PAGAMENTO'`, `entidade_id = folhaId`, `dados = { clienteId, competencia, totalFuncionarios }`.

### 5.5 `rh-admin.controller.ts` — Rotas de Consulta (Admin/Staff)

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/admin/rh/folhas` | Lista todas as folhas (paginado, filtros: clienteId, competencia, search) |
| `GET` | `/admin/rh/folhas/:folhaId` | Detalhe de uma folha + lista de funcionários |
| `GET` | `/admin/rh/folhas/:folhaId/funcionarios` | Funcionários de uma folha com paginação |
| `GET` | `/admin/rh/clientes/:clienteId/folhas` | Folhas de um cliente específico |
| `GET` | `/admin/rh/clientes/:clienteId/funcionarios` | Cadastro de funcionários de um cliente |
| `GET` | `/admin/rh/clientes/:clienteId/resumo` | Resumo agregado por mês/ano |
| `GET` | `/admin/rh/recibo/:itemFolhaId` | Dados completos de um recibo individual |
| `DELETE` | `/admin/rh/folhas/:folhaId` | Excluir folha (cascade para itens) + limpar R2 |

**Query params para `/admin/rh/folhas`:**
- `clienteId` (uuid)
- `competencia` (MM/YYYY)
- `search` (razão social / CNPJ)
- `page` (default: 1)
- `limit` (default: 20, máx: 100)

### 5.6 `rh-cliente.controller.ts` — Rotas do Cliente

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/rh/folhas` | Folhas do cliente autenticado (paginado) |
| `GET` | `/rh/folhas/:folhaId` | Detalhe de uma folha do cliente |
| `GET` | `/rh/folhas/:folhaId/funcionarios` | Funcionários de uma folha |
| `GET` | `/rh/funcionarios` | Todos os funcionários do cliente |
| `GET` | `/rh/funcionarios/:funcionarioId/historico` | Histórico de folhas de um funcionário |
| `GET` | `/rh/resumo` | Resumo anual com totais por competência |
| `GET` | `/rh/recibo/:itemFolhaId` | Dados completos de um recibo individual |

**Segurança**: todas as rotas do cliente devem verificar que o `clienteId` do token corresponde ao cliente dos dados solicitados (mesmo padrão do `DocumentosController` existente).

---

## 6. Endpoint de Dados para o Recibo Individual

O frontend precisará de um endpoint que retorne todos os dados necessários para gerar o recibo de salário de um funcionário. Usar a tabela `clientes` para obter a razão social e endereço da empresa.

**Resposta do endpoint `/rh/recibo/:itemFolhaId`:**
```json
{
  "empresa": {
    "razaoSocial": "A M S IND E COM DE ARTEF DE PAPEIS LTDA",
    "cnpj": "03.198.283/0001-16"
  },
  "competencia": "07/2026",
  "periodoInicio": "2026-07-01",
  "periodoFim": "2026-07-31",
  "funcionario": {
    "codigoFuncionario": "000015",
    "nomeCompleto": "CARLOS AUGUSTO DE SOUZA MATOS",
    "cargo": "MOTORISTA DE CAMINHAO LEVE",
    "dataAdmissao": "2025-10-01",
    "dependentesIr": 0,
    "dependentesSf": 0,
    "referencia": "220:00"
  },
  "valores": {
    "salarioBase": 2260.00,
    "totalProventos": 2260.00,
    "totalDescontos": 179.08,
    "salarioLiquido": 2080.92,
    "baseInss": 2260.00,
    "aliquotaInss": 7.9238,
    "valorInss": 179.08,
    "baseFgts": 2260.00,
    "valorFgts": 180.80,
    "baseIrrf": 1652.80,
    "valorIrrf": 0.00
  },
  "rubricas": [
    { "codigo": "220", "descricao": "Salário Base", "tipo": "PROVENTO", "valor": 2260.00 },
    { "codigo": "903", "descricao": "INSS Folha", "tipo": "DESCONTO", "valor": 179.08 }
  ]
}
```

---

## 7. Endpoint de Resumo Agregado (Dashboard RH)

```
GET /admin/rh/dashboard?clienteId=&ano=2026
GET /rh/dashboard?ano=2026
```

**Resposta:**
```json
{
  "ano": 2026,
  "totalFuncionariosAtivos": 3,
  "resumoPorMes": [
    {
      "competencia": "07/2026",
      "mes": 7,
      "ano": 2026,
      "totalBruto": 6134.00,
      "totalDescontos": 590.10,
      "totalLiquido": 5543.90,
      "totalFuncionarios": 3,
      "totalInss": 479.10,
      "totalFgts": 490.72,
      "totalIrrf": 0.00
    }
  ]
}
```

---

## 8. Alterações no Schema Existente

### 8.1 Adicionar `'FOLHA-PAGAMENTO'` ao tipo de documento

No arquivo `api/src/database/schema.ts`, atualizar o check constraint da tabela `documentos`:

```typescript
// Antes:
sql`${table.tipo} IN ('FGTS', 'DARF', 'DAS', 'DAS-PARCSN', 'DAS-PGFN', 'INSS', 'ISS', 'ICMS', 'PIS', 'COFINS', 'CSLL', 'IRPJ', 'DAE', 'PGFN-SISPAR', 'TAXA-ASSISTENCIAL', 'OUTROS')`

// Depois:
sql`${table.tipo} IN ('FGTS', 'DARF', 'DAS', 'DAS-PARCSN', 'DAS-PGFN', 'INSS', 'ISS', 'ICMS', 'PIS', 'COFINS', 'CSLL', 'IRPJ', 'DAE', 'PGFN-SISPAR', 'TAXA-ASSISTENCIAL', 'OUTROS', 'FOLHA-PAGAMENTO')`
```

> **Importante**: Isso requer uma migration SQL no banco de dados. Ver seção 9.

---

## 9. Migrations SQL

Como o projeto usa Drizzle ORM com Neon Serverless, após atualizar o schema, executar:

```bash
# Na pasta da API
pnpm drizzle-kit generate    # Gera o arquivo de migração em drizzle/
pnpm drizzle-kit migrate     # Aplica no banco de dados
```

As migrations devem criar/alterar:
1. `ALTER TABLE documentos DROP CONSTRAINT chk_documentos_tipo; ALTER TABLE documentos ADD CONSTRAINT chk_documentos_tipo CHECK (tipo IN (..., 'FOLHA-PAGAMENTO'));`
2. `CREATE TABLE folhas_pagamento (...)`
3. `CREATE TABLE funcionarios_rh (...)`
4. `CREATE TABLE itens_folha_pagamento (...)`
5. Todos os índices e unique constraints conforme o schema definido.

---

## 10. Testes de Parsing (obrigatórios)

Criar `api/src/rh/rh-extraction.spec.ts` com testes unitários:

```typescript
import { extractDadosFolhaPagamento } from '../common/pdf-extraction-rh';

// Fixtures — texto bruto real extraído dos PDFs pelo unpdf
const textoAMS = `00012A M S IND E COM DE ARTEF DE PAPEIS LTDAEmpresa : End. : Ref.: ( RUA DR SIMOES FILHO, 416 ) 01/07/2026 31/07/2026a Dpto : Página : 00001 Código Nome Ref. Sal. Contratual Adicionais Descontos Líquido TODOS Recibo FOLHA DE PAGAMENTO 03198283000116CNPJ/CEI: 000015 CARLOS AUGUSTO DE SOUZA MATOS 2.260,00 0020000 01/10/2025Admissão : Folha. :Livro: Dep IR : Dep SF :0 0 Função : MOTORISTA DE CAMINHAO LEVE Salário Base 2.260,00220:00001 INSS Folha 179,08903 *************** ____/____/______ 2.260,00 179,08 2.080,92 Base INSS: 2.260,00 (Aliq.: 7,9238%) Base FGTS: 2.260,00 (Valor: 180,80) Base IRRF Folha: 1.652,80 000014 JOICE BISPO DOS SANTOS 1.850,00 0110001 01/09/2025Admissão : Folha. :Livro: Dep IR : Dep SF :0 0 Função : Promotor de vendas Salário Base 1.850,00220:00001 Desc. Vale Transporte 111,00623 INSS Folha 142,18903 *************** ____/____/______ 1.850,00 253,18 1.596,82 Base INSS: 1.850,00 (Aliq.: 7,6854%) Base FGTS: 1.850,00 (Valor: 148,00) Base IRRF Folha: 1.242,80 000006 PABLO GEORGE CARDOSO CAMPOS BORGES 1.760,00 0220001 01/12/2014Admissão : Folha. :Livro: Dep IR : Dep SF :1 1 Função : AUXILIAR DE CONTABILIDADE Salário Base 1.760,00220:00001 Triênio 264,00025 INSS Folha 157,84903 *************** ____/____/______ 2.024,00 157,84 1.866,16 Base INSS: 2.024,00 (Aliq.: 7,7984%) Base FGTS: 2.024,00 (Valor: 161,92) Base IRRF Folha: 1.416,80 ********************* ********************* Resumo da folha Total Geral da Folha ( - ) Total de Descontos ( = ) Total Líquido ********************* Informações adicionais Total Funcionários Total INSS Total FGTS Total IRRF 6.134,00 Total Cotas Sal. Família 590,10 5.543,90 3 0 479,10 490,72 0,00`;

const textoOlympus = `00034OLYMPUS ATIVIDADES FISICA LTDAEmpresa : End. : Ref.: ( RUA SENADOR QUINTINO, 3044 1º ANDAR ) 01/07/2026 31/07/2026a Dpto : Página : 00001 Código Nome Ref. Sal. Contratual Adicionais Descontos Líquido TODOS Recibo FOLHA DE PAGAMENTO 18103272000182CNPJ/CEI: 000001 CLAUDIA TRAJANO DA SILVA CAMPOS 13,80 0020001 25/10/2013Admissão : Folha. :Livro: Dep IR : Dep SF :1 1 Função : COORDENADOR TÉCNICO Salário Base 1.683,60122:00002 Biênio 1% 101,02010 Gratificação de Função 168,36030 Repouso Remunerado 325,50420 INSS Folha 180,74903 *************** ____/____/______ 2.278,48 180,74 2.097,74 Base INSS: 2.278,48 (Aliq.: 7,9324%) Base FGTS: 2.278,48 (Valor: 182,27) Base IRRF Folha: 1.671,28 000018 JAILTON OLIVEIRA ALVES JUNIOR 13,80 0180001 09/05/2024Admissão : Folha. :Livro: Dep IR : Dep SF :0 0 Função : INST.DE MUSCULAÇÃO Salário Base 800,40058:00002 Repouso Remunerado 133,40420 INSS Folha 70,03903 *************** ____/____/______ 933,80 70,03 863,77 Base INSS: 933,80 (Aliq.: 7,5%) Base FGTS: 933,80 (Valor: 74,70) Base IRRF Folha: 326,60 000017 VALNEI DA CRUZ VALADAO 13,80 0170001 18/03/2024Admissão : Folha. :Livro: Dep IR : Dep SF :0 0 Função : INST.DE MUSCULAÇÃO Salário Base 1.393,80101:00002 Repouso Remunerado 232,30420 INSS Folha 122,02903 *************** ____/____/______ 1.626,10 122,02 1.504,08 Base INSS: 1.626,10 (Aliq.: 7,5038%) Base FGTS: 1.626,10 (Valor: 130,08) Base IRRF Folha: 1.018,90 ********************* ********************* Resumo da folha Total Geral da Folha ( - ) Total de Descontos ( = ) Total Líquido ********************* Informações adicionais Total Funcionários Total INSS Total FGTS Total IRRF 4.838,38 Total Cotas Sal. Família 372,79 4.465,59 3 0 372,79 387,05 0,00`;

describe('extractDadosFolhaPagamento', () => {
  it('deve extrair corretamente a folha AMS', () => {
    const result = extractDadosFolhaPagamento(textoAMS);
    expect(result).not.toBeNull();
    expect(result!.cnpj).toBe('03.198.283/0001-16');
    expect(result!.competencia).toBe('07/2026');
    expect(result!.funcionarios).toHaveLength(3);
    expect(result!.totalBruto).toBeCloseTo(6134.00, 2);
    expect(result!.totalDescontos).toBeCloseTo(590.10, 2);
    expect(result!.totalLiquido).toBeCloseTo(5543.90, 2);
    expect(result!.totalFuncionarios).toBe(3);
    expect(result!.totalInss).toBeCloseTo(479.10, 2);
    expect(result!.totalFgts).toBeCloseTo(490.72, 2);
    // Verificar primeiro funcionário
    const carlos = result!.funcionarios.find(f => f.codigoFuncionario === '000015');
    expect(carlos).toBeDefined();
    expect(carlos!.nomeCompleto).toBe('CARLOS AUGUSTO DE SOUZA MATOS');
    expect(carlos!.cargo).toContain('MOTORISTA');
    expect(carlos!.salarioBase).toBeCloseTo(2260.00, 2);
    expect(carlos!.salarioLiquido).toBeCloseTo(2080.92, 2);
    expect(carlos!.valorFgts).toBeCloseTo(180.80, 2);
    expect(carlos!.baseInss).toBeCloseTo(2260.00, 2);
    expect(carlos!.aliquotaInss).toBeCloseTo(7.9238, 4);
  });

  it('deve extrair corretamente a folha Olympus com múltiplas rubricas de provento', () => {
    const result = extractDadosFolhaPagamento(textoOlympus);
    expect(result).not.toBeNull();
    expect(result!.cnpj).toBe('18.103.272/0001-82');
    expect(result!.funcionarios).toHaveLength(3);
    expect(result!.totalBruto).toBeCloseTo(4838.38, 2);
    const claudia = result!.funcionarios.find(f => f.codigoFuncionario === '000001');
    expect(claudia).toBeDefined();
    expect(claudia!.rubricas.find(r => r.descricao.toLowerCase().includes('biênio'))).toBeDefined();
    expect(claudia!.rubricas.find(r => r.descricao.toLowerCase().includes('gratificação'))).toBeDefined();
    expect(claudia!.rubricas.find(r => r.tipo === 'DESCONTO')).toBeDefined();
  });

  it('deve retornar null para texto não relacionado a folha de pagamento', () => {
    expect(extractDadosFolhaPagamento('Guia de FGTS Digital Simples Nacional')).toBeNull();
  });

  it('deve calcular competencia corretamente a partir do período', () => {
    const result = extractDadosFolhaPagamento(textoAMS);
    expect(result!.periodoInicio).toBe('2026-07-01');
    expect(result!.periodoFim).toBe('2026-07-31');
    expect(result!.competencia).toBe('07/2026');
  });
});
```

---

## 11. Observações Críticas de Parsing

### Peculiaridades do texto extraído pelo `unpdf`

1. **Sem quebras de linha**: o texto é contínuo. Todo parsing deve usar regex sem `^` ou `$` de linha.

2. **CNPJ sem formatação no corpo**: o CNPJ aparece como `03198283000116` (14 dígitos sem pontuação) logo após `CNPJ/CEI:`. Formatar na extração usando `\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}`.

3. **Referência variável**: pode ser `220:00` (horas:minutos) ou `13,80` (dias), dependendo do tipo de funcionário/contrato.

4. **Rubricas inline**: cada rubrica aparece no formato `{descrição} {valor},{centavos}{código_rubrica}`. Ex.: `Salário Base 2.260,00220:00001` mistura o valor `2.260,00` com o código `220` e referência `:00001`.

5. **Separador de funcionários**: a string `*************** ____/____/______` marca o fim de cada recibo individual. Usar como delimitador para split.

6. **Totais do rodapé em ordem não óbvia**: no texto bruto da AMS: `6.134,00 Total Cotas Sal. Família 590,10 5.543,90 3 0 479,10 490,72 0,00` — a sequência real é: totalBruto, "Total Cotas Sal. Família", totalDescontos, totalLiquido, totalFuncionarios, totalSalFamilia, totalINSS, totalFGTS, totalIRRF. Usar regex contextual ao invés de posicional.

7. **Alíquota INSS com vírgula**: aparece como `7,9238%`, deve ser convertida para float `7.9238` (substituir `,` por `.`).

8. **Classificação de rubricas**: usar o código numérico para classificar:
   - Código `< 900` → `PROVENTO`
   - Código `>= 900` → `DESCONTO`
   - Casos conhecidos: `903` = INSS (DESCONTO), `623` = Vale Transporte (DESCONTO), `220` = Salário Base (PROVENTO), `420` = Repouso Remunerado (PROVENTO).

9. **Razão Social com espaçamento**: pode aparecer com espaços entre letras como `A M S IND E COM...`. Preservar exatamente como está no PDF.

10. **Referência da Olympus**: `13,80` (dias trabalhados, formato diferente de AMS que usa `220:00`).

---

## 12. Checklist de Implementação

### Fase 1 — Schema e Extraction (Backend)
- [ ] Adicionar `'FOLHA-PAGAMENTO'` ao check constraint em `schema.ts`
- [ ] Criar tabela `folhas_pagamento` em `schema.ts`
- [ ] Criar tabela `funcionarios_rh` em `schema.ts`
- [ ] Criar tabela `itens_folha_pagamento` em `schema.ts`
- [ ] Criar `api/src/common/pdf-extraction-rh.ts` com `extractDadosFolhaPagamento`
- [ ] Criar testes unitários `api/src/rh/rh-extraction.spec.ts`
- [ ] Executar `pnpm drizzle-kit generate && pnpm drizzle-kit migrate`

### Fase 2 — Módulo RH (Backend)
- [ ] Criar `api/src/rh/rh.module.ts`
- [ ] Criar `api/src/rh/rh.service.ts` com `processarFolhaPagamento`
- [ ] Criar `api/src/rh/rh-upload.controller.ts` (POST `/admin/rh/upload`)
- [ ] Criar `api/src/rh/rh-admin.controller.ts` (rotas GET/DELETE admin)
- [ ] Criar `api/src/rh/rh-cliente.controller.ts` (rotas GET cliente)
- [ ] Registrar `RhModule` em `app.module.ts`
- [ ] Testar upload dos PDFs reais e verificar dados no banco

### Fase 3 — Frontend (Escopo Futuro)
> *Não faz parte desta implementação inicial.*
- [ ] Página `/admin/rh` — lista de folhas com filtros
- [ ] Componente `<RhUploadDropzone />` integrado ao endpoint `/admin/rh/upload`
- [ ] Página `/admin/rh/[folhaId]` — detalhe da folha com lista de funcionários
- [ ] Geração de PDF do recibo individual usando biblioteca a definir (`@react-pdf/renderer` ou `jsPDF`)
- [ ] Área do cliente: `/dashboard/rh` — visualização de folhas e download de recibos

---

## 13. Restrições e Boas Práticas

1. **Não modificar** arquivos fora de `api/src/rh/`, `api/src/common/`, `api/src/database/schema.ts` e `api/src/app.module.ts`.
2. **Seguir exatamente** a estrutura de outros módulos existentes (`documentos/`, `clientes/`) como referência de estilo e padrões.
3. **Não usar `any`** — tipar todos os retornos e parâmetros com interfaces explícitas.
4. **Tratar erros** com `try/catch` e retornar `{ ok: false, code: 'CODIGO_ERRO' }` ao invés de lançar exceções não tratadas.
5. **Rate limit** no endpoint de upload: 10 uploads por minuto por usuário (via `RateLimitService`).
6. **Validar autenticidade**: verificar que o PDF é uma folha de pagamento antes de processar (presença de `"FOLHA DE PAGAMENTO"` e `"CNPJ/CEI:"`).
7. **Upsert de funcionários**: nunca duplicar — identificar pelo par `(clienteId, codigoFuncionario)`.
8. **Idempotência**: se a mesma folha (mesmo cliente + competência) for enviada novamente, retornar `{ ok: false, code: 'FOLHA_DUPLICADA' }`.
9. **Storage cleanup**: ao deletar uma `folha_pagamento`, usar o padrão `storage_cleanup_jobs` existente para remover o arquivo R2.
10. **Documentar com Swagger**: usar `@ApiOperation`, `@ApiResponse`, `@ApiTags`, `@ApiBearerAuth` em todos os endpoints.
