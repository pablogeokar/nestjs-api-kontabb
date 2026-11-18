# Revisão do motor do Simples Nacional - 18/11/2026

## Resultado do caso de referência

Comparação entre a declaração PGDAS-D do PA 10/2026 e o demonstrativo Kontabb fornecidos pelo usuário. A validação foi feita localmente, com os valores dos documentos; não houve acesso ou alteração de banco de produção, transmissão, emissão de DAS oficial ou retificação.

| Informação | Demonstrativo anterior | Declaração oficial / motor 12 |
| --- | ---: | ---: |
| Receita do PA | R$ 8.845,56 | R$ 8.845,56 |
| Receita real dos meses anteriores | Não discriminada | R$ 4.460,95 |
| RBT12 proporcionalizada para a faixa | R$ 7.647,36 | R$ 7.647,34 |
| Folha anterior | R$ 2.000,00 | R$ 2.000,00 |
| Fator R considerado | 0,2615 | 0,44 |
| Serviços | Anexo V | Anexo III |
| DAS do comércio | R$ 5,59 | R$ 5,59 |
| DAS dos serviços | R$ 1.349,36 | R$ 522,32 |
| DAS total | R$ 1.354,95 | R$ 527,91 |
| Diferença a maior no demonstrativo | | R$ 827,04 |

A empresa tem sete meses anteriores ao PA (março a setembro), incluindo seis meses sem receita. A base da faixa é `4460,95 × 12 / 7 = 7647,34`, com arredondamento final. O Fator R é `2000 / 4460,95 = 0,4483...`, considerado `0,44`. O comércio também compõe o denominador: não se usa apenas a receita do serviço sujeito ao fator.

O PDF anterior informa abertura em 19/03/2026; a declaração informa 20/03/2026. Conferir o cadastro com o comprovante do CNPJ. O dia diferente não altera este PA porque o mês é o mesmo. Não foi presumida nem aplicada correção cadastral.

| Tributo | Comércio | Serviços | Total validado |
| --- | ---: | ---: | ---: |
| IRPJ | 0,31 | 20,89 | 21,20 |
| CSLL | 0,20 | 18,28 | 18,48 |
| COFINS | 0,71 | 66,96 | 67,67 |
| PIS/Pasep | 0,15 | 14,52 | 14,67 |
| CPP | 2,32 | 226,69 | 229,01 |
| ICMS | 1,90 | 0,00 | 1,90 |
| IPI | 0,00 | 0,00 | 0,00 |
| ISS | 0,00 | 174,98 | 174,98 |
| Total | 5,59 | 522,32 | 527,91 |

## Correções implementadas

- `simples-nacional.service.ts`: o Fator R recebe a receita real anterior, enquanto a seleção de faixa e a fórmula da alíquota continuam usando a receita proporcionalizada. A receita e a folha anteriores ficam limitadas ao mês de abertura e à janela móvel de 12 meses. O mês corrente só é base do Fator R no mês de abertura.
- `simples-calculador.service.ts`: truncamento da razão em duas casas; remoção do arredondamento da média mensal antes da multiplicação por 12. Preservadas as regras de folha/receita zero.
- `carregarFolhaPeriodo`: centraliza a sobrescrita manual também para o mês de abertura. Um zero manual é uma informação válida, sem somar novamente a folha automática.
- Memória JSON: `receitaBruta12mReal`, `receitaBaseFatorR`, `folhaBaseFatorR`, `periodoBaseFatorR` e `mesesAnterioresAtividade`. O campo legado `rbt12` continua representando a base usada na faixa para manter compatibilidade.
- PDF e frontend: identificam a RBT12 proporcionalizada e exibem as bases do fator. Apurações antigas continuam legíveis.
- Versão `simples-nacional@12`: a proteção existente de fechamento exige recálculo dos rascunhos anteriores. Não modifica apurações já fechadas.

