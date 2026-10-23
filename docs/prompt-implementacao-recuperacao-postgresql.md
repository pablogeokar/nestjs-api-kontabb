# Prompt de implementação — recuperação segura de backup PostgreSQL

Use este documento como o prompt de trabalho para implementar a rotina de
recuperação de banco pela interface administrativa do Kontabb. Antes de editar
o código, leia os padrões de arquitetura, autenticação, observabilidade e
persistência já adotados pela API e pelo frontend. Preserve mudanças não
relacionadas que já existirem no repositório.

## Missão

Implementar uma rotina administrativa, segura e auditável que permita a um
usuário com papel `ADMIN` restaurar um backup de dados PostgreSQL em um banco
**novo** ou de **recuperação explicitamente autorizado pela infraestrutura**.

O backup a restaurar é um arquivo `.sql.gz` data-only gerado pelo utilitário
`../Kontabb-backup-restore`. Um exemplo real é
`../kontabb-20261016-092828.sql.gz`. Esse tipo de arquivo contém dados `COPY`
e ajustes de sequences; ele não contém DDL nem objetos do Cloudflare R2.

A interface já possui a página `/admin/configuracoes`, na qual o bloco
"Recuperação do PostgreSQL" foi criado como uma base visual deliberadamente
inativa. A nova rotina deve transformar esse bloco em um fluxo real somente
depois de todos os controles abaixo estarem disponíveis na API.

## Resultado esperado

Ao final, um ADMIN deve conseguir:

1. Ver se a recuperação está habilitada e se há um destino de recuperação
   válido, sem receber host, nome interno, usuário, senha ou URL do banco.
2. Enviar um único arquivo `.sql.gz` dentro dos limites configurados.
3. Executar uma pré-análise que valide gzip, estrutura SQL permitida, tamanho
   expandido, tabelas esperadas, compatibilidade do schema e integridade que
   possa ser verificada sem mutar o banco.
4. Receber um resumo seguro da pré-análise: nome informado do arquivo, hash,
   tamanho comprimido/expandido, contagem por tabela quando disponível, schema
   esperado, pendências e avisos. Nunca mostrar conteúdo de linhas, dados de
   usuários, tokens, sessões, credenciais ou SQL completo no navegador.
5. Confirmar a operação em uma etapa separada, com reautenticação recente,
   frase de confirmação associada ao destino lógico e validade curta.
6. Acompanhar o job assíncrono de restauração com estados claros. O request HTTP
   que inicia o job não pode ficar aberto durante o restore.
7. Ver o resultado final, os passos pós-restauração executados e o identificador
   de auditoria. O usuário deve ser orientado a fazer login novamente, pois a
   tabela de sessões pode ser restaurada/truncada.

## Limites inegociáveis

- A funcionalidade manipula **somente PostgreSQL**. Não deve criar, remover,
  listar, mover, reconciliar ou alterar objetos, chaves, buckets ou URLs do
  Cloudflare R2.
- Não aceite URL de banco, host, porta, usuário, senha, schema, flags do
  utilitário ou caminho de executável vindos do navegador. O destino é definido
  somente pelo ambiente do servidor.
- Nunca use `DATABASE_URL` operacional como alvo apenas por conveniência. O
  restore deve ser recusado se o alvo for o banco em uso pela API, salvo se uma
  arquitetura de modo de recuperação separada tiver sido projetada, revisada e
  documentada explicitamente. A implementação padrão deve exigir um alvo
  distinto e marcado como recuperação.
- A operação só existe para `ADMIN`. A proteção do menu e do Next.js é apenas
  complementar: controller, service e execução devem reaplicar `AuthGuard` e
  `@AdminOnly()`.
- Não executar shell com string concatenada, `shell: true`, URL em argumento,
  input do usuário como argumento de processo ou SQL de backup diretamente por
  interpolação. Ao usar o executável Go, invocá-lo por caminho configurado,
  lista fixa de argumentos e `spawn`/`execFile` sem shell. Fornecer a URL do
  destino exclusivamente pelo ambiente do processo com
  `-database-url-from-env`.
