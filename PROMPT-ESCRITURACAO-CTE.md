# Prompt de Implementação — Escrituração Fiscal Correta de CT-e (Conhecimento de Transporte Eletrônico)

> **Objetivo deste documento:** servir como especificação executável para uma IA de codificação implementar, no backend NestJS + Drizzle + PostgreSQL deste projeto (`api/`), a escrituração fiscal correta dos CT-e (modelo 57), de forma que **somente os conhecimentos efetivamente pagos/contratados pelo cliente (tomador do serviço) sejam escriturados** e componham as obrigações acessórias — em especial o **SPED Fiscal (EFD ICMS/IPI)**.
>
> O prompt foi escrito a partir da revisão do código atual. Leia integralmente antes de codificar. Não altere comportamento de NF-e/NFC-e além do estritamente necessário para acomodar o Bloco D.

---

## 1. Contexto atual do sistema (estado revisado)

O módulo fiscal vive em `api/src/fiscal`. Os pontos relevantes já existentes:

- **Parsing de documentos** — `src/fiscal/services/dfe-document.parser.ts`
  - `parseFiscalXml(...)` reconhece `nfeProc` (55/65) e `cteProc` (57).
  - **Limitação central 1:** para CT-e, os itens **não são extraídos**:
    ```ts
    itens: tipoConsulta === 'NFE' ? parseNfeItems(xml) : [],
    ```
    Ou seja, um CT-e é hoje persistido apenas como **cabeçalho** em `documentos_fiscais`, sem nenhuma linha em `documentos_fiscais_itens`. Consequência: o CT-e **não aparece** em nenhum relatório de apuração (C190, apuração ICMS, resumo de livros, produtos 0200), nem gera crédito/débito de ICMS.
  - **Limitação central 2:** o sentido fiscal do CT-e é normalizado como saída (`tpNfXml = '1'`) e a direção final é decidida apenas por `emitente === cliente`. Como o emitente do CT-e é sempre a transportadora, o CT-e do cliente sempre cai em `ENTRADA`, **sem verificar se o cliente é o tomador (pagador) do serviço**.

- **Determinação de operação e CFOP** — `src/fiscal/services/cfop.service.ts`
  - `determinarTipoOperacaoEscriturada(clienteCnpjCpf, emitenteCnpjCpf, tpNfXml)` só compara emitente × cliente.
  - `prepararItensEscrituracao(...)` resolve CFOP equivalente por item (usado hoje só por NF-e, pois CT-e não tem itens).

- **Escrituração/persistência** — `src/fiscal/services/importacao-xml-fiscal.service.ts` e `src/fiscal/services/escrituracao-fiscal.service.ts`
  - `persistirDocumento(...)` grava cabeçalho + itens; para CT-e a lista de itens vem vazia.
  - `escrituracao-fiscal.service.ts::reprocessar(...)` pula o parse de CT-e (`documento.modelo === '57'` retorna `null` em `parseStoredDocumentIfNeeded`).

- **DACTE (parser já existente e reutilizável)** — `src/fiscal/services/dacte.parser.ts`
  - **Já resolve o tomador** via `readTomador(infCte, ide)` usando `toma3`/`toma4`. Já extrai `vPrest` (valor total da prestação, `vTPrest`, e `vRec`), componentes, e `imp/ICMS` (CST/CSOSN, vBC, pICMS, vICMS, vTotTrib). Reaproveite essa lógica de extração; não reinvente o parsing do CT-e.

- **Relatórios SPED (Bloco C hoje)** — `src/fiscal/services/fiscal-itens.service.ts`
  - `getC190`, `getResumoLivros`, `getApuracaoIcms`, `getProdutos0200` operam **exclusivamente** sobre `documentos_fiscais_itens` (produtos). Não há qualquer suporte a **Bloco D** (serviço de transporte).

- **Schema** — `src/database/schema.ts`
  - `documentosFiscais`: cabeçalho (inclui `tipoOperacaoEscriturada`, `situacao`, `manifestacaoStatus`, `tpNfXml`).
  - `documentosFiscaisItens`: linha fiscal de produto (NF-e/NFC-e). Muitos campos de ICMS/IPI/PIS/COFINS.
  - `cfops` e `cfopEquivalencias`: catálogo e equivalências de CFOP.

- **Migrations** — pasta `api/drizzle` (Drizzle Kit). Config em `api/drizzle.config.ts`. Toda mudança de schema exige **nova migration SQL** + atualização do snapshot.

---

## 2. Regra de negócio central (o que o cliente pediu)

