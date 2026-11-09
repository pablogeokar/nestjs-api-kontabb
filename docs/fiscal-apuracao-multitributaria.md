# Apuração multitributária

Serviços de apuração que consomem os documentos escriturados e as tabelas de
apoio para produzir demonstrativos por competência. Todos os valores trafegam
como string decimal (numeric) e a competência usa o formato `AAAA-MM`.

## CIAP (Bloco G — crédito do ativo permanente)

Base legal: LC 87/96, art. 20, §5º. O crédito de ICMS de bens do ativo é
apropriado em **48 parcelas mensais** (1/48), cada parcela multiplicada pelo
**coeficiente de saídas tributadas** (saídas tributadas ÷ saídas totais do
período).

- `ciap_ativo_permanente` guarda a ficha de cada bem (valor de ICMS, parcelas
  apropriadas, saldo restante, status).
- `CiapService`:
  - `importarBensDoPeriodo`: cria fichas a partir de itens de compra de ativo
    (CFOP `x551`) escriturados;
  - `apurarCompetencia`: **preview** da parcela e do crédito do período (não
    persiste);
  - `apropriarCompetencia`: efetiva a apropriação (incrementa parcelas, reduz
    saldo, conclui na 48ª) e **gera automaticamente um ajuste `E111` de crédito**
    (`sped_ajustes_apuracao`, código `UF02CIAP`) que realimenta a apuração do
    ICMS no Bloco E da EFD. A apropriação é **idempotente** pela razão versionada
    `ciap_apropriacoes`: a existência de uma apropriação ativa para
    (bem, competência) torna a reexecução um no-op (mesma versão, nunca segunda
    parcela). O unique parcial `uidx_ciap_aprop_bem_competencia_ativa` reforça
    isso no banco e o `pg_advisory_xact_lock` por cliente/competência faz retries
    e chamadas concorrentes convergirem para a mesma competência;
  - `baixarBem`: baixa por venda/transferência.

## DIFAL de entrada

A apuração de entrada cobre compras interestaduais para uso ou consumo (CFOP 2556)
e ativo imobilizado (CFOP 2551). A competência segue a data fiscal de entrada,
com fallback para a emissão. Operações sob ST (incluindo CFOPs 2406 e 2407)
aparecem separadas e ficam fora do total de recolhimento próprio.

O catálogo versionado usa o tipo `DIFAL`, a UF de destino, a competência e a
chave `DIFAL_ENTRADA_CONTRIBUINTE`. Configure os percentuais como strings no
conteúdo da regra, incluindo `aliquota_interna` e, quando aplicável,
`aliquota_fcp`, `percentual_reducao` e `percentual_beneficio`. A alíquota
interestadual vem da regra ou do item, conforme a operação.

- **Base única.** Multiplica a base pela diferença entre as alíquotas. Usa a
  base do XML quando disponível e evita reaplicar a redução já refletida nela.
- **Base dupla.** Com `base_dupla: true`, parte do valor da operação, incluindo
  IPI, deduz o ICMS da origem e recompõe a base por dentro pela alíquota interna.
  O DIFAL é o ICMS calculado no destino menos o ICMS da origem. A ausência do
  ICMS de origem deixa o item pendente.
- **FCP.** Calcula e totaliza o adicional separadamente. Use
  `fcp_na_base_por_dentro: true` quando a norma exigir a inclusão do adicional
  na alíquota usada para recompor a base. Os valores por item são arredondados
  a centavos.

Somente resultados de regras homologadas entram nos totais a recolher.
Parâmetros inválidos ou ausentes aparecem como pendência e regras vigentes
aguardando homologação aparecem como simulação. O painel de apuração do
Simples Nacional exibe o DIFAL de entrada separado do DAS.

