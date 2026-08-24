# Sincronização fiscal com a SEFAZ

## Contrato operacional

`POST /api/admin/fiscal/sincronizar` executa a distribuição de NF-e e CT-e. A
operação pode persistir documentos antes de a resposta HTTP chegar ao navegador;
por isso, perda de conexão ou timeout não deve ser interpretado isoladamente como
falha da sincronização.

`GET /api/admin/fiscal/status` é a fonte de reconciliação. Cada controle de NSU
retorna, além do último resultado:

- `sincronizacao_em_andamento`;
- `sincronizacao_iniciada_em`;
- `ultima_consulta_em`, NSUs e retorno público da SEFAZ.

O frontend compara esse estado e a quantidade de documentos com o snapshot
anterior ao clique. Enquanto houver processamento ativo, acompanha a operação sem
iniciar outra consulta. Se a resposta original se perder, confirma o resultado
pela evolução do status, NSU ou total de documentos.

## Concorrência e recuperação

O serviço reivindica atomicamente um lock por `(cliente_id, tipo_documento)` na
tabela `controle_nsu`. Uma segunda execução recebe `EM_ANDAMENTO` e não consulta
a SEFAZ novamente. O lock é liberado no `finally` e pode ser retomado após 15
minutos se o processo tiver sido interrompido antes da liberação.

A migration `0005_acompanhamento_sincronizacao_fiscal.sql` deve ser aplicada
antes da versão da API que consulta esses campos.

## Erros e observabilidade

- Mensagens brutas do navegador, biblioteca fiscal ou infraestrutura não são
  exibidas ao usuário.
- Erros HTTP conhecidos usam o contrato público `code`, `message` e `requestId`.
- Os eventos `fiscal_sync_manual_triggered` e
  `fiscal_sync_manual_completed` registram duração, escopo e resultado sem dados
  fiscais sensíveis.
