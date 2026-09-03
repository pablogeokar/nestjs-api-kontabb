# Motor de regras fiscais e catálogo de CFOPs

## Objetivo

Substituir a conversão linear de CFOP (troca do primeiro dígito) por uma
resolução **contextual** que considera a destinação econômica da mercadoria, o
NCM, o fornecedor e regras cadastradas — garantindo CFOP escriturado correto e o
direito a crédito coerente com a legislação (LC 87/96, Convênio ICMS 142/18,
RIPI).

## Catálogo de CFOPs

A tabela `cfops` é a matriz canônica. Cada CFOP carrega:

- `tipo_operacao` (`ENTRADA`/`SAIDA`) e `abrangencia`
  (`ESTADUAL`/`INTERESTADUAL`/`EXTERIOR`), derivados do primeiro dígito;
- `categoria_fiscal`: `COMPRA_REVENDA`, `COMPRA_INSUMO`, `USO_CONSUMO`,
  `ATIVO_IMOBILIZADO`, `DEVOLUCAO`, `TRANSFERENCIA`, `REMESSA_RETORNO`,
  `PRESTACAO_SERVICO` ou `OUTRAS`;
- `gera_credito_icms_padrao`: só é `true` para compras de revenda/insumo. Uso e
  consumo, ativo imobilizado e mercadoria recebida como substituído tributário
  **não** geram crédito automático.

O seed (`src/database/seeds/cfops.seed.ts`) cobre 250+ CFOPs (estaduais,
interestaduais e de exterior) e as equivalências de/para não triviais
(ex.: `5405 → 1403`). O seed usa **upsert**: rodar novamente sincroniza
descrição, categoria e crédito dos CFOPs existentes sem apagar dados.

```bash
pnpm db:seed:cfops
```

`cfop_equivalencias` mantém os de/para por cliente (sobrescrita) e globais.

## Motor de regras (`FiscalRuleEngineService`)

O método `evaluate(input)` resolve o CFOP escriturado em cascata, na ordem:

1. **Regra do cliente** (`regras_fiscais.cliente_id = X`), por prioridade.
2. **Regra global** (`regras_fiscais.cliente_id = NULL`).
3. **Destinação econômica + NCM**: mapa canônico por categoria — uso/consumo →
   `x556`, ativo → `x551`, revenda → `x102`, industrialização → `x101`.
4. **CFOP mantido** quando já está no sentido correto e ativo.
5. **Algoritmo de direção** quando o destino existe no catálogo.
6. **`PENDENTE_CLASSIFICACAO`**: sem correspondência segura, o item é marcado
   para revisão com sugestão — nunca é reescrito cegamente.

O resultado (`RuleEvaluationResult`) traz o CFOP, o direito a crédito de
ICMS/IPI derivado da categoria do CFOP de destino, se exige CIAP ou DIFAL de
entrada, a origem da resolução e o motivo.

`CfopService.resolverCfopEquivalenteDetalhado` delega ao motor e só recorre à
cascata legada de equivalências quando o motor retorna `PENDENTE_CLASSIFICACAO`.

## Regras cadastradas (`regras_fiscais`)

CRUD por escopo:

- Cliente administra as próprias regras. Admin/staff administra as globais.
- Critérios de match: tipo de operação, CFOP de origem, NCM, fornecedor, UF e
  destinação. Ações: CFOP de destino, crédito de ICMS/IPI, exige CIAP/DIFAL.

## Override de destinação por item

`documentos_fiscais_itens.destinacao_mercadoria` guarda a reclassificação manual
do item. Ao defini-la, o CFOP escriturado é **re-resolvido** pelo motor e o item
é atualizado (CFOP + flag de revisão). Informar `AUTOMATICA` limpa o override.

## Endpoints

Cliente (`/api/fiscal/...`, empresa resolvida pela sessão):

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/fiscal/cfops` | Catálogo canônico (busca/paginação) |
| GET | `/fiscal/cfops/equivalencias` | Equivalências aplicáveis à empresa |
| POST | `/fiscal/regras/simular` | Simular a resolução de CFOP |
| GET | `/fiscal/regras` | Listar regras da empresa (e globais) |
| POST | `/fiscal/regras` | Criar regra da empresa |
| PUT | `/fiscal/regras/:id` | Atualizar regra da empresa |
| DELETE | `/fiscal/regras/:id` | Remover regra da empresa |
| PATCH | `/fiscal/regras/itens/:itemId/destinacao` | Definir destinação e re-resolver CFOP |

Admin/staff (`/api/admin/fiscal/...`, `clienteId` por query quando aplicável):

| Método | Rota | Descrição |
| --- | --- | --- |
| GET/POST/PUT/DELETE | `/admin/fiscal/cfops[...]` | CRUD do catálogo e equivalências |
| POST | `/admin/fiscal/regras/simular?clienteId=UUID` | Simular para uma empresa |
| GET/POST | `/admin/fiscal/regras/globais` | Listar/criar regras globais |
| PUT/DELETE | `/admin/fiscal/regras/globais/:id` | Atualizar/remover regra global |

## Interface

- Cliente: **Fiscal → Matriz de CFOPs** (`/cliente/fiscal/cfops`) traz o catálogo
  buscável, as equivalências e o **simulador em tempo real** do motor de regras.
- A edição de destinação está no drawer de itens de cada documento fiscal
  (**Fiscal → documento → aba Itens**), disponível para operações de entrada.
