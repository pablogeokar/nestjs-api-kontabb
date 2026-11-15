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

## Antecipação Parcial do ICMS

A apuração de entradas mostra um bloco separado para compras interestaduais
para revenda (CFOP escriturado 2102) na Bahia. O cálculo usa o valor da
operação, aplica a diferença de alíquotas para o Simples Nacional ou deduz o
ICMS de origem no regime normal. Sinais de ICMS-ST no XML ficam em conferência
separada e os itens em revisão permanecem na seção de conferência.

Use a chave `ANTECIPACAO_PARCIAL` no catálogo `DIFAL` de BA. O conteúdo da
regra tem um array `enquadramentos` com `ncm`, `cest` (ou `null`),
`regime` e `tratamento` (`APLICAVEL`, `ICMS_ST`, `DISPENSADO` ou
`CONFERIR`, este último acompanhado de `motivo` e sempre pendente).
Quando aplicável, informe `aliquota_interna` em pontos percentuais como
string. Para fixar a `aliquota_interestadual` no Simples, informe também
`uf_origem` e `origem_mercadoria` para o escopo exato da regra.
Correspondências ambíguas ou parâmetros insuficientes deixam o item pendente.
Quando a versão normativa de `DIFAL`/BA ou a chave `ANTECIPACAO_PARCIAL`
não estiverem cadastradas e vigentes, a API informa a ausência da regra.
Quando houver regra mas faltar combinação exata de NCM, CEST, regime e origem,
informa os eixos sem correspondência; regras ambíguas também ficam pendentes.
Corrigir o CFOP apenas seleciona a compra para análise e não homologa o
tratamento tributário do produto.

### Rascunho BA/10-2026

O script `scripts/cadastrar-antecipacao-ba-2026-10.cjs` registra, de forma
idempotente, uma versão de catálogo e a revisão `ANTECIPACAO_PARCIAL` restritas
à competência 10/2026. Sem `--execute`, mostra o conteúdo; com `--execute`,
insere as regras. O catálogo é criado com `escopo_aprovado = false` e nunca
emite guia. As seis combinações cobrem sete itens de compras: uma combinação
permite simulação e cinco permanecem em `CONFERIR` até validação fiscal.

A revisão deve confrontar as descrições e CEST dos biscoitos, o tratamento do
IPI, a alíquota interestadual dos itens de origem de mercadoria 5, os CEST de
higiene/pulverizador e eventuais benefícios. Depois da análise, crie nova
revisão com a fonte e a vigência corretas; não altere a revisão existente
nem aprove o catálogo em bloco enquanto houver combinações pendentes.

### Cadastro e aprovação individual

O administrador acessa **Cadastros → Fiscal → ICMS** e seleciona a competência.
O cadastro de Antecipação Parcial atualmente atende à UF de apuração **BA**.
Cada salvamento cria uma revisão da chave `ANTECIPACAO_PARCIAL`, preservando as
anteriores e os parâmetros gerais da regra. A API exige combinação única de NCM,
CEST, regime, UF de origem e origem da mercadoria, e rejeita revisões concorrentes.
Uma linha marcada como `confirmado_fiscalmente` só é salva com tratamento definido,
parâmetros válidos, fundamento e URL da fonte normativa. Ao salvar, essa linha
passa a valer individualmente; as demais continuam em simulação ou conferência.
O administrador pode retirar a confirmação de uma linha e salvar nova revisão.
Itens com IPI sem decisão fundamentada, dados incompletos, ST divergente no XML
ou sem combinação exata continuam pendentes mesmo quando a linha foi aprovada.
Revisões antigas homologadas em bloco permanecem compatíveis e imutáveis.

O total da competência considera cálculos com enquadramento aprovado antes de
reduções condicionadas ao pagamento. O simulador administrativo recebe a
base, a alíquota interna e a alíquota interestadual ou o ICMS de origem
dedutível, além de uma redução opcional sobre o imposto. A simulação fica
fora dos totais da competência.

