# Benefícios e isenções de ICMS no Simples Nacional

## Conferência normativa em 18/11/2026

A consolidação oficial do RICMS/BA, atualizada pelo Decreto 24.829/2026, mantém o art. 277: isenção de ICMS para microempresas do Simples cuja receita dos 12 meses anteriores ao PA não supere R$ 180 mil. No início de atividade, o parágrafo único determina receita proporcionalizada. Portanto, o critério não é simplesmente o faturamento do ano corrente. Fonte: [RICMS/BA, art. 277](https://mbusca.sefaz.ba.gov.br/DITRI/normas_complementares/decretos/decreto_2012_13780_ricms_texto_2021.pdf), página 168 do PDF.

O PGDAS-D tem as opções de isenção e redução específicas para ICMS/ISS do Simples. O benefício incide sobre a parcela do tributo, mantendo a receita e os demais tributos. Benefícios gerais de regimes normais não são automaticamente extensíveis ao Simples. Fonte: [Manual PGDAS-D, itens 6.6.8 e 6.6.9](https://www8.receita.fazenda.gov.br/SimplesNacional/Arquivos/manual/MANUAL_PGDAS-D_2018_V4.pdf).

## Alcance implementado

Motor `simples-nacional@14`. Cadastro em **Operações → Cadastros → Fiscal → Benefícios x Isenções**, disponível para ADMIN e COLABORADOR. Clientes não têm acesso à manutenção.

Esta parametrização atende benefícios gerais de **ICMS dentro do DAS, nos Anexos I e II**, por UF, receita, vigência e atividade. Transporte, benefícios por produto/NCM, habilitação individual, regimes especiais, ISS e tributos fora do DAS exigem modelagem própria. Não cadastrar uma norma com condições que não sejam representadas pelos campos disponíveis. Não foi realizada homologação das normas das outras 26 UFs.

Campos:

- Código estável e versão; descrição; UF; situação ativa/inativa.
- Isenção (100% da parcela de ICMS) ou redução de 0,01% a 100% dessa parcela.
- Comércio e/ou indústria.
- Base para aferir o limite: RBT12 usada na faixa (proporcionalizada no início), RBT12 real, receita do ano corrente incluindo PA, ou receita do ano anterior. Intervalos monetários incluem ambos os extremos.
- Exigência de ME, quando prevista. O motor confere receita do ano anterior até R$ 360 mil, proporcional ao número de meses se a abertura ocorreu naquele ano. Abertura ausente impede confirmar o benefício quando necessária. A completude do histórico continua sendo responsabilidade da conferência fiscal; ausência de documentos não comprova ausência de movimento.
- Primeiro e último mês de vigência, inclusivos; fundamento legal e URL HTTPS da fonte.

A carga inicial contém somente `BA_SN_ICMS_180MIL_2026`: Anexos I/II, base RBT12 da faixa, R$ 0,00 até R$ 180.000,00, somente ME, isenção de 100%, janeiro a dezembro de 2026. O fim em dezembro é o horizonte normativo validado nesta entrega, não uma afirmação de que o art. 277 foi revogado. A parametrização de 2027 exige revisão da legislação e das demais regras do motor para aquele ano.

## Cálculo e rastreabilidade

O cálculo normal de cada tributo é preservado. A redução do ICMS é aplicada à fração exata **antes** de arredondar o débito desse tributo a centavos. Uma isenção integral não redistribui ICMS para tributos federais. ST e impedimento pelo sublimite já retiram ICMS do DAS: não recebem um segundo desconto. A receita bruta, a RBT12 e o Fator R não são reduzidos pelo benefício.

`memoria_calculo.beneficiosIcms` guarda o texto e a versão da regra, UF, base do limite, receita alcançada, percentual, ICMS sem benefício e valor dispensado. Tela e PDF mostram o benefício e a opção correspondente no PGDAS-D. O campo de segregação pode ser `ICMS_ISENTO`; a monofasia de PIS/COFINS, quando existente, permanece segregada com dedução adicional de ICMS.

Não há acumulação automática de regras. Regras ativas com UF, atividades, vigência e limites sobrepostos são rejeitadas. Bases de receita diferentes no mesmo intervalo temporal/atividade são tratadas como potencial conflito. Salvamentos concorrentes usam o mesmo lock transacional, e o banco impõe tipos, percentuais, datas, UFs e unicidade de versão corrente.

Cada edição cria nova versão e registra auditoria. A versão anterior permanece armazenada; não há exclusão física pela tela. `versaoAnterior` impede sobrescrita por uma página desatualizada. A assinatura da configuração é salva na apuração; modificações nos benefícios da UF exigem recálculo antes do fechamento. Apurações fechadas preservam seus valores e memória. Alterações de documentos e históricos têm outros controles e limitações descritos na auditoria geral.

O teste com PostgreSQL também revelou que `apurar` consultava os itens em outra conexão antes do commit: a resposta podia vir sem itens. A leitura da resposta foi movida para depois do commit.

## Publicação

Na pasta `api`, com a conexão do ambiente de destino configurada:

```bash
pnpm db:migrate
pnpm db:seed:beneficios
```

A migration `0002_smiling_micromacro.sql` apenas cria a tabela, constraints e índices novos. Ela não altera documentos nem apurações. O seed é separado, idempotente e preserva revisões/inativações existentes; também preserva regra personalizada que conflite com a carga padrão. As seeds obrigatórias de instalação/restore incluem essa carga.

O script `db:seed:beneficios` carrega `.env` pelo Node; em produção, confira que a variável `DATABASE_URL` aponta para o mesmo destino usado na migration. Para executar a migration local usando `.env`, quando a variável ainda não estiver exportada:

```bash
node --env-file=.env node_modules/drizzle-kit/bin.cjs migrate
```

Depois publique API e frontend e recalcule os rascunhos afetados. Não regrave versões fechadas diretamente. Na conferência de uma empresa baiana elegível, o PGDAS-D deve receber a parcela da receita beneficiada em **ICMS → Isenção** ou **Redução**, conforme a norma cadastrada.

Exemplo de regressão: comércio de R$ 10.000,00 na primeira faixa gera R$ 400,00 antes do benefício. O ICMS de R$ 136,00 é dispensado, resultando em DAS de R$ 264,00. Os tributos federais e a receita permanecem iguais. O caso misto anteriormente comparado ao PGDAS-D passa de R$ 527,91 para R$ 526,01 quando se ativa a regra estadual: R$ 1,90 de ICMS do comércio deixam de ser devidos no cálculo auxiliar. Isso exige conferir a qualificação informada na declaração original; o teste anterior sem benefício continua preservado.

Não houve migration, seed ou alteração de dados em produção nesta implementação. A migração foi exercitada em PostgreSQL 17 descartável, partindo de banco vazio e também adicionando a tabela após inserir uma apuração fechada de teste. Não foi executada em branch Neon de produção.

## Verificação reproduzível

Testes unitários: limites inclusivos, proporcionalização, exigência de ME, outras UFs/vigências, conflitos, redução antes do arredondamento, ST, tributos federais preservados e bloqueio de fechamento após mudança da configuração.

Integração PostgreSQL: migration, apuração fechada preservada, seed repetido sem sobrescrita, versões/auditoria, cadastros concorrentes, constraints e gravação da apuração com isenção. Nunca usa `DATABASE_URL`; exige `SIMPLES_BENEFICIOS_TEST_URL` apontando para `127.0.0.1` ou `localhost`, banco `kontabb_beneficios_test`, descartável e inicialmente vazio.

```bash
SIMPLES_BENEFICIOS_TEST_URL=postgres://.../kontabb_beneficios_test pnpm exec jest src/fiscal/services/simples-beneficios.integration.spec.ts --runInBand
```

E2E: após build do frontend, execute `node scripts/prepare-beneficios-fixture.mjs` em `web`. Inicie `scripts/test-simples-beneficios-api.ts` em `api` com a mesma variável de teste. Esse módulo Nest usa o controller, validação, serviço e AuthGuard reais, com identidades fixas exclusivamente de teste e bind em `127.0.0.1:4319`. Não integra o módulo de produção.

```bash
# pasta api; não carrega .env
SIMPLES_BENEFICIOS_TEST_URL=postgres://.../kontabb_beneficios_test pnpm exec ts-node scripts/test-simples-beneficios-api.ts

# pasta web
SIMPLES_BENEFICIOS_TEST_API_URL=http://127.0.0.1:4319 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4319 pnpm exec playwright test tests/e2e/simples-beneficios.spec.ts
```

Os cenários cadastram e alteram uma regra real de teste em 375px e 1440px, verificam acesso da equipe, recusa de cliente/anônimo e rejeição de payload inválido. O banco de teste é descartado após o uso; as regras fictícias nunca devem ser importadas em produção.
