# Escrituração inteligente — modelo determinístico v1

A classificação sugere destinação pelo perfil do cliente e aprende somente com confirmações explícitas. Não usa LLM externo nem envia XMLs a terceiros.

## Decisões e limites

- Campo manual `destinacao_mercadoria` preservado. `destinacao_inferida`, `destinacao_origem`, `destinacao_confianca` e `destinacao_justificativa` registram evidência e sugestão. A API adiciona `destinacao_efetiva`, sem alterar os campos antigos.
- Sugestões CNAE × NCM são sempre revisáveis (pontuação 0,65; perfil misto 0,45). Não inferimos ativo só pelo NCM nem direito a crédito pelo regime.
- Histórico com três documentos distintos autorizados, mesma empresa, fornecedor, código de produto e NCM, e uma única destinação recebe pontuação 0,95. Pontuações são limiares de política, não probabilidades calibradas. Produtos com múltiplas destinações ficam pendentes, mesmo com maioria expressiva.
- Uma evidência por item, com PK e upsert transacional, torna retries idempotentes. Correção atualiza a evidência; AUTOMATICA a remove. Item com CFOP manual não alimenta a inferência de outros itens. Cancelamentos são excluídos na leitura do histórico.
- Regras de destinação são critérios, não fatos. Manual precede automação; regras compatíveis podem fornecer CSTs. O catálogo valida CFOP ativo, sentido e abrangência antes de aplicar regras.
- Inferência restrita às famílias comuns de compras. Devoluções, remessas, transferências e operações especiais conservam o fluxo específico. Variantes ST: 401/403/406/407. ST em importações não é convertida automaticamente.
- IPI não é autorizado automaticamente apenas por categoria. As flags de CIAP/DIFAL indicam necessidade de tratamento, não geração ou pagamento automático de guia/crédito.
- Reimportação de XML completo retorna DUPLICADO sem apagar/recriar itens. Para aplicar novas regras, usar reprocessamento explícito.
- Reprocessamento preserva CFOP manual e detecta conflitos pela versão textual completa do timestamp PostgreSQL (sem perda de microssegundos). Em conflito, a transação inteira reverte e retorna HTTP 409.

## Catálogo e interface

`cst-catalogo.ts` contém ICMS, CSOSN, origem 0–8, IPI e PIS/COFINS, incluindo monofásicos de combustíveis. Catálogo estático versionado oferece consulta O(1), dispensa seed e elimina dependência de rede durante a escrituração. Código desconhecido mantém seu valor e aparece sem descrição disponível.

CFOP escriturado e original consultam o catálogo existente por joins na listagem; não há consulta por item. A interface apresenta código + descrição, motivo, origem e confiança, e recarrega os dados após alterações para evitar CST/CFOP desatualizados. Administradores e clientes possuem endpoints separados com validação de escopo.

Não foi criado catálogo completo de NCM: carga oficial, vigência e atualização exigem política própria. O NCM segue disponível como código e como evidência auxiliar.

## SPED

CST ICMS/CSOSN ausente ou inválido gera inconsistência impeditiva com documento/item. O builder não fabrica `000`. CSOSN do fornecedor em entrada requer CST sob enfoque do declarante e bloqueia exportação até tratamento por regra. O agrupamento C190 e os controles de crédito permanecem no builder existente.

Essas proteções não substituem validação no PVA e revisão fiscal por competência. Não há garantia de ausência universal de rejeições.

## Rollout

1. Aplicar a migração `0007_escrituracao_inteligente.sql` pelo runner Drizzle (`pnpm db:migrate`) em banco isolado e depois em ambiente representativo. Migração aditiva: tabela de evidências, campos nullable de inferência/auditoria e flag manual default false. Conferir tempo/locks na tabela de itens antes da produção; o ALTER TABLE exige lock.
2. Implantar API e depois frontend. Não ativar API nova antes da migração.
3. Conferir o catálogo CFOP existente; se necessário, executar o seed versionado `pnpm db:seed:cfops` no ambiente escolhido, avaliando previamente os valores customizados que o seed atualiza.
4. **CFOPs editados antes desta migração não tinham marcador persistido.** Identificar decisões anteriores nos logs `fiscal_cfop_item_editado` e reconfirmá-las pela UI antes do reprocessamento. A destinação manual anterior já possuía campo próprio e é preservada. Não há backfill que finja distinguir equivalência automática de alteração humana.
5. Reprocessar primeiro uma competência de teste pelo fluxo administrativo existente, comparar pendências, CFOPs, CSTs, C190/E510 e créditos. Confirmar a destinação em documentos reais revisados; novas importações passam a usar as evidências.
6. Validar o arquivo no PVA correspondente à competência. Só então repetir por cliente/competência em produção.
7. Rollback de aplicação: os campos novos são aditivos e podem permanecer; preservar a tabela de evidências. Versão antiga não conhece a proteção `cfop_manual`, portanto suspender reprocessamentos durante rollback.

## Fontes consultadas em 06/09/2026

- [LC 87/1996, arts. 20 e 33](https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp87.htm): crédito, ativo e uso/consumo (art. 33, I: entradas a partir de 2033).
- [Guia Prático EFD ICMS/IPI 3.2.0, portal da Receita](https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/manuais/sped/manuais-efd-icms-ipi/versao-atual/guia-pratico-efd-versao-3-2-0.pdf): CST sob enfoque do declarante, C170 e tabelas IPI.
- [IN RFB 1.009/2010, DOU de 11/02/2010](https://www.gov.br/mme/pt-br/arquivos/do-11-02-2010-s1.pdf/@@download/file): tabelas IPI, PIS e COFINS.
- [Portal NF-e — Simples Nacional](https://www.nfe.fazenda.gov.br/PORTAl/perguntasFrequentes.aspx?AspxAutoDetectCookieSupport=1&tipoConteudo=S%2FEAGUrzRyk%3D): descrições CSOSN.
- [NT 2023.001 v1.51](https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=nyszXJzXYlk%3D): CST monofásicos 02/15/53/61.
- [SEFAZ-SP, RC 26116/2022](https://legislacao.fazenda.sp.gov.br/Paginas/RC26116_2022.aspx): distinção 1551/2551/3551 e 1406/2406 para ativo.

As referências sustentam as descrições e controles conservadores. Não constituem motor de enquadramento legal completo por UF, produto, benefício e vigência.
