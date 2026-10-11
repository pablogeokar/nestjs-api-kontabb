# Entrega, conciliação e operação fiscal (Fase 5)

Fase operacional que fecha o ciclo fiscal: separa obrigação, guia, pagamento e
conciliação com trilha; registra a entrega da obrigação acessória com
homologação/transmissão/recibo e retificação sem sobrescrever o histórico; e
instrumenta a cobertura por estabelecimento e os critérios de rollout.

Nenhum cálculo novo é introduzido aqui — o foco é **rastreabilidade,
conciliação e liberação segura** sobre a apuração versionada da Fase 3
(fechamento com hash).

Base normativa: **N02** (Ajuste SINIEF 2/2009 — guarda, assinatura,
retificação), **N05** (PVA 6.1.1 — confirmar a versão operacional na
homologação), **N03/N04** (leiaute por vigência: 2026 vs. 2027).

Restrições preservadas: só `arquivo_key`/`recibo_key`/`comprovante_key` no banco
(URLs assinadas sob autorização); compensação do objeto de storage em falha;
nunca enviar documento fiscal por e-mail; nunca retificar automaticamente
obrigação já transmitida.

## Guias conciliadas com histórico (R1)

A guia deixa de ser um registro cujo pagamento era uma mudança de status e cuja
remoção era delete físico. Quatro conceitos são separados:

1. **obrigação calculada** — vem do fechamento (versão de apuração da Fase 3);
2. **guia emitida** — `fiscal_apuracoes_guias`, com vínculo à versão de apuração;
3. **pagamento** — evento na trilha, nunca sobrescrita de status;
4. **conciliação** — comparação da guia com a obrigação apurada.

### Trilha de pagamento append-only (R1.3, R1.4)

A tabela `fiscal_pagamentos_eventos` é **append-only**: cada pagamento (total ou
parcial) e cada estorno é um evento imutável, nunca uma sobrescrita. O saldo da
obrigação é sempre **reconstruído** da trilha, nunca persistido como um número
que se sobrescreve:

```
saldo = valorTotal(guia) − Σ(sinal · valor)
```

`sinal` é `+1` para pagamento/pagamento parcial e `-1` para estorno. A ordem dos
eventos não altera o saldo final, a trilha é sempre reconstruível e um estorno
devolve exatamente o valor que o pagamento retirou. O núcleo
(`projetarSaldoObrigacao`) é puro e determinístico. Checks no banco impõem o
domínio: `tipo ∈ {PAGAMENTO, PAGAMENTO_PARCIAL, ESTORNO}`, `valor > 0`, estorno
sempre com `sinal = -1` e referência obrigatória ao evento estornado
(`evento_estornado_id`).

O cancelamento de uma guia é **lógico** (status), nunca delete físico — o
histórico relevante é preservado (R1.4).

### "PAGO" exige evidência (R1.5)

Registrar uma guia **não** significa que ela foi emitida no órgão arrecadador.
Um evento de pagamento só é aceito com `comprovante_key` (evidência no storage)
**ou** `declaracao_manual = true` (indicação explícita de declaração manual),
imposto por check no banco. Estorno é a única exceção (devolve, não quita).

### Divergência da obrigação (R1.2)

`compararGuiaComObrigacao` sinaliza a guia quando `|guia − obrigação|` excede a
tolerância de centavos (R$ 0,02). A **obrigação não é recomputada**: vem do
snapshot congelado do fechamento, projetado pelo mesmo contrato que
livros/painéis/SPED consomem (`obrigacaoDoFechamento` →
`projetarSaldoDevedorApurado`). A sinalização é informativa: não bloqueia a
emissão (uma guia pode divergir legitimamente por multa/juros), apenas marca
para a conciliação e o cockpit destacarem.

### Idempotência sem bloquear obrigações legítimas (R1.6, R1.7)

A idempotency key evita duplicidade por retry, mas **não** impede múltiplas
obrigações legítimas por tributo/período/UF. Toda guia tem vínculo à versão de
apuração (`fechamento_id`), amarrando-a ao fechamento que a originou.

## Entrega, homologação, transmissão e retificação (R2)