A regra de Fator R foi conferida nos itens 8.2.1 e 8.3 do [Manual PGDAS-D, edição de 13/11/2026, aplicável a 2018-2026](https://www8.receita.fazenda.gov.br/SimplesNacional/Arquivos/manual/MANUAL_PGDAS-D_2018_V4.pdf) e no [art. 26 da Resolução CGSN 140/2018](https://normas.receita.fazenda.gov.br/sijut2consulta/link.action?idAto=92278). A regra de truncamento do manual vale a partir do PA 04/2018; o motor não foi homologado nesta revisão para reproduzir a forma histórica de arredondamento de 01/2018 a 03/2018.

## Fluxo examinado e limites da validação

| Etapa | Evidência no código / resultado |
| --- | --- |
| Acesso e parâmetros | Controllers autenticados; administração de tabelas exige perfil administrativo. Consultas fiscais filtram por cliente. Não foi realizado pentest. |
| Documentos | Receita por itens de saída autorizados; NFS-e usa competência declarada; CT-e usa escrituração própria. Notas canceladas, operações sem receita, devoluções e CFOP ambíguo têm tratamento específico e testes existentes. A qualificação econômica continua dependendo da documentação. |
| Histórico | Receita manual substitui a automática na competência anterior; folha manual também substitui. Ausência de dados pode continuar sendo interpretada como zero, conforme achado abaixo. |
| Início e faixa | Meses sem faturamento contam desde a abertura cadastrada. Primeiro mês anualiza o próprio PA; demais meses iniciais anualizam a média anterior. A partir de 12 meses anteriores usa a soma móvel. |
| Fator R | Corrigido e reproduzido neste caso; casos de zero e limite de 28% cobertos. Folha automática é uma aproximação, conforme achado abaixo. |
| Segregação | Dedução de ICMS-ST, PIS/COFINS monofásico e ISS retido; deduções combinadas no cálculo. Transporte troca ISS do III por ICMS do I. Mantidos testes de regressão existentes. |
| Partilha | Frações exatas até arredondar cada tributo; soma das parcelas forma o DAS. A amostra atual e os casos anteriores de indústria/transporte passam. Não equivale a validar todos os regimes especiais. |
| Sublimite | Resolver próprio usa receita anual e abertura; no caso, R$ 3,6 milhões × 10/12 = R$ 3 milhões. Testes existentes cobrem vigência do excesso. Não confundir com limite federal de permanência. |
| Gravação | Apurações e itens são versionados; tabelas históricas são preservadas. Novos campos ficam no JSON existente e dispensam migration. |
| Fechamento e guia | Verifica versão do motor, regime e pendências; cria fechamento e guia por serviços próprios. Há risco de histórico alterado após o rascunho, descrito abaixo. Guia interna não equivale ao DAS oficial do PGDAS-D. |

## Achados adicionais que permanecem abertos

Os itens abaixo foram identificados na revisão do código e não estão corrigidos pelo motor 12. A conferência desta amostra não homologa o motor para essas situações.

1. **P1 - Regime de caixa não usa recebimentos reais.** `dataReceitaDocumento(false)` usa emissão da NFS-e. Não há vinculação a recebimentos, parcelas ou baixa financeira na formação da base. Uma nota emitida em outubro e recebida em novembro pode entrar no mês errado. Implementar recebimentos segregados e impedir fechamento em caixa enquanto a base não for conciliada. A folha automática também usa competência da folha e soma bruto + FGTS; não comprova pagamento nem CPP efetivamente recolhida. O histórico manual deve registrar a base fiscal completa.

2. **P1 - Teto de ISS e faixas superiores incompletos.** `calcularItem` multiplica diretamente a alíquota pela partilha cadastrada. Na 5ª faixa do III, RBT12 de R$ 3 milhões resulta em alíquota de 16,812%; aplicar 33,5% dá ISS de 5,63202%, sem teto nem redistribuição. Há também regras específicas de ICMS/ISS quando a receita ultrapassa a 5ª faixa mas o impedimento ainda não produz efeitos. Implementar as fórmulas normativas antes de homologar esses cenários. O teto e a redistribuição constam dos [Anexos III e IV da LC 123/2006](https://www2.camara.leg.br/legin/fed/leicom/2006/leicomplementar-123-14-dezembro-2006-548099-normaatualizada-pl.html).

3. **P1 - Classificação de serviços por prefixos excessivamente amplos.** `anexoPorServico` trata todo CNAE iniciado em `85` como sujeito ao fator, inclusive casos de ensino com tributação direta no III; o prefixo `69` também pode confundir serviços contábeis com outras atividades. A lista LC 116 não define sozinha todas as hipóteses. Substituir por enquadramento explícito por atividade, com exceções e fundamento normativo. O enquadramento de ensino de esportes desta amostra coincide com a declaração, mas não valida os demais CNAEs. Ver [art. 18, §§ 5º-B, 5º-C e 5º-D, da LC 123](https://www2.camara.leg.br/legin/fed/leicom/2006/leicomplementar-123-14-dezembro-2006-548099-normaatualizada-pl.html).

4. **P1 - Limite federal e exclusão não têm resolução temporal equivalente ao sublimite.** `selecionarFaixa` rejeita RBT12 acima de R$ 4,8 milhões, mas isso não substitui analisar RBA/RBAA, limite proporcional de abertura, tolerância e efeitos da exclusão. Acrescentar resolução própria e cenários de excesso. Exportações e múltiplos estabelecimentos também precisam de bases e limites separados; não foram homologados nesta amostra. CFOP de exportação já gera revisão, mas isso não constitui segregação completa.

5. **P1 - Histórico incompleto e abertura ausente podem produzir resultado aparentemente válido.** A data de abertura ainda é inferida pela primeira receita quando não cadastrada; meses sem documento/manual viram zero. Empresa antiga com importação parcial pode parecer recém-aberta. Exigir abertura confirmada e distinguir mês sem movimento confirmado de mês sem dados. A folha deve incluir pró-labore e encargos efetivamente pagos, sem duplicar retenções de empregado. Conferir receitas e folha de todos os meses desde a abertura no caso presente.

6. **P1 - Rascunho pode ficar desatualizado após mudança do histórico.** `fechar` verifica versão e regime, mas não compara novamente documentos, folha, abertura e histórico com a base do rascunho. `apurar` calcula antes de iniciar a transação de gravação; leituras também podem refletir momentos diferentes. Implementar detecção de mudanças ou instantâneo consistente antes de fechar. Até lá, recalcular após qualquer ajuste e revisar competências seguintes. A idempotência da guia não resolve sozinha as corridas entre recálculo e fechamento.

7. **P1 - Vigência de 2027 exige implementação própria.** O código já força competência em 2027, mas mantém o algoritmo anterior de início de atividade. Não basta cadastrar nova tabela: mudanças de janela, fator, faixas e partilha precisam de resolução por vigência e testes próprios. A seed atual termina em 2026. Ver a [publicação oficial sobre a Resolução CGSN 190/2026](https://www8.receita.fazenda.gov.br/SimplesNacional/noticias/NoticiaCompleta.aspx?id=e595d010-1e04-4c3b-95d9-185fc58594b5). Não aplicar retroativamente regras de 2027 ao PA 10/2026.

## Aplicação e conferência

1. Publicar API e frontend com motor 12. A correção de fator não exige seed ou migration; qualquer atualização normativa pendente deve seguir o procedimento operacional existente.
2. Conferir a abertura com o comprovante do CNPJ e a completude dos históricos de receita e folha, incluindo os meses sem movimento.
3. Recalcular o rascunho de 10/2026: receita real R$ 4.460,95, proporcionalizada R$ 7.647,34, fator 0,44, serviços no III e DAS R$ 527,91.
4. Revisar outros rascunhos de empresas em início de atividade. Para apurações fechadas, avaliar retificação fiscal; não alterar versões históricas diretamente.
5. Se receitas/folha anteriores mudarem, revisar também os PAs posteriores afetados. Comparar com o PGDAS-D antes de transmitir.

## Verificação local

- Testes do domínio Simples: 6 suítes, 132 testes aprovados, incluindo valores por tributo da declaração, primeiro mês, sobrescrita manual zero, truncamento próximo de 28%, anualização e janela de 12 meses.
- Frontend Simples: 3 arquivos, 12 testes aprovados; mais 4 verificações Playwright do componente renderizado em 375px e 1440px. Lint dos arquivos alterados, checagem TypeScript e build aprovados.
- API: build aprovado. A checagem TypeScript global aponta erro existente em `src/cron/cron.controller.spec.ts:13` (construtor com 6 argumentos, exigidos 7).
- Suíte geral API: 2.436 testes aprovados e 2 falhas em testes não alterados (`clientes.service.spec.ts` e `icms-regras-homologar.spec.ts`). Suíte geral frontend: 292 aprovados e 2 falhas em `admin-fiscal-difal.test.ts`, também não alterado.
- Esta revisão não executou teste E2E autenticado nem alteração de dados reais.