Referências: [LC 87/1996, art. 13](https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp87.htm),
[exemplo oficial de base dupla da SEFAZ-MT](https://app1.sefaz.mt.gov.br/04256E4C004D9CE4/A846E70F044285D7042572F9004EEAA2/1FD72E1EFECC8B3A04258ABD0063EB97)
e [LC 123/2006, art. 13](https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm).

## PIS/COFINS

`PisCofinsService.apurarCompetencia` segrega a apuração por regime do cliente:

- **Simples Nacional**: recolhido via DAS — sem apuração destacada.
- **Lucro Presumido**: cumulativo, 0,65% (PIS) e 3,00% (COFINS) sobre a receita,
  sem créditos (Lei 9.718/98).
- **Lucro Real**: não-cumulativo, 1,65% e 7,60% com créditos das entradas (Leis
  10.637/02 e 10.833/03).

A receita é segregada por CST em tributada (`01/02`), monofásica/ST/alíquota zero
(`04–09`, sem débito próprio) e creditável (`50–56/60–66`), evitando tributar em
duplicidade. É a base para o Bloco M da EFD-Contribuições (geração do arquivo em
si é trabalho futuro).

## Guias de recolhimento e conciliação

`fiscal_apuracoes_guias` armazena as guias (DAE/GNRE/DARF/DAS) por competência e
tributo. A partir da Fase 5, a guia separa quatro conceitos — obrigação
calculada (do fechamento), guia emitida, pagamento e conciliação — com trilha
append-only em `fiscal_pagamentos_eventos`, cancelamento lógico (sem delete
físico), sinalização de divergência contra o saldo do fechamento, "PAGO" só com
evidência/declaração manual e vínculo à versão de apuração. O detalhamento está
em `fiscal-entrega-conciliacao-operacao.md`.

As guias ainda são criadas manualmente via endpoint; a emissão automática de
DAE/GNRE a partir das apurações é evolução planejada.

## Endpoints

Cliente (`/api/fiscal/apuracao/...`):

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/fiscal/apuracao/ciap?competencia=AAAA-MM` | Preview do CIAP |
| GET | `/fiscal/apuracao/ciap/bens?status=` | Bens do CIAP |
| GET | `/fiscal/apuracao/difal-entrada?competencia=AAAA-MM` | DIFAL de entrada |
| GET | `/fiscal/apuracao/pis-cofins?competencia=AAAA-MM` | PIS/COFINS |
| GET | `/fiscal/apuracao/guias?competencia=&tributo=&status=` | Guias |
| GET | `/fiscal/apuracao/guias/resumo?competencia=AAAA-MM` | Resumo de guias |

Admin/staff (`/api/admin/fiscal/apuracao/...`, escrita):

| Método | Rota | Descrição |
| --- | --- | --- |
| POST | `/admin/fiscal/apuracao/ciap/importar` | Importar bens de ativo |
| POST | `/admin/fiscal/apuracao/ciap/bens` | Registrar bem manualmente |
| POST | `/admin/fiscal/apuracao/ciap/apropriar` | Efetivar 1/48 + ajuste E111 |
| PATCH | `/admin/fiscal/apuracao/ciap/bens/:id/baixa` | Baixar bem |
| POST | `/admin/fiscal/apuracao/guias` | Criar guia |
| PATCH | `/admin/fiscal/apuracao/guias/:id/pagamento` | Atualizar pagamento |
| DELETE | `/admin/fiscal/apuracao/guias/:id?clienteId=UUID` | Remover guia |

## Interface

- **Fiscal → Cockpit** (`/cliente/fiscal/cockpit`): cards de saúde fiscal
  (ICMS/PIS/COFINS/guias) com semáforo por competência.
- **Fiscal → Apuração** (`/cliente/fiscal/apuracao`): workspace em abas
  (ICMS, DIFAL, CIAP, PIS/COFINS, Guias) no estilo livro fiscal.

## Limitações atuais

- A geração do arquivo da EFD-Contribuições (Bloco M) não está implementada; o
  serviço de PIS/COFINS produz o demonstrativo, não o TXT.
- As guias são conciliadas com trilha e vínculo à apuração (Fase 5), mas ainda
  são lançadas manualmente; não há emissão automática de DAE/GNRE.
- A tabela de alíquotas internas de ICMS por UF é uma referência modal e pode
  divergir de alíquotas específicas por NCM.