`fiscal_entregas` persiste cada entrega de obrigação acessória
(`EFD_ICMS_IPI`, `EFD_CONTRIBUICOES`, `GIA`, `DAS`, `DAPI`): `arquivo_key`,
`hash_arquivo` (SHA-256 hex), `pva_programa`/`pva_versao`, status de validação,
assinatura, `protocolo_numero`, `recibo_key`, `leiaute_versao`, vínculo de
retificação (`entrega_original_id`) e vínculo à versão de apuração
(`fechamento_id`). Só keys do storage no banco, nunca URLs.

### Recibo amarrado ao hash do fechamento (R2.4)

Quando a entrega referencia uma versão de apuração (`fechamento_id`), o
`hash_arquivo` **deve** ser o `hash_entradas` daquele fechamento. Isso impede
selar um recibo/comprovante sobre um arquivo divergente da apuração que ele
declara.

### Retificação sem sobrescrever (R2.2)

`retificarEntrega` cria uma entrega **nova** que aponta a original
(`entrega_original_id`), carrega a `valor_diferenca` e tem o seu próprio recibo.
A entrega anterior permanece **imutável** — nunca é atualizada nem apagada.
Regras de trilha:

- retifica-se a entrega-base, não uma retificadora (sem encadeamento);
- uma entrega já superada (que já é origem de outra retificadora) não pode ser
  retificada de novo;
- obrigação e competência da retificadora são herdadas da original.

### Falha de storage pós-snapshot (R2.3)

A geração do snapshot da entrega é transacional no banco; o **upload externo não
participa da transação**. Esse descasamento é deliberado — o snapshot sobrevive
mesmo quando o storage falha. Quando o upload falha após o commit do snapshot:

- o status vai a `FALHA_STORAGE`, com o erro rastreado (`ultimo_erro_storage`,
  `tentativas_storage` incrementado atomicamente no próprio UPDATE);
- a **compensação** enfileira a limpeza do objeto parcial/órfão na fila do R2
  (`storage_cleanup_jobs`), com `onConflictDoNothing` por `object_key`
  (idempotente entre retries);
- `retentarUpload` reenvia os bytes à **mesma** `arquivo_key` do snapshot (nunca
  cria entrega nova nem toca o conteúdo selado); em sucesso, o status volta a um
  estado de sucesso (default `PENDENTE`) e a trilha de auditoria registra o
  retry.

### Leiaute por vigência (R2.5 — N03/N04)

O leiaute **não** é escolhido por quem registra a entrega: é derivado da
vigência da competência por um mapa explícito — 2026 usa o Guia 3.2.2; 2027 em
diante usa o 3.2.3. Quando o chamador informa `leiaute_versao`, ele é validado
contra o esperado para a vigência; um leiaute de outra vigência (ex.: 3.2.2 numa
competência de 2027) é **rejeitado**, fechando a reutilização silenciosa. Não há
fallback para "a última versão".

### Versão do PVA confirmada (N05)

A versão do PVA usada na homologação é sempre a **confirmada** explicitamente
pelo operador (`pva_versao_confirmada` deve casar `pva_versao`) — nunca presumida
como "a última". Sem a confirmação, a entrega é rejeitada.

## Cobertura por estabelecimento (R4)

`montarMatrizOnboarding` é uma projeção read-only que apresenta, por
estabelecimento: modelos usados (55/57/65), perfil (A/B/C), setor
(`IND_ATIV`), regime especial, Blocos B/K/1, 1601 quando aplicável,
combustíveis/monofásicos, inventário por motivo (`01`–`06`) e controles ST.

Sobre esses sinais a projeção deriva **impedimentos explícitos**: para cada eixo
aplicável mas não suportado (Bloco K com movimento, Bloco B, inventário com
motivo ≠ 01, modelo/obrigação não suportado) produz um impedimento com
código/eixo/motivo — nunca um arquivo vazio enganoso (R4.2). Os códigos espelham
os bloqueios conservadores já aplicados na geração da EFD
(`BLOCO_K_MOVIMENTO_NAO_CONFIGURADO`, `BLOCO_B_DF_NAO_SUPORTADO`, inventário
motivo ≠ 01), alinhando a projeção aos bloqueios de geração sem enfraquecê-los
(R4.3).

O status **"pronto para entrega"** (`prontidao`) só é concedido quando a lista de
impedimentos está vazia (R4.4). A ausência de um registro **opcional** (sem
combustíveis, sem ST, sem inventário quando não obrigatório, 1601 opcional
ausente) nunca entra nessa lista e, portanto, nunca é tratada como defeito (R4.5).