**Escriturar um CT-e somente quando o cliente da plataforma for o TOMADOR do serviço de transporte** — isto é, a parte que **contrata e paga** o frete e, portanto, é quem tem o fato contábil/fiscal (crédito de ICMS sobre o frete e obrigação de registrar no SPED).

### 2.1. Como identificar o tomador no XML do CT-e

O tomador é definido no grupo `ide` do CT-e:

- **`toma3/toma`** — código que aponta para um participante já declarado:
  | Código | Tomador |
  |--------|---------|
  | `0` | Remetente (`rem`) |
  | `1` | Expedidor (`exped`) |
  | `2` | Recebedor (`receb`) |
  | `3` | Destinatário (`dest`) |
- **`toma4`** — tomador é um terceiro, com CNPJ/CPF próprio dentro de `toma4` (grupo `enderToma`).

O sistema deve resolver o **CNPJ/CPF do tomador** e comparar com o CNPJ/CPF do cliente (normalizado, só dígitos). A lógica de `dacte.parser.ts::readTomador` já faz essa resolução — extraia o documento do tomador reaproveitando-a.

### 2.2. Decisão de escrituração

Para cada cliente cadastrado que participa do CT-e:

1. Resolver `tomadorCnpjCpf` a partir de `toma3/toma4`.
2. Se `normalize(tomadorCnpjCpf) === normalize(cliente.cnpj)` → **CT-e ESCRITURÁVEL** para esse cliente (tipo de operação = `ENTRADA`, aquisição de serviço de transporte, gerando crédito de ICMS quando permitido).
3. Caso contrário (o cliente é apenas remetente/destinatário/etc. mas **não** o tomador) → **NÃO escriturar** o CT-e para esse cliente. O documento pode continuar **armazenado** (visível, com XML/DACTE disponível), porém **marcado como não escriturável / fora de apuração**, e **excluído** de C190, apuração ICMS, resumo de livros e do Bloco D do SPED.

> **Importante:** "armazenar" ≠ "escriturar". O CT-e não-tomado pode ser mantido para consulta/rastreabilidade, mas nunca deve gerar fato fiscal nem entrar nas obrigações.

### 2.3. Casos especiais que também NÃO escrituram (ou escrituram de forma diferenciada)

- **CT-e cancelado / denegado** (`situacao` diferente de `AUTORIZADA`): não escriturar valores; manter registro conforme regra do SPED (documento cancelado entra como registro D100 com `COD_SIT` apropriado, ver §5.3).
- **CT-e de anulação (`tpCTe = 2`) e complementar (`tpCTe = 1`)**: exigem tratamento específico de escrituração (o complementar soma valores; a anulação estorna). Ver §5.4.
- **CT-e do tipo `tpCTe = 3` (substituto)**: substitui um CT-e anterior; escriturar o substituto e desconsiderar o substituído.
- **Subcontratação/redespacho (`tpServ` 1/2/3)**: o crédito de ICMS pode não ser do tomador aparente. Sinalizar para revisão manual (`revisao_necessaria = true`) e **não** creditar automaticamente.
- **Simples Nacional**: cliente optante pelo Simples **não credita ICMS** sobre o frete. O CT-e é escriturado apenas para conferência/inventário de operações, com débito/crédito zerados — reaproveite o padrão já existente em `fiscal-itens.service.ts` (`simplesNacionalSemApuracaoIcms`).

---

## 3. Alinhamento com o SPED Fiscal (EFD ICMS/IPI) — Bloco D

CT-e é documento de **serviço de transporte** e deve ser escriturado no **Bloco D** (não no Bloco C, que é de mercadorias). Referência normativa: Guia Prático da EFD ICMS/IPI (ATO COTEPE/ICMS) e leiaute vigente. **Confirme a versão do leiaute vigente para o período** antes de gerar registros definitivos.

Registros do Bloco D relevantes para CT-e modelo 57 (aquisição de serviço de transporte pelo tomador):

- **D001** — Abertura do Bloco D.
- **D100** — Nota Fiscal de Serviço de Transporte / CT-e (modelo 57). Campos-chave:
  - `IND_OPER` (0 = aquisição/entrada — caso do tomador), `IND_EMIT` (1 = terceiros), `COD_PART` (participante = transportadora emitente), `COD_MOD` (`57`), `COD_SIT` (00 = regular, 02/03 = cancelado, etc.), `SER`, `SUB`, `NUM_DOC`, `CHV_CTE` (chave 44 dígitos), `DT_DOC`, `DT_A_P`, `VL_DOC`, `VL_DESC`, `IND_FRT`, `VL_SERV`, `VL_BC_ICMS`, `VL_ICMS`, `VL_NT` (não tributado), `COD_INF`, `COD_CTA`, `COD_MUN_ORIG`, `COD_MUN_DEST`.
