# DeSTDA (Simples Nacional)

Geração do arquivo TXT da DeSTDA (Declaração de Substituição Tributária,
Diferencial de Alíquota e Antecipação) para empresas optantes pelo Simples
Nacional, para validação e transmissão no SEDIF-SN.

## Base normativa

- Ajuste SINIEF 12/2015 (e alterações) e art. 76 da Resolução CGSN 140/2018.
- Ato COTEPE/ICMS 47/2015, Anexo Único (Manual de Orientação do Leiaute):
  <https://www.confaz.fazenda.gov.br/legislacao/atos/2015/ac047_15>.
  Nenhuma alteração posterior do leiaute foi localizada em 2026. A versão do
  arquivo continua sendo a tabela 3.1.1 (`COD_VER` = `2000`).
- Prazo de entrega: dia 28 do mês seguinte (ou o primeiro dia útil seguinte),
  um arquivo por competência, com `COD_FIN` 0 (original) ou 1 (substituto).
  Arquivo complementar não é aceito.

## Estrutura do arquivo

ISO-8859-1, linhas terminadas em CRLF, campos delimitados por `|`, decimais com
vírgula e duas casas, datas `ddmmaaaa`.

| Bloco | Registros                                                      |
| ----- | -------------------------------------------------------------- |
| 0     | 0000, 0001, 0002 (por UF de substituto), 0005, 0030, 0100, 0990 |
| G     | G001, G020, G600/G605, G610/G615, G620/G625, G990              |
| 9     | 9001, 9900 (um por registro), 9990, 9999                        |

Os registros 9020/9030 (arquivos associados) não são gerados.

## Origem dos valores

| Registro   | Conteúdo                                              | Fonte no sistema                                                                                                 |
| ---------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| G605 (0/1) | DIFAL de entrada: ativo (CFOP 2551) e uso/consumo (2556) | `DifalEntradaService` (itens `DIFAL_ENTRADA_CONTRIBUINTE`, `CALCULADO`, com recolhimento próprio)              |
| G605 (3)   | Antecipação parcial (sem encerramento de fase)         | `antecipacao_parcial` do `DifalEntradaService` (itens `CALCULADO`)                                              |
| G615       | DIFAL de venda interestadual a não contribuinte (EC 87), por UF | NF-e de saída: `valor_icms_uf_dest` + `valor_fcp_uf_dest`                                              |
| G625       | ICMS-ST retido como substituto, por UF de destino     | NF-e de saída interestadual: `valor_icms_st` + `valor_fcp_st`. CFOP 6.651 a 6.667 vão como combustível (tipo 3) |

G600, G610 e G620 são os totalizadores calculados a partir dos filhos. Cada
filho informa NF, ajuste e valor a declarar (NF menos ajuste).

Documentos de saída entram apenas se estiverem autorizados, escriturados, com
escrituração concluída e integridade conferida (política de
`FiscalPeriodSelectionService`).

## Regras que bloqueiam a geração

- Empresa que não é Simples Nacional (422 `ESTABELECIMENTO_NAO_SIMPLES`).
- Dados cadastrais ausentes: CNPJ, IE, UF, município IBGE, responsável (nome e
  CPF) e contabilista vinculado.
- Itens de entrada com DIFAL ou antecipação sem regra aprovada (simulação ou
  pendência). Declarar só parte do imposto não é permitido.
- NF-e de saída com ICMS-ST ou DIFAL ainda pendente de escrituração, integridade
  ou revisão de CFOP.
- Saída com valor mas sem UF de destino válida.
- ICMS-ST retido para uma UF sem inscrição de substituto cadastrada (0002).
- Qualquer falha da validação estrutural interna (`validateDestdaFile`).

Sem valores a declarar, o arquivo é gerado "sem movimento" (`G020.IND_GEF` = 9).

## Cadastro do cliente e consulta de CNPJ

O cadastro da empresa (`clientes`) guarda código IBGE do município, nome
fantasia, responsável (nome, CPF e qualificação). A DeSTDA usa esses valores
quando a configuração própria (abaixo) não os sobrescreve.

A consulta de CNPJ (OpenCNPJ, com ReceitaWS de reserva) agora devolve:

