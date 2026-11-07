# Revisão da receita do Simples Nacional (motor 3)

O motor usa os itens de NF-e/NFS-e de saída autorizada para formar a receita do mês e o histórico automático do RBT12. O valor fiscal total do documento não é distribuído entre itens. O valor líquido elegível de cada item considera produto/serviço, frete, seguro e outras despesas, menos o desconto informado no item.

CFOPs de bonificação e amostra grátis (5910/6910 e 5911/6911), transferências e remessas sem venda não compõem a receita automática. CFOPs de venda reconhecidos permanecem na base. CFOPs ambíguos, como simples faturamento para entrega futura (5922/6922) e outras saídas genéricas (5949/6949), geram pendência para análise fiscal. A natureza real da operação prevalece sobre o código quando houver contraprestação ou condição futura.

O cálculo audita notas de saída sem itens, CFOPs sem classificação segura, valores líquidos negativos e divergência entre a soma dos itens de receita e o total de uma nota composta apenas de itens de receita. Pendências impedem o fechamento. Receitas manuais informadas no histórico substituem a receita automática da respectiva competência e dispensam a auditoria documental histórica daquele mês.

A base automática da folha para o Fator R passou a usar remuneração bruta e FGTS. O valor de INSS extraído da folha pode ser retenção do empregado e não é somado outra vez. Contribuição patronal efetivamente recolhida no DAS, pró-labore ausente das folhas e o critério de pagamento em caixa precisam ser completados por valores manuais no histórico quando aplicável. O sistema não dispõe de dados suficientes para inferir essas parcelas com segurança.

A primeira competência de atividade ainda é inferida da primeira receita disponível, pois não há data de início de atividade fiscal no cadastro. Para empresas migradas com documentos incompletos, preencha o histórico manual dos 12 meses anteriores antes de usar a alíquota proporcional e o Fator R.

Rascunhos do motor anterior precisam ser recalculados antes do fechamento. Apurações fechadas permanecem imutáveis e devem ser revisadas e retificadas pelo fluxo fiscal quando afetadas. O valor mostrado pelo sistema é uma memória de apoio; o PGDAS-D continua sendo o meio oficial de declaração e geração do DAS.

## Precisão da partilha (motor 4)

No PA 09/2026 de referência, a receita de R$ 58.837,00 e o RBT12 de R$ 741.731,29 coincidiam com o PGDAS-D, mas o motor 3 arredondava a alíquota efetiva para 8,17% antes da tributação. Isso gerava R$ 4.806,98 em vez dos R$ 4.804,95 declarados. O motor 4 mantém a fração exata da fórmula no cálculo de cada tributo, arredonda cada parcela a centavos e soma as parcelas para obter o DAS. A alíquota mostrada em tela/PDF continua resumida para leitura e não é reutilizada como entrada do cálculo.

## Partilha do Anexo III para transporte (motor 7)

No PA 10/2026 da MINAS BAHIA CARGO LTDA, a receita de R$ 47.827,27 e o RBT12 proporcional de R$ 573.927,24 já coincidiam com o PGDAS-D. A versão anterior da tabela normativa, porém, repetia a partilha da 1ª faixa do Anexo III nas faixas 2ª a 4ª. Na 3ª faixa, aplicava COFINS de 12,82% e PIS/Pasep de 2,78% da alíquota efetiva, em lugar de 13,64% e 2,96%. O erro reduzia o DAS em R$ 49,87. A versão `LC_155_2016_REV_2026_11` contém os percentuais legais de cada faixa; o seed desativa a versão anterior e a preserva para apurações históricas. Execute `pnpm db:seed:simples` no ambiente de destino e recalcule as apurações em rascunho geradas pelo motor anterior. Apurações fechadas exigem revisão pelo fluxo de retificação.

A declaração oficial também mostra sublimite proporcional de R$ 900.000,00 no ano de abertura (outubro a dezembro de 2026), enquanto o relatório auxiliar anterior exibia o valor anual de R$ 3.600.000,00. O motor 8 passa a ler a data de abertura do CNPJ e o sublimite anual cadastrado por UF/ano, aplica a proporção no ano inicial, compara a receita acumulada no ano e considera o efeito temporal do excesso de 20%. A tabela de sublimites pode ser mantida na área administrativa. Um ano/UF sem valor ativo bloqueia a apuração em vez de usar um valor presumido. Quando a data de abertura não estiver cadastrada e a receita anual superar R$ 300.000,00, o rascunho recebe pendência para conferência. Receitas de exportação e hipóteses de tributação estadual fora do DAS continuam exigindo análise fiscal própria.

## Referências oficiais

- [Perguntas e Respostas do Simples Nacional, item 3.15](https://www8.receita.fazenda.gov.br/SimplesNacional/Arquivos/manual/PerguntaoSN.pdf)
- [Resolução CGSN nº 140/2018, arts. 2º, 17 e 26](https://normas.receita.fazenda.gov.br/sijut2consulta/link.action?idAto=92278)
- [Manual do PGDAS-D](https://www8.receita.fazenda.gov.br/SimplesNacional/Arquivos/manual/MANUAL_PGDAS-D_2018_V4.pdf)
