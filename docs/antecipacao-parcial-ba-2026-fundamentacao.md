# Antecipação Parcial BA 2026: fundamentação do seed

Seed: `src/database/seeds/icms-ba-2026.seed.ts` (`pnpm db:seed:icms-ba`) (regras `ANTECIPACAO_PARCIAL` e `DIFAL_ENTRADA_CONTRIBUINTE`)
Dados: `src/database/seeds/data/antecipacao-parcial-ba-2026.enquadramentos.ts` (123 enquadramentos)
Consulta às fontes: 14/11/2026. Situação: catálogo e regra sem homologação em bloco (`escopo_aprovado = false`). A seed (`pnpm db:seed:icms-ba`) reproduz a revisão 31 de 21/11/2026: 126 enquadramentos, dos quais 24 já confirmados (`confirmado_fiscalmente = true`) e 6 em `CONFERIR`. Ao semear um banco novo, as 24 linhas confirmadas entram em vigor; para exigir nova conferência, troque o valor para `false` em `src/database/seeds/data/antecipacao-parcial-ba-2026.enquadramentos.ts` antes de semear. Três linhas (NCM 17041000/CE, 61121100/SP e 61034300/SC) foram acrescentadas pela revisão fiscal, com fundamento curto ("RICMS BA", "revisado pelo usuário"); vale detalhar a base legal.

## Escopo

As combinações vêm das entradas interestaduais de NF-e de clientes da BA no banco de desenvolvimento (293 itens, todos de 2026, todos de clientes do Simples Nacional), agrupadas pela mesma chave que o motor usa: NCM, CEST, regime, UF de origem e origem da mercadoria. O arquivo `ncm-cest-unicos.csv` tem 1.036 pares de dados (mais o cabeçalho), incluindo saídas e entradas internas, que não são hipótese de antecipação parcial. Por isso ficaram fora. Desses pares, 220 NCMs têm apenas sete dígitos, compatíveis com perda do zero inicial na exportação; para comparar códigos, foi feito o preenchimento à esquerda com zero, sem inferir que a classificação fiscal esteja correta. Dos 79 pares distintos do seed, 78 aparecem no CSV após essa normalização; o outro é o NCM inválido `00000000`, mantido em conferência.

## Regra geral aplicada

| Ponto | Regra | Fonte |
|---|---|---|
| Incidência | Aquisição interestadual para comercialização, pelo adquirente, qualquer que seja o regime. Não se aplica a isenção, não incidência e ST com encerramento. | Lei 7.014/96, art. 12-A, caput e § 1º |
| Base | Valor da operação interestadual do documento de aquisição | Lei 7.014/96, art. 23, III |
| Alíquota interna | 20,5% (efeitos a partir de 07/02/2024) | Lei 7.014/96, art. 15, I, "a", redação da Lei 14.629/23 |
| Simples Nacional | Diferença entre a alíquota interna e a interestadual, sem agregar valor, pelas alíquotas de não optantes | RICMS-BA, art. 321, VII, "b" e § 1º |
| Interestadual 7% / 12% | 7% para origem MG, PR, RJ, RS, SC e SP; 12% para as demais | Res. SF 22/1989 |
| Interestadual 4% | Origem 1, 2, 3 e 8 da tabela A | Res. SF 13/2012 |
| Reduções de base | Devem ser consideradas na antecipação parcial | RICMS-BA, art. 268, § 3º |
| ST | Mercadoria e CEST listados no Anexo 1 (redação 2026); a descrição prevalece sobre o NCM | RICMS-BA Anexo 1/2026; Conv. ICMS 142/18, cl. 7ª, § 1º |

## Verificações que mudaram o resultado