- **D190** — Registro analítico dos documentos (por CST/CFOP/alíquota): `CST_ICMS`, `CFOP`, `ALIQ_ICMS`, `VL_OPR`, `VL_BC_ICMS`, `VL_ICMS`, `VL_RED_BC`, `COD_OBS`. É o análogo ao C190, porém do Bloco D.
- **D101 / D110 / D130 / D150 / D190** — conforme modal e detalhamento (avaliar necessidade por caso; para o MVP, foco em D100 + D190).
- **D990** — Encerramento do Bloco D (contador de linhas).

> **Crédito de ICMS sobre frete:** o tomador contribuinte do ICMS (regime normal) pode creditar-se do ICMS destacado no CT-e quando o frete estiver vinculado a operação tributada e a legislação permitir. O CFOP de entrada típico é **1352/2352/3352** (aquisição de serviço de transporte por industrial), **1353/2353** (comércio), **1356/2356**, entre outros conforme atividade e finalidade. A escrituração deve resolver o CFOP de entrada equivalente (reaproveitar `CfopService`).

---

## 4. Modelagem de dados

### 4.1. Onde escriturar o CT-e

Há duas abordagens. **Escolha a Abordagem A** salvo justificativa técnica forte, pois é a de menor risco e melhor isolamento fiscal:

**Abordagem A (recomendada) — tabela dedicada `documentos_fiscais_cte_escrituracao`.**
Uma linha por CT-e escriturável (o CT-e não tem "itens" no sentido de produto). Vantagens: não polui `documentos_fiscais_itens` (que é modelada para produto/NF-e) e evita `NULL`s em dezenas de colunas de produto. Estrutura sugerida (ajuste tipos conforme `schema.ts`):

```
documentos_fiscais_cte_escrituracao
- id (uuid, pk)
- documento_fiscal_id (uuid, fk -> documentos_fiscais.id, on delete cascade)
- cliente_id (uuid, fk -> clientes.id)
- escrituravel (boolean)                 -- resultado da regra do tomador
- motivo_nao_escrituravel (text, null)   -- ex.: 'CLIENTE_NAO_E_TOMADOR', 'CANCELADO', 'SIMPLES_SEM_CREDITO'
- tomador_cnpj_cpf (text)                -- documento do tomador resolvido
- tomador_papel (text)                   -- 'REMETENTE'|'EXPEDIDOR'|'RECEBEDOR'|'DESTINATARIO'|'TERCEIRO'
- tipo_operacao_escriturada (varchar 10) -- normalmente 'ENTRADA'
- tp_cte (varchar 1)                     -- 0 normal, 1 complementar, 2 anulacao, 3 substituto
- tp_serv (varchar 1)
- modal (varchar 2)
- cfop_xml (varchar 4)                    -- CFOP original do ide/CFOP
- cfop (varchar 4)                        -- CFOP escriturado (entrada equivalente)
- cfop_revisao_necessaria (boolean)
- cst_icms (varchar 3, null)
- csosn_icms (varchar 4, null)
- valor_total_servico (numeric 15,2)     -- vTPrest
- valor_receber (numeric 15,2)           -- vRec
- valor_bc_icms (numeric 15,2, null)
- aliquota_icms (numeric 7,4, null)
- valor_icms (numeric 15,2, null)
- valor_icms_creditavel (numeric 15,2)   -- 0 quando Simples ou crédito vedado
- valor_total_tributos (numeric 15,2, null)
- chave_cte_referenciado (text, null)    -- para complementar/anulacao/substituto
- criado_em / atualizado_em (timestamp)
```
Restrições: `unique(documento_fiscal_id)`, checks de coerência (`escrituravel = false` ⇒ `motivo_nao_escrituravel is not null`), CFOP no padrão `^[123567][0-9]{3}$`, `tp_cte in ('0','1','2','3')`.

**Abordagem B (alternativa) — reutilizar `documentos_fiscais_itens`** com uma única linha "sintética" por CT-e (numeroItem = 1, produto = "SERVIÇO DE TRANSPORTE"). Só adote se houver forte necessidade de unificar relatórios; nesse caso adicione uma coluna discriminadora (`natureza_item`: `PRODUTO` | `SERVICO_TRANSPORTE`) e ajuste **todos** os agregadores para separar Bloco C de Bloco D.

