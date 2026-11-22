# Foto e crachá do colaborador

## Contrato

O portal usa a sessão própria do colaborador. Todas as rotas abaixo exigem
funcionário ativo, token válido e troca da senha inicial. IDs de funcionário,
cliente e chaves de objetos nunca são aceitos no formulário.

| Rota | Resultado |
| --- | --- |
| `GET /api/colaborador/perfil` | Perfil com `fotoUrl` e `logoUrl`, ambas nullable; nunca retorna keys. |
| `GET /api/colaborador/foto` | `{ fotoUrl }`. |
| `POST /api/colaborador/foto` | Multipart com um único campo de arquivo `file`; retorna `{ fotoUrl }`. |
| `DELETE /api/colaborador/foto` | Remove a referência; retorna `{ fotoUrl: null }`. |
| `GET /api/colaborador/foto/imagem` | Bytes WebP da própria foto; 404 quando ausente. |
| `GET /api/colaborador/logo/imagem` | Logo JPEG, PNG ou WebP da própria empresa; 404 quando ausente. |

Uploads: JPEG, PNG ou WebP de até 2 MiB. A API valida MIME e magic bytes,
decodifica com limite de 25 milhões de pixels, rejeita animações, aplica a
orientação EXIF, limita a 768 × 768 sem ampliar e re-encoda em WebP sem metadados.
Leituras têm limite de 60/min e alterações de 10/min por funcionário, além do
limite global da API.

`fotoUrl` é uma URL relativa autenticada na própria origem, por exemplo
`/api/colaborador/foto/imagem?v=<versao-opaca>`. Essa escolha evita CORS do bucket
para canvas/WebGL e expiração de URLs assinadas durante a sessão. A imagem é
baixada pelo SDK da API; o bucket permanece privado. As respostas têm
`Cache-Control: private, no-store`. Não é necessário configurar domínio público,
novas variáveis ou CORS no R2 para as fotos.

A logo para o verso segue o mesmo acesso autenticado na própria origem, com
`private, no-store` e limite de 60 leituras/min por funcionário. O perfil retorna
`logoUrl: "/api/colaborador/logo/imagem"` quando a empresa possui logo; caso contrário,
`null`. Falhas do R2 retornam erro público estável e o frontend usa a KONTABB como
fallback. A URL assinada legada de `GET /api/colaborador/logo` permanece disponível.
Esse ajuste usa `clientes.logo_key` existente e não exige nova migration.

## Persistência e falhas

- Migration `0006_narrow_machine_man.sql` adiciona `funcionarios_rh.foto_key`,
  nullable e sem backfill. `NULL` ativa `/user.svg` no frontend.
- Cada foto recebe uma key imutável
  `clientes/{clienteId}/funcionarios/{funcionarioId}/fotos/{uuid}.webp`.
- A atualização da referência, a auditoria e o job de exclusão da foto anterior
  pertencem à mesma transação. Locks seguem empresa → funcionário para
  serializar substituições e exclusão da empresa.
- A exclusão de empresa adquire o lock antes da consulta que captura os arquivos,
  incluindo fotos confirmadas enquanto aguardava o lock. O cascade agenda as
  fotos na mesma operação que já agenda os documentos.
- Falha ao anexar uma foto gera compensação pela fila de storage. Antes de
  compensar, a API verifica se o objeto foi anexado, evitando apagar uma foto
  válida após um resultado ambíguo de COMMIT.
- Se o banco estiver indisponível também para registrar a compensação, o evento
  `colaborador_foto_compensation_failed` guarda a key para recuperação operacional.
  Antes de enfileirar essa key manualmente, confirme que nenhum funcionário a usa.
- Como PostgreSQL e R2 não compartilham transação, uma interrupção abrupta do
  processo entre upload e persistência pode deixar um órfão. A fila atual não
  varre o bucket; a reconciliação completa continua sendo uma tarefa operacional.
- Jobs de substituição e remoção são processados pelo cron existente de cleanup;
  falhas permanecem recuperáveis. Não apague o objeto antes de confirmar o banco.
- A auditoria identifica `atorTipo: COLABORADOR` e `funcionarioId` nos metadados;
  `ator_user_id` fica nulo porque o funcionário não pertence à tabela `user`.
- Importações de folha, férias e 13º mantêm a foto, pois seus upserts não alteram
  `foto_key`.

## Rollout

1. Instalar as dependências usando o lockfile (`pnpm install --frozen-lockfile`).
2. No ambiente de destino da API, aplicar `pnpm db:migrate` antes de iniciar a
   versão nova da API e do frontend. Na implementação, foi aplicada somente ao
   banco local de desenvolvimento identificado pelo `.env` da API, após confirmar
   que ela era a única migration pendente. Produção não foi alterada.
3. Publicar a API e depois o frontend. Não há novas variáveis de ambiente.
4. Conferir envio, atualização do avatar, substituição, remoção e fallback.
5. Monitorar `storage_cleanup_jobs` e os eventos `colaborador_foto_*`.

O backend requer o binário do `sharp` para a plataforma de deploy. Não omitir
dependências opcionais na instalação. Na reversão de código, manter a coluna e
os objetos evita perda de fotos; remover a coluna exige limpeza previamente
planejada do R2.

## Testes locais isolados

Os testes HTTP + PostgreSQL usam R2 em memória e só rodam quando uma URL local
de banco descartável, com nome terminado em `_test`, é explicitamente informada.
O arquivo de teste não lê `DATABASE_URL` nem usa `.env`.

```bash
docker run --detach --rm --name kontabb-foto-test-db \
  -e POSTGRES_PASSWORD=kontabb_test -e POSTGRES_DB=kontabb_foto_test \
  -p 127.0.0.1:15483:5432 postgres:17-alpine

COLABORADOR_FOTO_TEST_DATABASE_URL=postgres://postgres:kontabb_test@127.0.0.1:15483/kontabb_foto_test \
  pnpm exec jest src/colaborador/colaborador-foto --runInBand --silent

docker stop kontabb-foto-test-db
```

Os testes truncam os dados do banco descartável informado. Cobrem upload/leitura,
isolamento, sessão revogada/inativa, primeiro acesso, limites, rollback,
substituições concorrentes, retry do cleanup e cascade da empresa.

No projeto `web`, `pnpm exec playwright test --config playwright.colaborador.config.ts`
constrói a aplicação e sobe uma API HTTP de fixture na porta 43181 e o frontend
em HTTPS na porta 3100 (proxy local para 3101). Nenhum banco ou conta real é usado. A configuração normal de
Playwright ignora esses testes sem a configuração isolada.