- Não registrar arquivo, conteúdo SQL, CNPJ, e-mail, senha, token, cookie, URL
  de banco, chave R2 ou saída bruta do PostgreSQL. Logs e auditoria devem usar
  somente metadados mínimos, hash, tamanhos, IDs e códigos estáveis.
- Não usar o R2 como armazenamento temporário do backup. Se for necessário
  persistir o upload, usar um volume local/durável explicitamente configurado,
  com permissões restritas, expiração e remoção segura após o job.
- Não habilitar a rota por padrão em desenvolvimento, homologação ou produção.
  A ausência de qualquer configuração exigida deve resultar em status
  `DISABLED` e endpoints mutáveis devem responder com erro público estável.

## Contexto técnico existente

- API: NestJS + Drizzle, em `api/`.
- Frontend: Next.js, em `web/`; ele usa `/api/*` como proxy para a API. O
  frontend não pode acessar banco, Drizzle, executável Go ou variáveis secretas.
- Autorização: `src/auth/auth.guard.ts`, `src/auth/roles.decorator.ts` e
  `@AdminOnly()` já são o padrão para operações administrativas sensíveis.
- Observabilidade: usar `AppLogger` e os mecanismos de auditoria existentes;
  não usar `console.*` em código novo.
- Schema atual: `src/database/schema.ts`, com baseline
  `drizzle/0000_baseline_kontabb.sql`. A baseline deve ser aplicada antes de
  inserir dados em um banco vazio.
- Seeds: após um restore, executar `pnpm db:seed:required` para assegurar os
  catálogos obrigatórios sem substituir dados existentes. Não executar
  automaticamente `pnpm db:seed:admin` se o backup já possui administradores;
  essa seed só serve para instalação vazia sem restore.
- Utilitário existente: `../Kontabb-backup-restore`. Ele suporta restore
  transacional, `--dry-run`, validação referencial, `--schema public` e
  `-database-url-from-env`. Revise o código-fonte atual do utilitário antes de
  integrá-lo; não copie ou reimplemente seu parser sem testes de equivalência.

## Decisão arquitetural obrigatória antes do código

Escreva uma ADR curta em `api/docs/` antes ou junto da implementação,
explicando onde sobrevivem o estado do job, os eventos de auditoria e o arquivo
temporário enquanto o banco alvo está sendo truncado. Um registro dentro do
próprio banco alvo não é suficiente: o restore pode apagá-lo.

A solução deve separar claramente:

```text
Plano de controle (API, auditoria, estado do job)
        │
        ├── autoriza e acompanha
        └── nunca é truncado pelo job

Destino de recuperação PostgreSQL
        │
        └── recebe migration, preflight e restore transacional
```

São aceitáveis, por exemplo, uma base de controle distinta, um worker/serviço
de recuperação separado com armazenamento durável de estado ou uma fila
confiável fora do banco alvo. Não é aceitável confiar somente em memória,
`setTimeout`, um request HTTP aberto, storage do R2 ou uma tabela que o restore
apaga. Justifique a escolha, o comportamento após restart do processo e como o
operador retoma/consulta um job interrompido.

## Configuração de infraestrutura

Defina variáveis com nomes claros, valores seguros e documentação em
`.env.example`, README e documento operacional. Ajuste nomes se o padrão do
repositório exigir, mas cubra pelo menos os conceitos abaixo:

| Conceito | Exigência |
| --- | --- |
| Chave de habilitação | `DATABASE_RESTORE_ENABLED=false` por padrão; somente valor estrito habilita o fluxo. |
| Destino | URL exclusiva, secreta e somente do servidor, diferente da URL operacional. |
| Identidade esperada | nome lógico do ambiente, database/schema esperado e allowlist de host/identidade para rejeitar destino incorreto. |
| Marcador de recuperação | prova verificável no destino de que ele foi provisionado para recuperação; não confiar apenas no nome do banco. |
| Executável | caminho absoluto/validado do binário `kontabb-bkp`; falhar fechado se não existir ou não for executável. |
| Área de trabalho | diretório dedicado, fora de arquivos públicos, com permissões mínimas e política de expiração. |
| Limites | tamanho máximo comprimido, tamanho máximo expandido, máximo de linhas/bytes analisados, timeout e concorrência de jobs. |
| Estado externo | conexão/configuração do plano de controle escolhida na ADR. |