### 4.2. Marcações no cabeçalho `documentos_fiscais`

Adicionar (via migration) uma flag de escrituração no cabeçalho para facilitar filtros e evitar reprocessos:
- `escriturado` (boolean, default false) — indica se o documento entrou na escrituração.
- Opcional: `escrituracao_status` (`ESCRITURADO` | `NAO_ESCRITURAVEL` | `PENDENTE_REVISAO`).

> Toda alteração de `schema.ts` **exige**: (1) nova migration em `api/drizzle/NNNN_*.sql`; (2) atualização de `api/drizzle/meta/_journal.json` e do snapshot; (3) `pnpm drizzle-kit generate` conforme o fluxo do projeto. Nunca edite o banco manualmente sem migration versionada.

---

## 5. Especificação funcional a implementar

### 5.1. Extração dos dados fiscais do CT-e (parser)

Criar um extrator dedicado (ex.: `src/fiscal/services/cte-escrituracao.parser.ts`) ou estender `dfe-document.parser.ts` para produzir, além do cabeçalho já existente, um objeto de escrituração de CT-e com:

- `tomadorCnpjCpf` e `tomadorPapel` (resolvidos via `toma3`/`toma4` — reaproveite `dacte.parser.ts::readTomador`).
- `tpCTe`, `tpServ`, `modal`, `CFOP` do `ide`.
- `vPrest.vTPrest`, `vPrest.vRec`.
- Grupo `imp/ICMS`: `CST`/`CSOSN`, `vBC`, `pICMS`, `vICMS`, `vTotTrib`.
- Chave do CT-e referenciado quando `tpCTe` ∈ {1,2,3} (grupos `infCteComp`/`infCteAnu`/`infDoc`/`infCTeSub` conforme leiaute) — para vincular complementos/anulações/substitutos.

**Regras de robustez (seguir o padrão atual do parser):** limites de tamanho, rejeição de DTD/ENTITY, validação da chave de 44 dígitos com dígito verificador, aceitar somente `cteProc` modelo 57 (descartar CT-e OS, GTV-e, eventos e resumos).

### 5.2. Motor de decisão de escrituração

Criar um serviço (ex.: `CteEscrituracaoService`) com um método puro e testável, por exemplo:

```ts
decidirEscrituracaoCte(input: {
  clienteCnpjCpf: string;
  regimeTributario: RegimeTributario | null;
  apuraIcms: boolean;
  tomadorCnpjCpf: string;
  situacao: 'AUTORIZADA' | 'CANCELADA' | 'DENEGADA' | 'RESUMIDA';
  tpCTe: string;   // 0|1|2|3
  tpServ: string;  // 0..4
  cstIcms: string | null;
  csosnIcms: string | null;
}): {
  escrituravel: boolean;
  motivoNaoEscrituravel: string | null;
  tipoOperacao: 'ENTRADA';
  creditaIcms: boolean;          // false p/ Simples, frete vedado, subcontratação
  revisaoNecessaria: boolean;    // true p/ tpServ 1/2/3 e casos ambíguos
}
```

Regras (ordem de avaliação):
1. `situacao !== 'AUTORIZADA'` → escriturável conforme regra de documento cancelado/denegado do SPED (não gerar crédito; registrar com `COD_SIT` apropriado). Marcar `creditaIcms = false`.
2. `normalize(tomadorCnpjCpf) !== normalize(clienteCnpjCpf)` → `escrituravel = false`, `motivo = 'CLIENTE_NAO_E_TOMADOR'`. **Fim.**
3. Cliente é tomador → `escrituravel = true`, `tipoOperacao = 'ENTRADA'`.
4. `regimeTributario === 'SIMPLES_NACIONAL'` (usar `simplesNacionalSemApuracaoIcms`) → `creditaIcms = false`.
5. `tpServ ∈ {1,2,3}` (subcontratação/redespacho) → `revisaoNecessaria = true`, `creditaIcms = false` (aguardar validação humana).
6. `tpCTe` complementar/anulação/substituto → aplicar §5.4.
7. Caso normal e regime que credita: `creditaIcms = (cstIcms permite crédito)` — reaproveitar o critério `cstIcms IN ('00','10','20','70')` já usado em `fiscal-itens.service.ts`.

### 5.3. Resolução de CFOP de entrada