- **Informática não tem mais carga de 12%.** O RICMS-BA, art. 266, XIII, foi revogado pelo Decreto 23.248/24, com efeitos a partir de 01/03/2025 (prazo dado pelo Decreto 23.332/25). A cópia do RICMS publicada em `decreto_2012_13780_ricms_texto.pdf` só tem alterações até 31/12/2020 e ainda mostra a redução. A redação vigente está em `decreto_2012_13780_ricms_texto_2021.pdf`, atualizado até o Decreto 24.829/26.
- **Nenhum CEST das entradas consta do Anexo 1/2026 como item.** O Anexo 1 lista só os segmentos 01–06, 09, 10, 13, 16, 17 (farinha, massas, pães e carnes), 23, 24, 25 e 26, mais a referência ao Anexo XXVI do Conv. 142/18 (porta a porta). Higiene pessoal (item 9-A) e biscoitos (itens 11.11.x) estão revogados. O CEST 17.047.00 aparece no texto do Anexo só dentro de uma exceção.
- **Nenhum item sujeito ao adicional de FCP de 2%.** As mercadorias não estão nos incisos II, IV, V e VII do art. 16 da Lei 7.014/96. O odorizante 3307.49 e os sabonetes 3401 não estão na lista de cosméticos da IN SAT 05/2016. A IN foi consultada na cópia do [LegisWeb](https://www.legisweb.com.br/legislacao/?id=328709), porque a cópia oficial não foi localizada no portal da SEFAZ-BA.
- **Isenções encontradas para 8471 são condicionadas.** O art. 265, LXV, "f" exige venda à administração pública. O art. 265, CXIV exige mouse ocular para pessoa com deficiência. Nenhuma das duas se aplica às compras dos clientes.

## Enquadramentos em CONFERIR (7)

| NCM | Motivo |
|---|---|
| 00000000 | NCM inválido |
| 84248990 | Conv. ICMS 52/91, Anexo I, item 20.6. Se abrangido, carga de 8,80% (art. 266, I, "a") |
| 84821010 | Autopeças, Conv. 142/18, Anexo II, CEST 01.049.00 (Anexo 1 BA, item 1.1). XML sem CEST |
| 85072010 (2) | Autopeças, CEST 01.099.00 (baterias de chumbo). XML sem CEST |
| 85291090 | Autopeças, CEST 01.063.00 (antenas). XML sem CEST |
| 19053100 / 17.053.01 / SP | A descrição (pão de mel, broinha) sugere 1905.90.90 / CEST 17.062.01, com ST no item 11.18.1 |

Os demais 116 estão como APLICAVEL a 20,5%. Quando o XML traz NCM ou CEST incompatível com a descrição e a correção não muda o tributo, o caso está anotado em `revisao_fiscal`.

## Redução de 20% para ME/EPP (art. 274)

A regra `ANTECIPACAO_PARCIAL` (revisão 2) traz `reducao_me_epp`, com percentual de 20, fundamento no RICMS-BA, art. 274, e a condição de recolhimento no prazo regulamentar. O motor oferece o valor reduzido apenas como cenário condicionado para optantes do Simples Nacional, que são ME ou EPP por definição (LC 123/06, art. 3º). Uma ME/EPP fora do Simples não é identificável pelo cadastro.

O item mantém `valor_antecipacao` e o total da apuração pelo imposto integral enquanto o sistema não comprovar o pagamento tempestivo. `reducao_condicionada` mostra `valor_reducao` e `valor_com_reducao` para a conferência no DAE. A DeSTDA também recebe o valor integral nesse estado.

## IPI destacado na aquisição

A base da antecipação parcial é o valor da operação interestadual no documento (Lei 7.014/96, arts. 12-A e 23, III). A exclusão do IPI depende dos requisitos do art. 17, § 2º; um CEST/NCM ou o simples fato de haver IPI destacado não demonstram todos eles. Por isso, cada enquadramento pode registrar `ipi_na_base` (`INCLUIR` ou `EXCLUIR`) e `fundamento_ipi`. A decisão é validada no cadastro e fica sujeita à confirmação fiscal. Sem decisão fundamentada, o item com IPI mostra os valores **com** e **sem** IPI, permanece `PENDENTE` e não compõe o total ou a DeSTDA. Quando o IPI é incluído para adquirente do Simples, o motor calcula o ICMS interno sobre a base com IPI e a parcela interestadual sobre a operação sem IPI; o detalhe expõe `base_calculo_origem`, `base_calculo` e `deducao_origem`. Com decisão e enquadramento aprovado, a base adotada e o tratamento do IPI aparecem no detalhe.

**Estado da decisão de IPI (BA, nov/2026):** não há norma específica nem parecer da SEFAZ-BA localizados sobre IPI na base da antecipação parcial. A leitura literal do art. 23, III da Lei 7.014/96 (valor da operação constante no documento) sustenta incluir o IPI, que é também o critério sem risco de recolher a menos. A LC 87/96, art. 13, § 2º, indica excluir quando a operação é entre contribuintes, para comercialização, com fato gerador do ICMS e do IPI. As regras com `ipi_na_base` registram o critério adotado e a pendência de consulta à DITRI (script `scripts/atualizar-fundamento-ipi-antecipacao.cjs`). Se vier resposta, trocar a decisão e o fundamento nas regras.

O [Acórdão CJF 0042-11/25-VD](https://mbusca.sefaz.ba.gov.br/consef/2025%20-%20ac%C3%B3rd%C3%A3os%20c%C3%A2maras/A-0042-11.25-VD.pdf) registra base com IPI em compras de optante do Simples. O [Acórdão JJF 0007-05/17](https://mbusca.sefaz.ba.gov.br/consef/2017%20ac%C3%B3rd%C3%A3os%20juntas/A-0007-05.17.pdf) distingue a base paga pelo comerciante da base do ICMS na origem. O [Acórdão CJF 0239-12/18](https://mbusca.sefaz.ba.gov.br/consef/2019%20ac%C3%B3rd%C3%A3os%20c%C3%A2maras/A-0239-12.18.pdf) trata da exclusão condicionada do IPI. Esses precedentes motivam a decisão explícita por enquadramento, sujeita à verificação das circunstâncias da operação.

Na NF-e 320904 exibida na revisão, os NCMs 18063120/CEST 1700202 e 18063220/CEST 1700301 já têm enquadramento no seed, mas não possuem decisão sobre IPI. Assim, o bloqueio anterior por IPI passa a trazer os dois cenários para revisão, sem presumir o tratamento fiscal.

Uma decisão `ipi_na_base` no cadastro vale para todos os itens que coincidam com NCM, CEST, regime, UF de origem e origem da mercadoria. Quando as condições do art. 17, § 2º, variam entre fornecedores ou operações dessa mesma combinação, a regra deve continuar sem decisão e os itens permanecem em conferência; o modelo atual ainda não possui uma decisão individual por item para esse caso.

## DIFAL de entrada (regra `DIFAL_ENTRADA_CONTRIBUINTE`, revisão 1, rascunho)

| Parâmetro | Valor | Fonte |
|---|---|---|
| Alíquota interna | 20,5% | Lei 7.014/96, art. 15, I, "a" |
| Interestadual | a do item (Res. SF 22/89 e 13/12) | — |
| Base | dupla: base do destino com o imposto por dentro | Lei 7.014/96, art. 17, XI, "b" e § 6º (Lei 14.415/21, efeitos 31/12/21) |
| FCP | não aplicado na regra geral | Lei 7.014/96, art. 16-A, que só alcança mercadorias listadas |
| Dispensa sobre ativo (CFOP 2551) para ME/EPP | sim | RICMS-BA, art. 272, I, "a", 2 |
| Lançamento | débito do diferencial de alíquotas | RICMS-BA, art. 305, § 4º, III, "a" |

Pontos a confirmar antes de homologar:

- **Abatimento da antecipação (ponto A4, resolvido):** depende do regime do **adquirente**, e o motor registra o critério em `credito_origem`.
  - **Adquirente do Simples Nacional:** diferença entre a alíquota interna e a interestadual (7%, 12% ou 4%), sem depender de crédito destacado, mesmo quando o fornecedor é do Simples e o CSOSN é 102. Base: RICMS-BA, art. 321, VII, "b"; Parecer SEFAZ-BA 18.724/2009 ([texto](https://www.legisweb.com.br/legislacao/?id=348147)), que diz que o valor informado na nota pelo fornecedor do Simples só é crédito para quem apura pelo regime normal.
  - **Adquirente do regime normal:** abate o ICMS destacado. Se o fornecedor é do Simples, abate só o crédito informado na nota (CSOSN 101, `vCredICMSSN`). Com CSOSN 102, 103, 300 ou 400 não há crédito e nada é abatido. Base: LC 123/06, art. 23, § 1º; Parecer SEFAZ-BA 34/2012 ([texto](https://www.legisweb.com.br/legislacao/?id=347630)). CSOSN 101 sem valor de crédito na nota fica pendente.
- **Simples como adquirente:** a aplicação da base dupla e o alcance dos Temas 517 e 1284 do STF devem ser confirmados pela revisão fiscal.
- **FCP:** mercadorias de uso e consumo com adicional de FCP (art. 16, II, IV, V e VII, e cosméticos da IN SAT 05/2016) não têm o adicional na regra geral.
- **Dados:** o banco ainda não tem entradas 2551/2556, então a regra ainda não foi exercitada com dados reais.

## Limitações que continuam

1. **IPI:** itens com IPI destacado ficam pendentes até a decisão fiscal fundamentada por enquadramento; os dois cenários são apresentados para conferência.
2. **CFOP escriturado:** o motor só lê itens escriturados com CFOP 2102 (antecipação) e 2551/2556 (DIFAL). Das 293 entradas interestaduais, só 7 estão com 2102.
3. **Aprovação na tela:** cada enquadramento de `ANTECIPACAO_PARCIAL` é confirmado e salvo separadamente dos demais. A regra de DIFAL ainda não tem tela de revisão.
4. **ST no relatório de DIFAL:** o fluxo de CFOP 2406/2407 e sinais de ST no XML evita recolhimento próprio em duplicidade, mas ainda não cruza cada item com uma regra `ST_FCP` estadual homologada. Essa classificação permanece sujeita à conferência do recolhimento e da responsabilidade tributária.

## Evidências (SHA-256 do arquivo baixado em 14/11/2026)

- [RICMS-BA Anexo 1, redação 2026](https://mbusca.sefaz.ba.gov.br/ditri/normas_complementares/decretos/decreto_2012_13780_ricms_anexo_1_vigente_2026.pdf) `d009df80b3897e04377adc82a1a7c0f1ddbec3547a1da1cb69fef54516663b8e`. O link com `/DITRI/` em maiúsculas citado no prompt devolve 404.
- [RICMS-BA, alterações desde 2021](https://mbusca.sefaz.ba.gov.br/ditri/normas_complementares/decretos/decreto_2012_13780_ricms_texto_2021.pdf) `9cf243f7693e4d4f29050040a3261bcfac0afcc10400d589447b6278313bca82`
- [Lei 7.014/96 com notas](https://mbusca.sefaz.ba.gov.br/DITRI/leis/leis_estaduais/legest_1996_7014_icmscomnotas.pdf) `dfcf041095a7834484823c616f251b4612abad67d4c41f37438ad455c724f7a9`
- [Conv. ICMS 142/18](https://www.confaz.fazenda.gov.br/legislacao/convenios/2018/CV142_18) `ae6540b124d1be3653d8ec46ce98be0de93c07d8cd457f1107d0cafe90f0d23a`
- [Conv. ICMS 52/91](https://www.confaz.fazenda.gov.br/legislacao/convenios/1991/CV052_91), [Res. SF 22/1989](https://legis.senado.leg.br/norma/586152), [Res. SF 13/2012](https://legis.senado.leg.br/norma/586999/publicacao/15839317)

Os textos das fontes foram resumidos, não transcritos.

## Operação

1. Prévia: `pnpm db:seed:icms-ba --preview`
2. Gravar: `pnpm db:seed:icms-ba`. O script é idempotente e aborta se houver outra vigência de Antecipação Parcial BA sobreposta a 2026.
3. Na tela, abrir **Cadastros → Fiscal → ICMS** com UF BA e a competência da nota. O atalho na apuração já filtra a combinação da NF-e.
4. Conferir uma linha, marcar sua aprovação e salvar. Ela passa a compor a apuração se os parâmetros do item estiverem completos; linhas ainda não confirmadas continuam em `SIMULACAO` ou `PENDENTE` e ficam fora do total, do espelho e da DeSTDA.

## Tabela dos enquadramentos

| NCM | CEST | Tratamento | Origens (UF/origem → interestadual) |
|---|---|---|---|
| 00000000 | — | CONFERIR | SP/0→—% |
| 17041000 | 2804100 | APLICAVEL | SE/0→12% |
| 17049020 | 1700100 | APLICAVEL | CE/0→12% |
| 17049020 | 1700900 | APLICAVEL | CE/0→12% |
| 17049020 | 2804100 | APLICAVEL | SE/0→12%, SE/5→12% |
| 17049090 | 1704700 | APLICAVEL | SE/0→12% |
| 18063120 | 1700202 | APLICAVEL | SP/0→7% |
| 18063220 | 1700301 | APLICAVEL | SP/0→7% |
| 19012090 | 2300200 | APLICAVEL | SE/0→12% |
| 19041000 | 1703000 | APLICAVEL | PE/0→12% |
| 19053100 | 1705301 | APLICAVEL | SE/0→12% |
| 19053100 | 1705301 | CONFERIR | SP/0→—% |
| 19053100 | 1705302 | APLICAVEL | SE/0→12% |
| 29242999 | 2804300 | APLICAVEL | SE/0→12% |
| 33074900 | — | APLICAVEL | SP/0→7% |
| 34012010 | 2003600 | APLICAVEL | MG/5→7% |
| 34013000 | 2003700 | APLICAVEL | SP/0→7% |
| 34025000 | 1100600 | APLICAVEL | SP/0→7% |
| 34029029 | 1100700 | APLICAVEL | SP/0→7% |
| 34029090 | 1100700 | APLICAVEL | SP/0→7% |
| 38089419 | — | APLICAVEL | MG/5→7% |
| 38089429 | — | APLICAVEL | MG/5→7% |
| 38099190 | 1100800 | APLICAVEL | SP/0→7% |
| 39169090 | — | APLICAVEL | SP/0→7% |
| 39269090 | — | APLICAVEL | SC/0→7% |
| 40161090 | — | APLICAVEL | SC/1→4% |
| 42029200 | 1900500 | APLICAVEL | SP/1→4% |
| 82089000 | — | APLICAVEL | SP/0→7% |
| 83052000 | — | APLICAVEL | SC/2→4% |
| 84145990 | 2108800 | APLICAVEL | MG/6→7%, SC/2→4% |
| 84248990 | 2109900 | CONFERIR | MG/0→—% |
| 84433111 | 2101600 | APLICAVEL | GO/2→4%, PE/2→4% |
| 84433113 | 2101600 | APLICAVEL | ES/2→4%, ES/4→12% |
| 84433240 | 2101700 | APLICAVEL | ES/7→12%, GO/7→12% |
| 84433299 | 2101700 | APLICAVEL | ES/2→4%, ES/4→12%, GO/4→12%, MG/5→7%, MG/6→7%, PR/4→7%, SC/1→4% |
| 84439923 | 2101800 | APLICAVEL | GO/7→12% |
| 84439933 | 2101800 | APLICAVEL | ES/4→12%, GO/4→12% |
| 84713012 | — | APLICAVEL | SP/0→7% |
| 84713019 | 2102800 | APLICAVEL | SP/4→7% |
| 84715010 | 2103000 | APLICAVEL | ES/1→4%, PR/4→7% |
| 84716052 | 2103100 | APLICAVEL | DF/2→4%, ES/2→4%, MG/1→4%, MG/5→7%, SC/1→4% |
| 84716052 | 2105600 | APLICAVEL | DF/1→4% |
| 84716053 | 2103100 | APLICAVEL | DF/1→4%, DF/2→4%, ES/2→4%, MG/1→4%, MG/5→7%, SC/1→4% |
| 84716053 | — | APLICAVEL | SC/1→4% |
| 84717010 | 2103300 | APLICAVEL | DF/6→12%, ES/7→12%, PR/6→7% |
| 84717040 | 2103300 | APLICAVEL | PR/1→4% |
| 84719012 | 2103400 | APLICAVEL | MG/5→7%, MG/6→7%, PR/4→7% |
| 84719014 | 2103400 | APLICAVEL | GO/7→12% |
| 84733011 | 2103500 | APLICAVEL | MG/5→7% |
| 84733019 | 2103500 | APLICAVEL | MG/5→7% |
| 84733041 | 2103500 | APLICAVEL | ES/1→4%, PR/1→4%, PR/4→7% |
| 84733041 | — | APLICAVEL | ES/1→4% |
| 84821010 | — | CONFERIR | SP/0→—% |
| 85044021 | — | APLICAVEL | MG/5→7% |
| 85044040 | 2103800 | APLICAVEL | DF/4→12%, ES/4→12%, GO/2→4%, PE/4→12% |
| 85061019 | — | APLICAVEL | SC/1→4% |
| 85072010 | — | CONFERIR | SC/1→—%, SP/2→—% |
| 85076000 | — | APLICAVEL | SC/1→4% |
| 85171300 | 2105301 | APLICAVEL | DF/4→12% |
| 85176234 | 2108200 | APLICAVEL | PR/2→4%, PR/4→7% |
| 85176262 | 2108400 | APLICAVEL | SP/5→7% |
| 85176262 | — | APLICAVEL | SP/5→7% |
| 85176272 | 2105600 | APLICAVEL | SC/1→4% |
| 85176277 | 2111000 | APLICAVEL | DF/2→4% |
| 85182100 | 2105700 | APLICAVEL | SC/1→4% |
| 85182200 | 2105700 | APLICAVEL | DF/4→12% |
| 85183000 | 2105700 | APLICAVEL | DF/2→4%, MG/2→4%, SC/1→4% |
| 85258913 | 2110700 | APLICAVEL | PR/2→4% |
| 85258919 | 2110700 | APLICAVEL | MG/8→4% |
| 85258929 | 2106500 | APLICAVEL | SC/1→4% |
| 85285200 | 2106800 | APLICAVEL | DF/4→12%, ES/1→4%, ES/4→12%, GO/4→12% |
| 85285900 | 2106700 | APLICAVEL | ES/4→12% |
| 85286200 | 2106701 | APLICAVEL | SC/2→4% |
| 85291090 | — | CONFERIR | SP/0→—% |
| 85423190 | 2112600 | APLICAVEL | ES/6→12%, SC/6→7%, SC/7→7% |
| 85423190 | — | APLICAVEL | PR/7→7% |
| 85444200 | 1200700 | APLICAVEL | MG/0→7%, MG/1→4%, MG/8→4% |
| 85444200 | — | APLICAVEL | SP/0→7% |
| 85444900 | 1200700 | APLICAVEL | SC/0→7% |
| 90328911 | 2107800 | APLICAVEL | DF/4→12%, MG/4→7% |