Na inicialização, valide a configuração sem expor segredos. O endpoint de
status deve informar apenas uma descrição segura, por exemplo
`enabled`, `targetConfigured`, `targetLabel`, `maxUploadBytes` e motivos
genéricos de indisponibilidade. Nunca devolver a URL, host, database real ou
caminho local.

## Contrato HTTP proposto

Projete DTOs estritos com `class-validator`, documentação Swagger, erros no
formato `{ code, message, requestId? }`, limite de taxa dedicado e mensagens
seguras. Ajuste os nomes ao padrão do projeto, preservando a semântica:

| Método e rota | Objetivo |
| --- | --- |
| `GET /admin/configuracoes/recuperacao/status` | Estado público seguro da capacidade de restore. Apenas ADMIN. |
| `POST /admin/configuracoes/recuperacao/preflight` | Recebe um `.sql.gz`, cria um artefato temporário controlado e devolve um `preflightId` com o resumo/avisos. Não muta o destino. |
| `POST /admin/configuracoes/recuperacao/jobs` | Cria job a partir de `preflightId` válido, token de confirmação de uso único e prova de reautenticação recente. Retorna `202` e `jobId`. |
| `GET /admin/configuracoes/recuperacao/jobs/:jobId` | Retorna somente o status e o resumo seguro do job. Apenas o ADMIN iniciador ou ADMIN conforme regra documentada. |
| `POST /admin/configuracoes/recuperacao/jobs/:jobId/cancel` | Cancelamento apenas se tecnicamente seguro antes do ponto irreversível; nunca prometer cancelamento depois que o restore iniciou. |

Se a arquitetura exigir outras rotas internas de worker, elas não podem ficar
expostas ao navegador e precisam de autenticação própria.

Use estados explícitos, por exemplo:

```text
DISABLED → UPLOADING → PREFLIGHT_RUNNING → PREFLIGHT_READY
→ AWAITING_CONFIRMATION → QUEUED → RUNNING
→ POST_RESTORE_SEEDS → SUCCEEDED | FAILED | CANCELLED | INTERRUPTED
```

Defina transições válidas, idempotência do pedido de criação e semântica para
tentativas/restart. O mesmo `preflightId` não pode disparar dois restores.

## Pré-análise obrigatória

A pré-análise deve acontecer antes de qualquer `TRUNCATE`, migration de dados ou
execução do restore real. Ela deve, no mínimo:

1. Exigir exatamente um arquivo e extensão `.sql.gz`; validar magic bytes gzip,
   não apenas MIME/type/extensão enviados pelo navegador.
2. Impor limites para arquivo comprimido e stream descomprimido, protegendo
   contra zip bomb, arquivo truncado e consumo ilimitado de memória/disco.
3. Fazer streaming; não carregar o backup inteiro em memória.
4. Aceitar somente a gramática data-only necessária ao formato produzido pelo
   utilitário: comandos `COPY` de tabelas permitidas no schema `public`, linhas
   de dados até `\\.`, ajustes de sequence esperados e comentários/metadados
   estritamente necessários. Rejeitar `CREATE`, `ALTER`, `DROP`, `GRANT`,
   `REVOKE`, `DO`, `SELECT` arbitrário, `\\!`, comandos psql, `SET` não
   permitido, referências a outro schema e qualquer token desconhecido.
5. Conferir que cada tabela referenciada existe no schema alvo/baseline e que
   não há tabela crítica ausente ou extra. A regra deve permitir tabelas vazias
   corretamente; ausência de `COPY` precisa ser tratada como dado verificável,
   não assumida como vazia sem contexto.
6. Calcular SHA-256 do arquivo e vincular o resultado ao `preflightId`, ao
   admin e ao destino lógico. A confirmação posterior só é válida para esse
   hash, esse alvo e por poucos minutos.
7. Executar o dry-run/validação do utilitário contra o destino já migrado, em
   conexão controlada. Confirme no código do utilitário que o dry-run sempre
   termina com rollback e permanece read-only.
8. Verificar que o destino recebeu a `0000_baseline_kontabb` compatível antes
   do restore. Não aplique migrations automaticamente de modo implícito: a
   interface deve expor a pendência e o procedimento deve ter uma etapa
   explícita, auditada e testada para isso.