- `trade_name`: nome fantasia.
- `ibge_code`: código IBGE de 7 dígitos, resolvido pela API de localidades do
  IBGE a partir do município e da UF (os provedores só informam o código
  interno da Receita). `null` se a API falhar.
- `responsible`: sócio pessoa física sugerido (prioriza administrador, diretor,
  titular), com a qualificação convertida para a tabela 3.3.2 da DeSTDA.

### Consulta de CEP

`GET /api/admin/clientes/consulta-cep/:cep` consulta ViaCEP, BrasilAPI (v2) e
OpenCEP, nessa ordem, e devolve `postal_code`, `street`, `district`, `city`,
`state`, `ibge_code` e `source`. Diferenças absorvidas: o ViaCEP responde 200
com `erro` quando o CEP não existe, a BrasilAPI e o OpenCEP respondem 404, e a
BrasilAPI usa nomes em inglês com o IBGE em `ibge.city` (que pode faltar). O
código IBGE só é aceito com 7 dígitos e prefixo coerente com a UF; se o
primeiro provedor não o informa, o seguinte completa. Resultados ficam em
cache por 24 horas.

No formulário do cliente, digitar o CEP preenche logradouro, bairro, município,
UF e o código IBGE, que sempre acompanha o último CEP consultado. A consulta de
CNPJ também usa o CEP para obter o IBGE (o nome do município é só reserva).

O CPF do responsável não é público (a Receita o mascara), então continua sendo
digitado manualmente.

## Configuração por empresa (`destda_configuracoes`)

Município IBGE, responsável (0005), inscrições de substituto (0002), fantasia,
IM, Suframa, NIRE, telefone/fax e ajustes do perfil 0030. Município, fantasia,
IM, Suframa, telefone e fax usam a configuração do SPED quando a da DeSTDA está
vazia.

Perfil 0030 padrão: `IND_ED` 3, `IND_ARQ` 7, `PRF_ISS` 9, `PRF_ICMS` 0,
`PRF_RIDF`/`RUDF`/`LMC`/`RV`/`RI` 1, `IND_EC` 9, `IND_ISS`/`RT` 1, `IND_ICMS` 0,
`IND_IPI` 1. `IND_ST` e `IND_AT` são derivados do movimento. Qualquer campo pode
ser sobrescrito no `perfil` da configuração.

## Endpoints

Cliente: `/api/fiscal/destda/...`. Staff: `/api/admin/fiscal/destda/...` (com
`clienteId`).

| Método | Rota                       | Descrição                                       |
| ------ | -------------------------- | ----------------------------------------------- |
| GET    | `/configuracao`            | Obter a configuração                            |
| PUT    | `/configuracao`            | Atualizar a configuração                        |
| GET    | `/preview`                 | Prévia: totais, contadores e inconsistências    |
| POST   | `/gerar`                   | Gera, armazena e baixa o TXT                    |
| GET    | `/historico`               | Arquivos gerados                                |
| GET    | `/arquivos/:id/download`   | Baixa novamente um arquivo gerado               |

`preview` e `gerar` recebem `competencia` (`AAAA-MM`) e `finalidade` (0 ou 1).

## Premissas e limitações (confirmar antes de uso em produção)

1. O FCP (FCP UF destino, FCP-ST e FCP do DIFAL de entrada) é somado ao valor
   declarado, pois o leiaute não tem campo próprio. Controlado por
   `DESTDA_INCLUI_FCP` em `destda-apuracao.ts`.
2. Os campos de ajuste (devoluções) saem vazios. O builder já suporta ajustes,
   mas nenhuma origem de dados os alimenta ainda.
3. Não há origem para G605 tipo 2 (antecipação com encerramento de fase), G625
   tipo 1 (ST antecedente), tipo 2 (transporte) nem G620 de entradas (2ª fase).
4. G625 considera só operações interestaduais, como descrevem os campos do
   leiaute. ST em operação interna não entra.
5. Os valores padrão do registro 0030 e o `IND_ED` 3 não foram conferidos contra
   um arquivo aceito pelo SEDIF. O primeiro arquivo real deve ser validado no
   programa oficial.
6. O leiaute oficial usa campos numéricos para CNPJ. O sistema aceita o CNPJ
   alfanumérico do cadastro, mas o SEDIF pode não aceitá-lo ainda.