A apuração segue o [RICMS-BA, arts. 274, 321 e 332](https://mbusca.sefaz.ba.gov.br/DITRI/normas_complementares/decretos/decreto_2012_13780_ricms_texto_2021.pdf).

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
DAE/GNRE a partir das apurações depende de integração homologada com cada UF.
Na Antecipação Parcial da BA, a interface encaminha ao serviço oficial da
SEFAZ-BA com o código de receita **2175** e mostra somente o total calculado
com enquadramento aprovado. A emissão, o vencimento e o valor final são confirmados
no portal estadual; o demonstrativo interno não é um DAE emitido.

O staff pode baixar um **espelho de recolhimento sem valor fiscal** diretamente
da prévia de Antecipação Parcial (somente se houver total aprovado positivo)
ou de uma obrigação já registrada na Central de guias. A prévia não inventa
vencimento: exibe “A confirmar no portal oficial” e indica quantos itens ficaram
fora do total por pendência, simulação ou ST. O espelho de obrigação registrada
usa os valores, receita, competência e vencimento armazenados; não recalcula nem
altera a obrigação. Ambos usam o mesmo contrato de renderização, independente
de UF, em `espelho-recolhimento.pdf.ts`. O PDF não contém marca oficial, código
de barras, linha digitável, PIX ou autenticação e não é gravado como guia emitida
ou documento oficial. A emissão real e o vínculo do PDF oficial continuam sendo
etapas distintas.

Na prévia da BA, o anexo do espelho agrupa os itens por NF-e (número, série,
chave de acesso e UF de origem), informa a quantidade de notas analisadas e a
quantidade com itens calculados, e destaca o **valor integral sem redução de
20%**. A memória por item vem do resultado do próprio motor: NCM/CEST, CFOP,
regime, composição da operação, IPI, bases, alíquotas, ICMS interno, dedução,
imposto integral, revisão/vigência/fonte da regra e eventual redução condicionada.
Itens pendentes, simulados ou sujeitos a ST aparecem com motivo e não integram
o total. A redução de 20% permanece apenas cenário condicionado ao enquadramento
e ao pagamento no prazo, nunca desconto automático do valor principal. O
espelho de um registro avulso na Central não presume vínculo com as NF-e da
apuração corrente e permanece resumido.

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

Admin/staff (`/api/admin/fiscal/apuracao/...`):

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/admin/fiscal/apuracao/difal-entrada?clienteId=UUID&competencia=AAAA-MM` | DIFAL de entrada e Antecipação Parcial da empresa |
| GET | `/admin/fiscal/icms/regras?uf=BA&competencia=AAAA-MM` | Consultar a revisão vigente (staff) |
| PUT | `/admin/fiscal/icms/regras` | Salvar nova revisão; linhas confirmadas passam a valer individualmente (admin) |
| POST | `/admin/fiscal/icms/regras/homologar` | Homologação em bloco legada (admin; não usada pela tela) |
| POST | `/admin/fiscal/apuracao/antecipacao-parcial/simular` | Simular com parâmetros informados |
| POST | `/admin/fiscal/apuracao/ciap/importar` | Importar bens de ativo |
| POST | `/admin/fiscal/apuracao/ciap/bens` | Registrar bem manualmente |
| POST | `/admin/fiscal/apuracao/ciap/apropriar` | Efetivar 1/48 + ajuste E111 |
| PATCH | `/admin/fiscal/apuracao/ciap/bens/:id/baixa` | Baixar bem |
| POST | `/admin/fiscal/apuracao/guias` | Criar guia |
| GET | `/admin/fiscal/apuracao/guias/central?clienteId=UUID&competencia=AAAA-MM` | Central de obrigações e PDFs oficiais |
| GET | `/admin/fiscal/apuracao/guias/:id/espelho?clienteId=UUID` | PDF auxiliar da obrigação registrada |
| GET | `/admin/fiscal/apuracao/antecipacao-parcial/espelho?clienteId=UUID&competencia=AAAA-MM` | PDF auxiliar da prévia homologada da BA |
| PATCH | `/admin/fiscal/apuracao/guias/:id/pagamento` | Atualizar pagamento |
| DELETE | `/admin/fiscal/apuracao/guias/:id?clienteId=UUID` | Remover guia |

## Interface

- **Fiscal → DIFAL e Antecipação** (`/admin/fiscal/difal`): consulta da apuração de entrada
  para a empresa e a competência selecionadas no painel administrativo. A
  seção de conferência lista NF-e interestaduais fora do cálculo, identifica
  escrituração em revisão e oferece um atalho para localizar a nota.

- **Fiscal → Cockpit** (`/cliente/fiscal/cockpit`): cards de saúde fiscal
  (ICMS/PIS/COFINS/guias) com semáforo por competência.
- **Fiscal → Apuração e DIFAL** (`/cliente/fiscal/apuracao`): aba DIFAL Entrada
  na apuração geral ou quadro separado na página do Simples Nacional.

## Limitações atuais

- A geração do arquivo da EFD-Contribuições (Bloco M) não está implementada; o
  serviço de PIS/COFINS produz o demonstrativo, não o TXT.
- As guias são conciliadas com trilha e vínculo à apuração (Fase 5), mas ainda
  são lançadas manualmente; não há emissão automática de DAE/GNRE.
- O calculador puro de ICMS-ST separa imposto próprio, retenção e FCP-ST, mas
  ainda não está conectado à apuração por competência nem à emissão de guia.
  Itens sob ST aparecem na conferência de DIFAL sem recolhimento próprio; não
  devem ser tratados como ST já apurada ou paga.
- A tabela de alíquotas internas de ICMS por UF é uma referência modal e pode
  divergir de alíquotas específicas por NCM.