O backup atual pode não trazer manifesto assinado. Preserve compatibilidade por
meio da pré-análise estrita acima. Para backups novos, projete um manifesto
assinado/versionado como melhoria futura, sem bloquear a recuperação legítima
do arquivo existente.

## Confirmação reforçada

Depois de um preflight aprovado, exija todos os itens abaixo:

- reautenticação do ADMIN ou prova de autenticação recente com duração máxima
  definida e testada;
- uma frase de confirmação exibida pelo servidor e vinculada ao rótulo lógico
  do destino, hash e expiração (por exemplo, `RESTAURAR RECUPERACAO`);
- token de confirmação de uso único, curto e assinado/armazenado no plano de
  controle;
- aviso explícito de que todas as tabelas do destino de recuperação serão
  truncadas de forma transacional antes da importação;
- aviso de que a sessão atual poderá ser invalidada e que será necessário novo
  login após a conclusão;
- bloqueio de concorrência: apenas um restore por destino pode estar em
  `QUEUED`, `RUNNING` ou `POST_RESTORE_SEEDS`.

Não use uma confirmação baseada apenas em `window.confirm`, flag de frontend ou
um texto não verificado no servidor.

## Execução do job

Implemente a execução fora do ciclo de request do controller. O worker deve:

1. Revalidar configuração, autorização registrada, hash, expiração, exclusão
   mútua e identidade do destino imediatamente antes de executar.
2. Verificar novamente o marcador de recuperação e recusar o banco operacional
   ou qualquer destino que não corresponda à allowlist configurada.
3. Chamar o binário Go por caminho configurado e argumentos fixos. Preferir
   `-mode restore`, `-input <arquivo-controlado>`, `-database-url-from-env`,
   `--schema public`, timeout explícito e os parâmetros de validação definidos
   pela política. Não aceitar flags do navegador.
4. Tratar stdout/stderr como informação operacional privada: capturar somente
   um resumo sanitizado e limitado para logs; não repassar saída bruta ao
   navegador.
5. Considerar o restore atômico do utilitário, mas não ocultar falhas de
   infraestrutura (processo morto, timeout, volume indisponível, conexão
   perdida). Registrar `INTERRUPTED` quando o resultado não puder ser provado.
6. Após sucesso do restore, executar as seeds obrigatórias por API/service
   interno ou rotina controlada equivalente. Não iniciar processo de shell com
   texto livre para rodar `pnpm`. A operação precisa ser idempotente e emitir
   resultado por etapa.
7. Verificar no destino o conjunto mínimo de invariantes: migrations esperadas,
   catálogos obrigatórios (incluindo E111/CIAP quando ausente), integridade
   referencial e disponibilidade do ADMIN. Se o backup não contém ADMIN, o
   procedimento deve parar em estado seguro e orientar o operador a criar o
   administrador pela seed/control-plane definido; não inventar senha nem
   elevar um usuário existente silenciosamente.
8. Limpar o arquivo temporário e dados derivados sempre, inclusive em timeout,
   falha e restart. A limpeza precisa ser recuperável/auditável se falhar.
9. Publicar o resultado no armazenamento de estado externo e gravar auditoria
   antes de declarar sucesso à interface.

## Auditoria, logs e privacidade

Para cada fase, registrar no plano de controle: `requestId`, `jobId`, admin
iniciador, data/hora, rótulo do destino, hash do arquivo, tamanhos, versão da
baseline/manifesto quando houver, transições de estado, duração, resultado e
código de erro seguro. Não guardar conteúdo do arquivo, SQL, valores de linhas
ou segredos.

Eventos de auditoria devem sobreviver ao truncamento do destino. A interface
deve usar mensagens públicas, tais como "A validação do backup falhou" ou
"O destino de recuperação não está disponível", enquanto o detalhe técnico
fica correlacionado por `requestId` para o operador autorizado.

## Alterações no frontend

Depois que a API estiver segura e testada:

- manter a rota `/admin/configuracoes` protegida por `requireAdminSession`;
- consumir o status inicial em Server Component por `web/lib/api.ts`;
- usar Client Component pequeno para upload, pré-análise, confirmação e polling
  de job por `web/lib/api-client.ts` com URLs relativas `/api/*`;
