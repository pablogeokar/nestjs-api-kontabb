# Antecipação Parcial BA 2026: fundamentação do seed

Seed: `scripts/seed-antecipacao-parcial-ba-2026.cjs`
Dados: `scripts/data/antecipacao-parcial-ba-2026.enquadramentos.json` (123 enquadramentos)
Consulta às fontes: 14/11/2026. Situação: **rascunho** (`escopo_aprovado = false`), nenhuma linha com `confirmado_fiscalmente = true`.

## Escopo

As combinações vêm das entradas interestaduais de NF-e de clientes da BA no banco de desenvolvimento (293 itens, todos de 2026, todos de clientes do Simples Nacional), agrupadas pela mesma chave que o motor usa: NCM, CEST, regime, UF de origem e origem da mercadoria. Os 1.037 pares de `ncm-cest-unicos.csv` incluem saídas e entradas internas, que não são hipótese de antecipação parcial. Por isso ficaram fora.

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

## Limitações do motor que afetam o valor

1. **Redução de 20% do art. 274 do RICMS-BA:** vale para ME/EPP que recolhem no prazo, mas `apurarItemAntecipacaoParcial` não a aplica. O valor simulado fica 25% acima do valor com redução.
2. **IPI:** itens com IPI diferente de zero ficam pendentes por política do motor. A inclusão do IPI na base (art. 23, III) precisa de decisão fiscal.
3. **CFOP escriturado:** o motor só lê itens escriturados com CFOP 2102. Das 293 entradas interestaduais, só 7 estão com 2102; as demais mantêm o CFOP do emitente (6101/6102).
4. **DIFAL de entrada:** este seed não cadastra regra de DIFAL. O banco não tem entradas 2551/2556. Além disso, o motor trata ativo e uso/consumo com a mesma regra, enquanto o RICMS-BA, art. 272, I, "a", 2, dispensa o DIFAL na aquisição de ativo por ME/EPP.

## Evidências (SHA-256 do arquivo baixado em 14/11/2026)

- [RICMS-BA Anexo 1, redação 2026](https://mbusca.sefaz.ba.gov.br/ditri/normas_complementares/decretos/decreto_2012_13780_ricms_anexo_1_vigente_2026.pdf) `d009df80b3897e04377adc82a1a7c0f1ddbec3547a1da1cb69fef54516663b8e`. O link com `/DITRI/` em maiúsculas citado no prompt devolve 404.
- [RICMS-BA, alterações desde 2021](https://mbusca.sefaz.ba.gov.br/ditri/normas_complementares/decretos/decreto_2012_13780_ricms_texto_2021.pdf) `9cf243f7693e4d4f29050040a3261bcfac0afcc10400d589447b6278313bca82`
- [Lei 7.014/96 com notas](https://mbusca.sefaz.ba.gov.br/DITRI/leis/leis_estaduais/legest_1996_7014_icmscomnotas.pdf) `dfcf041095a7834484823c616f251b4612abad67d4c41f37438ad455c724f7a9`
- [Conv. ICMS 142/18](https://www.confaz.fazenda.gov.br/legislacao/convenios/2018/CV142_18) `ae6540b124d1be3653d8ec46ce98be0de93c07d8cd457f1107d0cafe90f0d23a`
- [Conv. ICMS 52/91](https://www.confaz.fazenda.gov.br/legislacao/convenios/1991/CV052_91), [Res. SF 22/1989](https://legis.senado.leg.br/norma/586152), [Res. SF 13/2012](https://legis.senado.leg.br/norma/586999/publicacao/15839317)

Os textos das fontes foram resumidos, não transcritos.

## Operação

1. Prévia: `node scripts/seed-antecipacao-parcial-ba-2026.cjs`
2. Gravar: `node --env-file=.env scripts/seed-antecipacao-parcial-ba-2026.cjs --execute`. O script é idempotente e aborta se houver outra vigência de Antecipação Parcial BA sobreposta a 2026.
3. Na tela, abrir **Cadastros → Fiscal → ICMS** com UF BA e competência **2026-01**. Salvar e homologar só funcionam na competência em que a vigência começa.
4. Para homologar, cada linha precisa de `confirmado_fiscalmente` e nenhuma pode estar em CONFERIR. Até lá, o cálculo sai como SIMULACAO e não entra no total, na guia nem na DeSTDA.

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