## Suíte de verificação em camadas (R3)

As 7 camadas do plano §11.1 estão cobertas: funções puras; integração
PostgreSQL (constraints/locks/concorrência/migrações/fechamento); contrato HTTP
(auth/escopo/DTO/envelope/mensagens); UI (fluxo real); arquivo (fixtures
normativas + mutações deliberadas de posição); PVA (por UF/perfil/regime, com
versão do programa); e conciliação fiscal. As fixtures normativas são
independentes do builder e o teste de mutação de posição de campo falha quando o
leiaute é corrompido. A matriz T01–T52 é percorrida conforme os cenários
habilitados.

## Rollout e critérios de liberação (R5)

Resolvers puros, determinísticos e read-only orquestram a liberação:

- **Inventário (R5.2)** — `rollout-inventario` monta, antes de ativar qualquer
  correção, um retrato read-only de três eixos: versões entregues
  (`fiscal_entregas` por competência/obrigação, com a trilha de retificação),
  competências abertas (`fiscal_fechamentos` ainda sem versão corrente fechada) e
  operações afetadas (CIAP, CT-e de saída escriturado, créditos de ICMS vedados,
  PIS/COFINS misto). Só `select`, nunca escrita.
- **Homologação (R5.1)** — `rollout-homologacao` aplica os seis critérios
  objetivos de forma conjuntiva: regra/fonte vigente, teste unitário, integração
  de persistência (quando aplicável), livro conciliado, TXT validado no PVA e
  revisão fiscal registrada. A ausência de qualquer critério aplicável é listada
  (`faltantes`). A expansão opera só sobre cenários homologados: amostra pequena
  → coortes por UF/perfil/regime.
- **Diferenças para o fiscal (R5.3)** — `retificacao-decisao-fiscal` nunca
  retifica automaticamente obrigação já transmitida; prepara as diferenças para
  decisão do responsável fiscal.
- **Saneamento assistido do CIAP (R5.4)** — `ciap-saneamento` nunca reconstrói
  competências CIAP a partir de contador acumulado; fichas cujo contador diverge
  da razão conhecida são classificadas como `AMBIGUO_SANEAMENTO_ASSISTIDO`,
  encaminhadas para decisão humana.
- **Métricas §13.3 (R5.5)** — `rollout-metricas` instrumenta as oito métricas:
  diferença por tributo, créditos com/sem fundamento, pendências, repetições
  bloqueadas, rejeições PVA, guias sem vínculo, mudanças pós-fechamento e
  tempo/consultas por documento. O serviço agrega no SQL (sem N+1, atento a
  caches por versão); o núcleo apenas monta o retrato sobre números já computados.

## Modelo de dados (migrações aditivas 0019–0026)

Todas as migrações da Fase 5 são **aditivas** (novas tabelas, `ADD COLUMN`,
`CREATE INDEX`, `ADD CONSTRAINT`) — nenhum `DROP` nem `ALTER COLUMN`.

| Migração | Conteúdo |
| --- | --- |
| `0019_fase5_fiscal_pagamentos_eventos` | Tabela `fiscal_pagamentos_eventos` (trilha de pagamento/estorno) |
| `0020_fase5_guias_vinculo_apuracao` | Vínculo da guia à versão de apuração (`fechamento_id`) |
| `0021_fase5_guias_divergencia_obrigacao` | Sinalização de divergência guia × obrigação |
| `0022_fase5_guias_cancelamento_logico` | Cancelamento lógico (sem delete físico) |
| `0023_fase5_guias_emitida_orgao` | Separação registrada ≠ emitida no órgão |
| `0024_fase5_guias_idempotency_key` | Idempotency key sem bloquear obrigações legítimas |
| `0025_fase5_fiscal_entregas` | Tabela `fiscal_entregas` (entrega + retificação) |
| `0026_fase5_fiscal_entregas_retry_storage` | Rastreio de falha/retry de storage |

## Verificação

```bash
# api
pnpm test --runInBand
pnpm build
pnpm db:check   # migrações aditivas 0019–0026

# web
pnpm exec tsc --noEmit
pnpm test
pnpm build
pnpm exec playwright test tests/e2e/fiscal-classificacao.spec.ts
```