- nunca enviar destino de banco ou segredos; renderizar somente DTOs mínimos;
- manter acessibilidade: labels, erros próximos ao campo, foco em dialog,
  Escape, estado loading/disabled, feedback de sucesso/erro e navegação por
  teclado;
- explicar com precisão que o R2 não participa da restauração e que a sessão
  pode exigir novo login;
- não oferecer botão acionável quando a API responder `DISABLED` ou o destino
  não estiver pronto.

## Testes obrigatórios

Adicione cobertura proporcional ao risco, sem jamais apontar testes ao banco de
desenvolvimento ou produção:

1. Unitários para a política de configuração: disabled por padrão, alvo igual ao
   operacional recusado, allowlist/marcador inválido recusado, valores de limite
   inválidos e resposta de status sem segredo.
2. Unitários para o parser/validador streaming: gzip inválido, zip bomb,
   arquivo truncado, SQL proibido, schema/tabela extra, `COPY` válido, sequence
   válida, hash e expiração do preflight.
3. Matriz de autorização para `CLIENTE`, `COLABORADOR`, `ADMIN` e sem sessão em
   todas as rotas. Validar também que ADMIN não consegue confirmar preflight de
   outro usuário sem regra explícita.
4. Integração contra PostgreSQL efêmero: aplicar a baseline em banco vazio,
   rodar dry-run, restaurar fixture data-only, verificar rollback em erro,
   sequences, foreign keys e execução idempotente da seed obrigatória.
5. Testes do worker: processo do binário mockado, timeout, exit code diferente
   de zero, restart/interrupção, exclusão mútua e limpeza do temporário.
6. Testes de contrato HTTP: 413 para tamanho excedido, 415/422 para formato
   inválido, 403 para papel inválido, 409 para job concorrente/preflight já
   usado, 429 para limitação, e erros sem detalhes de infraestrutura.
7. Playwright no frontend: status desabilitado, upload/preflight válido,
   falha de validação, confirmação, acompanhamento de job e viewport móvel.

## Rollout e operação

1. Implantar primeiro a baseline e as variáveis, mantendo
   `DATABASE_RESTORE_ENABLED=false`.
2. Provisionar e marcar um banco de recuperação separado; validar identidade,
   conectividade, migration e permissões mínimas com dry-run.
3. Provisionar o executável Go e o volume de trabalho de forma imutável e
   revisável; não compilar ou baixar binário durante uma solicitação web.
4. Executar toda a suíte de testes, mais restore controlado com o arquivo de
   exemplo em banco descartável. Confirmar que o R2 não recebeu chamadas.
5. Habilitar somente em ambiente de recuperação, observar logs/auditoria e
   revisar o procedimento com um segundo ADMIN antes de habilitar produção.
6. Atualizar `docs/database-rebuild.md`, README, Swagger e runbook operacional
   com pré-requisitos, rollback, recuperação de job interrompido e pós-restore.

## Critérios de aceite

- Nenhum usuário não-ADMIN acessa dados, upload, preflight ou job de restore.
- Nenhum endpoint aceita ou revela conexão de banco.
- A rotina não realiza nenhuma chamada ou mutação ao R2.
- Um restore contra a URL operacional é bloqueado de maneira testada.
- Um backup inválido nunca chega ao `TRUNCATE`.
- O estado/auditoria do job permanece disponível mesmo se o destino for
  truncado ou a API reiniciar.
- O restore é assíncrono, exclusivo por destino, confirmável e rastreável.
- A baseline e as seeds obrigatórias são verificadas no fluxo operacional.
- Falhas devolvem erro público seguro e detalhes apenas por `requestId`/auditoria.
- Documentação, `.env.example`, Swagger e testes acompanham a mudança.

## Entrega esperada do implementador

Ao concluir, apresente: arquivos alterados, ADR da arquitetura escolhida,
contratos e variáveis adicionados, fluxos de falha tratados, migrations criadas
(se houver), comandos de validação executados, resultado do restore em banco
efêmero e passos manuais necessários para infraestrutura. Não marque a rotina
como pronta sem evidência de que o destino de recuperação é separado, o R2 fica
intocado e o estado do job sobrevive ao restore.