- Usar `CfopService.resolverCfopEquivalenteDetalhado({ clienteId, cfopXml, tipoOperacaoEscriturada: 'ENTRADA' })` para converter o CFOP do CT-e (que vem como saída na ótica da transportadora) no **CFOP de entrada de serviço de transporte** do tomador. Se o resultado cair no fallback, marcar `cfop_revisao_necessaria = true`.
- Garantir que os CFOPs de transporte relevantes existam no catálogo `cfops` (seed/migration): 1352/2352/3352, 1353/2353, 1356/2356, 1360/2360, 1949/2949/3949 (fallback), e seus equivalentes de saída para o mecanismo de conversão. **Confirme a lista aplicável** ao seed atual.

### 5.4. Complementar, anulação e substituto

- **Complementar (`tpCTe=1`)**: escritura como documento adicional que **soma** valores de serviço/ICMS ao CT-e original referenciado. Vincular via `chave_cte_referenciado`.
- **Anulação (`tpCTe=2`)**: **estorna** o valor do CT-e original (lançamento negativo/ajuste). Não gerar crédito indevido.
- **Substituto (`tpCTe=3`)**: escriturar o substituto e **marcar o substituído como não escriturável** (`motivo = 'SUBSTITUIDO'`), evitando dupla contagem.

### 5.5. Integração no fluxo de importação/persistência

- Em `importacao-xml-fiscal.service.ts::persistirDocumento`, quando `documento.tipoDocumento === 'CTE'`:
  1. Extrair dados de escrituração (§5.1).
  2. Rodar o motor de decisão (§5.2) por cliente-alvo (o alvo já é resolvido a partir dos participantes; para CT-e a decisão real é "cliente == tomador").
  3. Resolver CFOP de entrada (§5.3).
  4. Persistir cabeçalho + 1 linha em `documentos_fiscais_cte_escrituracao` (Abordagem A). Setar `documentos_fiscais.escriturado` de acordo.
  5. Auditar (`eventosAuditoria`) com ação nova, ex.: `CTE_ESCRITURADO` / `CTE_NAO_ESCRITURAVEL`, sem vazar dados sensíveis.
- Em `escrituracao-fiscal.service.ts::reprocessar`, **remover** a exclusão que ignora `modelo === '57'` e passar a reprocessar CT-e baixando o XML do storage e reexecutando a decisão + resolução de CFOP (idempotente).
- Manter idempotência por `(cliente_id, chave_acesso)` já existente; o reprocesso deve atualizar a linha de escrituração sem duplicar.

### 5.6. Relatórios / apuração (Bloco D)

Estender `fiscal-itens.service.ts` (ou criar `fiscal-cte.service.ts`) para:
- **D190 (analítico)**: agregado por `CST_ICMS`, `CFOP`, `ALIQ_ICMS` a partir de `documentos_fiscais_cte_escrituracao` **onde `escrituravel = true`**. Campos `VL_OPR`, `VL_BC_ICMS`, `VL_ICMS`, `VL_RED_BC`.
- **Apuração ICMS**: somar o **crédito** de ICMS de fretes (`valor_icms_creditavel`) às entradas creditáveis já calculadas para NF-e. Respeitar Simples (crédito 0). Expor endpoint análogo aos existentes em `cliente-fiscal.controller.ts`.
- **Resumo de livros**: incluir seção "Entradas de Serviço de Transporte (Bloco D)" separada das mercadorias (Bloco C).
- Garantir que CT-e **não escriturável** nunca entre em nenhum agregado.

### 5.7. Endpoints (controllers)

- `admin-fiscal.controller.ts` e `cliente-fiscal.controller.ts`: expor consulta dos CT-e com o status de escrituração (escriturável/não escriturável + motivo) e um relatório D190/apuração de frete. Seguir o padrão de paginação (`parsePaginationParams`/`buildPaginatedResponse`) e de resposta (`{ data, ... }`) já usados.

---

## 6. Requisitos não-funcionais e de qualidade

