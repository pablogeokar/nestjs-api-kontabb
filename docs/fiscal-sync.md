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

## Resumos e manifestação de NF-e

Quando o Ambiente Nacional entrega `resNFe`, o sistema preserva o resumo como
NF-e `RESUMIDA`, com escrituração bloqueada e sem oferecer DANFE ou download do
XML completo. A sincronização envia automaticamente Ciência da Operação para
resumos ainda sem manifestação, registra o protocolo da SEFAZ e aguarda a
disponibilização do `procNFe`. Ciência não confirma a operação nem libera a
escrituração. O destinatário pode posteriormente registrar Confirmação,
Desconhecimento ou Operação não Realizada no painel.

Ciência e Confirmação feitas pelo painel acionam uma consulta pontual pela chave.
Na sincronização programada, o `procNFe` é procurado primeiro pela sequência de
NSUs. Quando ainda não está disponível, uma chave manifestada elegível é
reconsultada por ciclo. Tentativas de Ciência e de obtenção do XML têm horários
próprios persistidos, para impedir consultas repetidas e evitar que um resumo
antigo monopolize a fila. O XML completo substitui o resumo sem trocar a
identidade do documento.

Ciência não autoriza escrituração automática. A NF-e completa permanece não
escriturável até Confirmação. Desconhecimento e Operação não Realizada também
bloqueiam a escrituração como aquisição. A importação do XML entregue diretamente
pelo fornecedor continua disponível e não depende da distribuição.

## Concorrência e recuperação

O serviço reivindica atomicamente um lock por `(cliente_id, tipo_documento)` na
tabela `controle_nsu`. Uma segunda execução recebe `EM_ANDAMENTO` e não consulta
a SEFAZ novamente. O lock é liberado no `finally` e pode ser retomado após 15
minutos se o processo tiver sido interrompido antes da liberação.

A varredura percorre até 20 lotes por execução enquanto houver NSUs novos. O
cursor é salvo após cada lote completo. XML fiscal desconhecido, lote truncado
ou NSU inconsistente interrompem o avanço no último NSU persistido, permitindo
retomar sem perder notas. Após `cStat=137` ou `656`, a próxima consulta de
distribuição fica para pelo menos uma hora depois. O cron externo deve chamar a
sincronização a cada 24 horas; a API controla o intervalo mínimo permitido por
cliente. Resumos recebidos em um ciclo podem permanecer pendentes até a execução
seguinte, pois a disponibilização do XML completo após a Ciência é assíncrona.

Em banco novo, a baseline deve ser aplicada antes da versão da API que consulta
esses campos. Em banco existente, a alteração correspondente deve ter sido
aplicada pelo fluxo incremental do ambiente, incluindo as migrations `0001` e
`0002` que registram as tentativas de Ciência e de recuperação do XML.

## Erros e observabilidade

- Mensagens brutas do navegador, biblioteca fiscal ou infraestrutura não são
  exibidas ao usuário.
- Erros HTTP conhecidos usam o contrato público `code`, `message` e `requestId`.
- Os eventos `fiscal_sync_manual_triggered` e
  `fiscal_sync_manual_completed` registram duração, escopo e resultado sem dados
  fiscais sensíveis.
- O status de sincronização mostra quantos resumos ainda aguardam Ciência ou
  XML completo e os próximos horários de tentativa.
