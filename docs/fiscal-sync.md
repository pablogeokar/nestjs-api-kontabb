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

### Importação por lista de chaves

#### Recuperação assistida de XML

Os endpoints administrativos `POST /admin/fiscal/recuperacao-portal/preparar` e
`POST /admin/fiscal/recuperacao-portal/importar` atendem a recuperação assistida no próprio Kontabb.
O primeiro valida NF-e modelo 55 e remove XMLs completos já existentes, sem
consultar a SEFAZ. O segundo recebe `arquivo`, `clienteId` e `chave`, exige o XML
processado correspondente e usa o importador existente com empresa fixa.
Na prévia de importação por chaves, `fora_janela_sefaz` e
`recuperacao_portal_necessaria` separam as notas antigas das consultas possíveis;
um lote exclusivamente antigo não exige certificado cadastrado para ser
classificado, pois não chama a SEFAZ.
Ambos exigem sessão da equipe e rate limit. O navegador envia o XML diretamente
à API, que mantém as regras existentes de empresa, duplicidade e auditoria.
Não há servidor local, automação do portal ou migration. Consulte
`web/docs/portal-recovery.md` no frontend para operação e limites do portal.

#### Distribuição e recuperação assistida

- A prévia de TXT/CSV/XLSX informa a janela de 90 dias e o limite de 20 consultas
  por hora do serviço `consChNFe`. Como a chave só contém mês/ano, apenas meses
  inteiramente anteriores à janela são encaminhados à recuperação assistida
  antes da chamada externa.
  O resultado `RECUPERACAO_PORTAL_NECESSARIA` indica uma pendência, não uma
  comprovação de indisponibilidade do XML. A UI oferece a consulta no Portal
  Nacional, cópia individual das chaves e exportação TXT. O usuário conclui o
  hCaptcha no portal e, quando disponível, baixa o XML original usando seu
  certificado no navegador. O painel do Kontabb acompanha a pasta de downloads
  autorizada no Edge ou Chrome e envia o XML da chave atual à API, com seleção
  manual como alternativa. Este fluxo é assistido: não é um robô de download e não utiliza
  serviços pagos. A recuperação automática de notas antigas ainda não foi
  validada. O certificado guardado pela API não é instalado no navegador.
  A contagem `recuperacao_portal` é separada de `nao_localizados`.
- `SefazConsultaControlService`, usado pelo `NfeWizardService`, reserva até 20
  slots de uma hora em `app_rate_limits`, por CNPJ/ambiente. As reservas são
  atômicas com advisory lock transacional e compartilhadas entre importações,
  recuperações pós-manifestação, processos e reinícios. Não há migration nova.
  Uma tentativa enviada ocupa o slot mesmo se a resposta falhar, por precaução.
- O retorno 656 (objeto ou exceção da biblioteca) persiste uma suspensão de uma
  hora para consultas NF-e por chave e por distribuição. Recusas locais não
  prorrogam essa suspensão. Bloqueios legados de `controle_nsu` também são lidos.
  Outros aplicativos que consultem o mesmo CNPJ podem consumir a cota ou renovar
  o bloqueio; o sistema não consegue contabilizar antecipadamente essas chamadas.
- `ADIADO_LIMITE_CONSULTAS` diferencia a prevenção local da rejeição da SEFAZ.
  `proxima_tentativa_em` informa quando reenviar as chaves adiadas. O lote não
  fica aberto por horas e não é retomado automaticamente após fechar a janela.
- Falhas de comunicação e rejeições fiscais não são apresentadas como prova de
  certificado inválido. Uma falha inesperada interrompe as consultas restantes;
  somente a chave tentada conta como falha, e as demais aparecem como
  `NAO_PROCESSADO_FALHA_LOTE`. O log informa a etapa da falha sem gravar XML,
  certificado ou resposta fiscal. O identificador da requisição permanece no
  resultado para diagnóstico.

No desenvolvimento local, `ECONNREFUSED 127.0.0.1:9` indica que o processo da
API herdou um proxy de rede de bloqueio e não alcançou a SEFAZ. Nesse caso,
reinicie a API em um ambiente com saída HTTPS autorizada; não altere a
validação TLS ou o certificado A1 para tentar corrigir essa falha.

Referência: [regras oficiais de uso da distribuição DF-e](https://www.nfe.fazenda.gov.br/portal/informe.aspx?AspxAutoDetectCookieSupport=1&Informe=0cu%2FyBLKrCs%3D&ehCTG=false).

- Mensagens brutas do navegador, biblioteca fiscal ou infraestrutura não são
  exibidas ao usuário.
- Erros HTTP conhecidos usam o contrato público `code`, `message` e `requestId`.
- Os eventos `fiscal_sync_manual_triggered` e
  `fiscal_sync_manual_completed` registram duração, escopo e resultado sem dados
  fiscais sensíveis.
- O status de sincronização mostra quantos resumos ainda aguardam Ciência ou
  XML completo e os próximos horários de tentativa.