- **TypeScript estrito + NestJS**: seguir os padrões e o `eslint.config.mjs`/`.prettierrc` do projeto. Injeção de dependências via construtor.
- **Drizzle**: toda query nova deve usar o builder tipado; nada de SQL string concatenada com dados do usuário.
- **Migrations versionadas** (§4.2). Rodar o generate do Drizzle Kit e conferir o snapshot.
- **Idempotência e transações**: persistência de cabeçalho + linha de escrituração dentro de `db.transaction`.
- **Segurança**: continuar rejeitando DTD/ENTITY e validando chave; nunca logar CNPJ/valores fiscais sensíveis em nível de erro público (seguir `AppLogger`).
- **Determinismo fiscal**: a decisão de escrituração deve ser uma função pura e coberta por testes (ver §7).
- **Cliente Simples Nacional**: reaproveitar `simplesNacionalSemApuracaoIcms` (em `src/clientes/clientes.types.ts`) para zerar crédito, mantendo o CT-e escriturado apenas para inventário/conferência.
- **Documentação**: atualizar `api/docs/fiscal-xml-import.md` (CT-e passa a gerar escrituração) e criar `api/docs/fiscal-cte-escrituracao.md` descrevendo a regra do tomador e o Bloco D.

---

## 7. Testes obrigatórios (Jest — seguir os `*.spec.ts` existentes)

1. **Parser de CT-e**: `toma3`=0/1/2/3 resolvendo remetente/expedidor/recebedor/destinatário; `toma4` com terceiro; extração de `vTPrest`, `vRec`, `ICMS` (CST/CSOSN, vBC, pICMS, vICMS).
2. **Motor de decisão**:
   - Cliente == tomador → escriturável, ENTRADA.
   - Cliente participa (remetente/destinatário) mas **não** é tomador → **não** escriturável, motivo `CLIENTE_NAO_E_TOMADOR`.
   - Cliente Simples e tomador → escriturável, `creditaIcms = false`.
   - `tpServ` subcontratação → `revisaoNecessaria = true`, crédito não automático.
   - CT-e cancelado/denegado → sem crédito, `COD_SIT` correto.
   - Complementar/anulação/substituto → soma/estorno/substituição corretos.
3. **Resolução de CFOP**: CFOP de saída da transportadora convertido para entrada de transporte do tomador; fallback marca revisão.
4. **Relatórios**: D190/apuração incluem apenas CT-e escriturável; excluem não escriturável; crédito zerado para Simples.
5. **Idempotência**: reimportar o mesmo CT-e não duplica a escrituração; reprocesso atualiza a linha.

---

## 8. Critérios de aceitação (Definition of Done)

- [ ] CT-e onde o cliente **é** o tomador é escriturado como ENTRADA de serviço de transporte, com CFOP de entrada resolvido, e aparece em D190/apuração.
- [ ] CT-e onde o cliente **não é** o tomador **não** é escriturado nem entra em nenhum relatório/apuração; permanece consultável com motivo `CLIENTE_NAO_E_TOMADOR`.
- [ ] Simples Nacional: CT-e escriturado sem crédito de ICMS.
- [ ] Cancelado/denegado, complementar, anulação e substituto tratados conforme SPED.
- [ ] Bloco D (D100/D190 no mínimo) alinhado ao leiaute vigente da EFD ICMS/IPI, com contadores (D001/D990) coerentes na geração do arquivo.
- [ ] Migrations versionadas + snapshot atualizado; `pnpm build` e `pnpm test` verdes.
- [ ] Documentação atualizada (`fiscal-cte-escrituracao.md`).

---

## 9. Observações e pontos a confirmar antes de codar

- **Confirmar a versão vigente do leiaute EFD ICMS/IPI** (Guia Prático / ATO COTEPE) para os campos e `COD_SIT` do Bloco D. As nomenclaturas de campo acima seguem o padrão consolidado, mas o período de apuração define a versão.
- **Confirmar a política de crédito de ICMS sobre frete** para cada perfil de cliente (indústria x comércio x prestador) e a UF, pois há vedações e condições específicas. Na dúvida, marcar `revisaoNecessaria = true` em vez de creditar automaticamente.
- **Não** alterar a semântica de NF-e/NFC-e existente além do necessário para separar Bloco C (mercadorias) de Bloco D (transporte) nos relatórios.
- Reaproveitar ao máximo o que já existe: `dacte.parser.ts` (tomador e valores), `cfop.service.ts` (equivalência de CFOP), `simplesNacionalSemApuracaoIcms`, padrões de idempotência/transação/auditoria de `importacao-xml-fiscal.service.ts`.

---

### Resumo em uma frase para a IA executora

> Implemente a escrituração de CT-e no Bloco D do SPED ICMS/IPI **apenas quando o cliente for o tomador (pagador) do frete**, resolvendo o tomador via `toma3/toma4`, convertendo o CFOP para entrada de serviço de transporte, tratando Simples/cancelamento/complementar/anulação/substituto, persistindo em tabela dedicada, e incluindo esses CT-e (e somente eles) nos relatórios de apuração — tudo com migrations versionadas e testes.
