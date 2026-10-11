/**
 * NÚCLEO PURO DA MATRIZ DE ONBOARDING POR ESTABELECIMENTO (Fase 5, tarefa 4.1 —
 * R4.1).
 *
 * O design (§Cobertura por estabelecimento F23) exige "uma matriz de onboarding
 * por estabelecimento: modelos, perfil, setor, regime especial, Blocos B/K/1,
 * 1601, combustíveis/monofásicos, inventário por motivo, controles ST". Esta é a
 * PRIMEIRA tarefa do grupo 4 e é, deliberadamente, uma PROJEÇÃO READ-ONLY: ela
 * MONTA e APRESENTA a cobertura a partir de dados fiscais já existentes
 * (configuração SPED, documentos escriturados, inventários, controles ST) — não
 * cria esquema novo nem decide impedimentos/bloqueios (tarefa 4.2) nem o status
 * "pronto para entrega" (tarefa 4.3).
 *
 * Este módulo é um RESOLVER PURO (espelha `projetarLivros`/`compararGuiaComObrigacao`):
 * recebe os fatos já carregados do banco pelo serviço que o orquestra e apenas
 * CLASSIFICA/APRESENTA. Isso deixa a derivação testável sem banco e com o mesmo
 * determinismo das demais projeções da fase.
 *
 * TAREFA 4.2 (R4.2, R4.3): sobre os sinais de aplicabilidade/suporte montados em
 * 4.1, a projeção agora DERIVA impedimentos EXPLÍCITOS. Para cada eixo onde algo
 * é APLICÁVEL mas NÃO SUPORTADO (Bloco K com movimento, Bloco B, inventário com
 * motivo não suportado, modelo/obrigação não suportado), a matriz produz um
 * `impedimento` com código/eixo/motivo claro — nunca um arquivo vazio enganoso
 * (R4.2). Os códigos de impedimento ESPELHAM os bloqueios conservadores já
 * aplicados na GERAÇÃO da EFD (`BLOCO_K_MOVIMENTO_NAO_CONFIGURADO`,
 * `BLOCO_B_DF_NAO_SUPORTADO`, inventário motivo ≠ 01 em `assertInventoryPayload`):
 * a projeção se ALINHA aos bloqueios de geração, não os enfraquece nem os
 * contorna (R4.3). O status "pronto para entrega" (4.3) consumirá estes
 * impedimentos; aqui apenas os expomos.
 *
 * TAREFA 4.3 (R4.4, R4.5): sobre os impedimentos de 4.2, a projeção agora DERIVA
 * o status "pronto para entrega" (`prontidao`). A regra é a leitura literal do
 * design (§Cobertura por estabelecimento F23): o estabelecimento está "pronto
 * para entrega" SOMENTE quando NÃO há obrigação não atendida — isto é, quando a
 * lista `impedimentos` está VAZIA (R4.4). Qualquer impedimento → status IMPEDIDO
 * e o estabelecimento NÃO fica pronto. Como `impedimentos` já captura apenas o
 * que é APLICÁVEL e NÃO SUPORTADO (obrigação não atendida), a AUSÊNCIA de um
 * registro OPCIONAL (sem combustíveis, sem ST, sem inventário quando não
 * obrigatório, 1601 opcional ausente) nunca entra nessa lista e, portanto, nunca
 * impede a prontidão nem é tratada como defeito (R4.5). O status é uma PROJEÇÃO
 * read-only derivada da matriz/impedimentos já montados — não reavalia fatos.
 */

/**
 * Perfil da EFD ICMS/IPI do estabelecimento (registro 0000 — PERFIL). Mesmo
 * domínio do CHECK `chk_sped_config_perfil` (A/B/C). `null` quando não há
 * configuração SPED (perfil não definido ainda — ausência, não defeito).
 */
export type PerfilEfd = 'A' | 'B' | 'C';

/**
 * Setor/atividade do estabelecimento (registro 0000 — IND_ATIV): `0` industrial
 * ou equiparado a industrial, `1` outros. Mesmo domínio do CHECK
 * `chk_sped_config_ind_ativ`. `null` quando não configurado.
 */
export type IndicadorAtividade = '0' | '1';

/**
 * Modelo de documento fiscal (coluna `modelo` de `documentos_fiscais`, CHECK
 * `chk_docs_fiscais_modelo`): 55 (NF-e), 57 (CT-e), 65 (NFC-e). A matriz lista
 * os modelos EFETIVAMENTE usados pelo estabelecimento na competência.
 */
export type ModeloDocumento = '55' | '57' | '65';

/**
 * Motivo do inventário (registro H005 — MOT_INV), domínio `01`–`06` (mesmo
 * `SPED_INVENTORY_REASONS`). A matriz lista os inventários POR MOTIVO (R4.1).
 */
export type MotivoInventario = '01' | '02' | '03' | '04' | '05' | '06';

/**
 * Rótulos humanos dos motivos de inventário (tabela do registro H005), para a
 * apresentação da matriz. O motivo `01` (final do período) é o suportado para
 * fechamento (ver `assertInventoryPayload`): os demais exigem registros
 * complementares ainda não suportados — a matriz os EXIBE com esse sinal, sem
 * decidir impedimento aqui (tarefa 4.2).
 */
export const MOTIVO_INVENTARIO_LABEL: Record<MotivoInventario, string> = {
  '01': 'No final do período',
  '02': 'Na mudança de forma de tributação da mercadoria (ICMS)',
  '03': 'Na solicitação da baixa cadastral, paralisação temporária e outros',
  '04': 'Na alteração de regime de pagamento — condição do contribuinte',
  '05': 'Por determinação dos fiscos',
  '06': 'Para controle das mercadorias sujeitas ao regime de ST',
};

/**
 * Modelo de documento usado no estabelecimento, com a contagem de documentos
 * daquele modelo na competência. A contagem é informativa (dimensiona o uso);
 * nunca é usada em aritmética monetária.
 */
export interface ModeloUsado {
  modelo: ModeloDocumento;
  descricao: string;
  quantidade: number;
}

/**
 * Rótulo humano de cada modelo de documento, coerente com o CHECK
 * `chk_docs_fiscais_tipo_modelo` (55↔NFE, 57↔CTE, 65↔NFCE).
 */
export const MODELO_DOCUMENTO_LABEL: Record<ModeloDocumento, string> = {
  '55': 'NF-e (modelo 55)',
  '57': 'CT-e (modelo 57)',
  '65': 'NFC-e (modelo 65)',
};

/**
 * Aplicabilidade de um bloco da EFD na competência. É um sinal de COBERTURA:
 * `aplicavel` indica que o bloco é esperado/entra para o estabelecimento;
 * `suportado` indica se a geração do bloco é suportada pelo sistema hoje. A
 * matriz expõe os dois; a decisão de impedimento (quando aplicável e não
 * suportado) é da tarefa 4.2 e NÃO é tomada aqui.
 */
export interface BlocoAplicabilidade {
  aplicavel: boolean;
  suportado: boolean;
  /** Memória textual auditável da aplicabilidade (sempre preenchida). */
  memoria: string;
}

/**
 * Cobertura dos Blocos B, K e 1 do estabelecimento (R4.1). O Bloco B é a
 * apuração do ISS municipal (serviços); o Bloco K é o controle da produção e do
 * estoque (industrial/atacadista); o Bloco 1 reúne informações de obrigações
 * específicas (combustíveis/1601, ressarcimento ST, etc.).
 */
export interface CoberturaBlocos {
  blocoB: BlocoAplicabilidade;
  blocoK: BlocoAplicabilidade;
  bloco1: BlocoAplicabilidade;
}

/**
 * Sinal de combustíveis/monofásicos no estabelecimento (R4.1). Deriva-se de
 * TRÊS fontes independentes, qualquer uma positiva marca presença:
 *  - o indicador `IND_COMB` do registro 1010 (operação com combustíveis);
 *  - CST ICMS monofásico sobre combustíveis nos itens (02/15/53/61 — tabela B);
 *  - CST PIS/COFINS monofásico (`04`) nos itens.
 * A matriz EXIBE a presença e indica que a obrigação 1601 (apuração do ICMS
 * monofásico de combustíveis na EFD Contribuições) é APLICÁVEL quando há
 * combustíveis — sem decidir suporte/impedimento aqui (tarefa 4.2).
 */
export interface CoberturaCombustiveis {
  /** `true` quando qualquer sinal de combustíveis/monofásicos foi detectado. */
  presente: boolean;
  /** `IND_COMB = 'S'` no registro 1010 do estabelecimento. */
  indComb: boolean;
  /** Há item com CST ICMS monofásico de combustíveis (02/15/53/61). */
  cstIcmsMonofasico: boolean;
  /** Há item com CST PIS/COFINS monofásico (04). */
  cstPisCofinsMonofasico: boolean;
  /** `true` quando a obrigação 1601 é aplicável (há combustíveis). */
  obrigacao1601Aplicavel: boolean;
  memoria: string;
}

/** CSTs de ICMS monofásico sobre combustíveis (tabela B do ICMS). */
export const CST_ICMS_MONOFASICO_COMBUSTIVEIS: ReadonlySet<string> = new Set([
  '02',
  '15',
  '53',
  '61',
]);

/** CST de PIS/COFINS monofásico (revenda a alíquota zero / concentração). */
export const CST_PIS_COFINS_MONOFASICO = '04';

/**
 * Inventário presente no estabelecimento, por data/motivo (R4.1). Reflete o
 * registro H005 (`sped_inventarios`): data, motivo, status (RASCUNHO/FECHADO) e
 * se o motivo é suportado para fechamento (apenas `01` hoje — ver
 * `assertInventoryPayload`). A matriz EXIBE o sinal `motivoSuportado`; não o
 * converte em impedimento (tarefa 4.2).
 */
export interface InventarioPorMotivo {
  dataInventario: string;
  motivo: MotivoInventario;
  descricaoMotivo: string;
  status: string;
  /** `true` só para o motivo `01` (final do período), hoje o suportado. */
  motivoSuportado: boolean;
}

/**
 * Controle de ST do estabelecimento (R4.1). Resume os sinais de ST observados
 * nos documentos escriturados: itens com CEST (candidatos a enquadramento),
 * itens com valor de ICMS-ST destacado e itens com ICMS-ST retido
 * anteriormente. É um RESUMO de presença — o enquadramento/cálculo e os
 * bloqueios de ST têm os seus próprios portões (`st-verificacao`/
 * `st-enquadramento`) e não são decididos aqui.
 */
export interface ControleSt {
  /** `true` quando há qualquer sinal de ST no estabelecimento. */
  presente: boolean;
  /** Itens com CEST informado (candidatos a enquadramento por CEST). */
  itensComCest: number;
  /** Itens com ICMS-ST destacado (valor de ST próprio). */
  itensComIcmsSt: number;
  /** Itens com ICMS-ST retido anteriormente (mercadoria já substituída). */
  itensComStRetido: number;
  memoria: string;
}

/**
 * Regime especial do estabelecimento, derivado dos indicadores do registro 1010
 * e do regime tributário cadastral. É um RESUMO textual dos indicadores ligados
 * (ex.: exportador, usina, combustíveis) — a matriz lista os indicadores ativos
 * sem reinterpretá-los. `null`/vazio quando não há indicador especial ligado.
 */
export interface RegimeEspecial {
  /** Regime tributário cadastral do cliente (ex.: 'SIMPLES', 'PRESUMIDO'). */
  regimeTributario: string | null;
  /** Indicadores `1010` ativos (`'S'`), em ordem estável. */
  indicadoresAtivos: string[];
}

/**
 * Fatos JÁ CARREGADOS pelo serviço (do banco) que alimentam a projeção. É o
 * contrato de entrada do núcleo puro: nenhuma consulta acontece aqui. Mantém os
 * tipos frouxos (strings/null) espelhando as colunas, para que o serviço possa
 * passar as linhas do drizzle quase sem transformação.
 */
export interface OnboardingMatrizFatos {
  clienteId: string;
  competencia: string; // 'YYYY-MM'
  cliente: {
    razaoSocial: string | null;
    cnpj: string | null;
    uf: string | null;
    regimeTributario: string | null;
  };
  /** Configuração SPED do estabelecimento, ou `null` quando não configurada. */
  configuracao: {
    perfilEfd: string | null;
    indAtiv: string | null;
    obrigadoEfdIcmsIpi: boolean;
    inventarioObrigatorio: boolean;
    mesEntregaInventario: number;
    blocoKComMovimento: boolean;
    indicadores1010: Record<string, string>;
  } | null;
  /** Contagem de documentos por modelo na competência (modelo → quantidade). */
  modelosContagem: Array<{ modelo: string; quantidade: number }>;
  /**
   * Sinais agregados dos ITENS dos documentos da competência: presença de ISS
   * (serviços → Bloco B), CSTs monofásicos e sinais de ST. Agregados no SQL
   * para evitar carregar item a item (N+1).
   */
  sinaisItens: {
    temIndComb: boolean;
    temCstIcmsMonofasico: boolean;
    temCstPisCofinsMonofasico: boolean;
    itensComCest: number;
    itensComIcmsSt: number;
    itensComStRetido: number;
  };
  /** Inventários do estabelecimento (qualquer data), por motivo. */
  inventarios: Array<{
    dataInventario: string;
    motivo: string;
    status: string;
  }>;
}

/**
 * Eixo da matriz ao qual um impedimento se refere, para apresentação e para
 * cruzar com o bloqueio de geração correspondente.
 */
export type EixoImpedimento =
  | 'blocoB'
  | 'blocoK'
  | 'inventario'
  | 'modelo'
  | 'obrigacao1601';

/**
 * IMPEDIMENTO EXPLÍCITO (tarefa 4.2 — R4.2/R4.3). Um documento/obrigação que é
 * APLICÁVEL ao estabelecimento mas NÃO É SUPORTADO pela geração hoje. É a
 * conversão honesta dos sinais da matriz: em vez de deixar passar e gerar um
 * arquivo vazio/enganoso, a matriz APRESENTA o impedimento com motivo claro.
 *
 * `codigo` ESPELHA, quando existe, o código do bloqueio conservador aplicado na
 * geração da EFD (ver `efd-icms-ipi.service.ts` / `assertInventoryPayload`), para
 * que o impedimento de onboarding e o bloqueio de geração sejam a MESMA barreira
 * vista de dois pontos — nunca um contorno do outro (R4.3).
 */
export interface Impedimento {
  codigo: string;
  eixo: EixoImpedimento;
  motivo: string;
}

/** Código do bloqueio de geração do Bloco K com movimento não configurado. */
export const IMPEDIMENTO_BLOCO_K = 'BLOCO_K_MOVIMENTO_NAO_CONFIGURADO';
/** Código do bloqueio de geração do Bloco B (não suportado). */
export const IMPEDIMENTO_BLOCO_B = 'BLOCO_B_NAO_SUPORTADO';
/** Código do impedimento de inventário com motivo não suportado (≠ 01). */
export const IMPEDIMENTO_INVENTARIO_MOTIVO = 'INVENTARIO_MOTIVO_NAO_SUPORTADO';
/** Código do impedimento de modelo de documento não suportado. */
export const IMPEDIMENTO_MODELO = 'MODELO_NAO_SUPORTADO';

/**
 * Modelos de documento cuja geração/escrituração é suportada hoje. 55 (NF-e) e
 * 65 (NFC-e) são escriturados; 57 (CT-e) é de serviços de transporte e sua
 * escrituração completa (Bloco B/serviços) não é suportada — é tratado como
 * modelo não suportado quando usado pelo estabelecimento.
 */
export const MODELOS_SUPORTADOS: ReadonlySet<ModeloDocumento> = new Set([
  '55',
  '65',
]);

/**
 * Status de prontidão do estabelecimento para entrega (tarefa 4.3 — R4.4):
 *  - `PRONTO`: nenhuma obrigação não atendida (lista de impedimentos vazia);
 *  - `IMPEDIDO`: há ao menos uma obrigação não atendida (impedimento).
 * Não há estado intermediário: ou não há impedimento (pronto) ou há (impedido).
 */
export type StatusProntidao = 'PRONTO' | 'IMPEDIDO';

/**
 * PRONTIDÃO PARA ENTREGA (tarefa 4.3 — R4.4/R4.5). Projeção read-only derivada
 * EXCLUSIVAMENTE da lista de `impedimentos` (tarefa 4.2): o estabelecimento está
 * "pronto para entrega" SOMENTE quando não há obrigação não atendida, isto é,
 * quando não há impedimento (R4.4).
 *
 * A ausência de um registro OPCIONAL (combustíveis, ST, inventário não
 * obrigatório, 1601 opcional) NUNCA vira impedimento em 4.2 e, portanto, nunca
 * afeta a prontidão nem é classificada como defeito (R4.5): só obrigação não
 * atendida bloqueia.
 */
export interface Prontidao {
  /** `true` SOMENTE quando não há nenhum impedimento (R4.4). */
  prontoParaEntrega: boolean;
  /** Status derivado: `PRONTO` sem impedimentos, `IMPEDIDO` com qualquer um. */
  status: StatusProntidao;
  /**
   * Motivos que BLOQUEIAM a entrega — exatamente os impedimentos de 4.2 (cópia
   * estável). Vazio quando `prontoParaEntrega` é `true`. Nunca inclui ausência
   * de registro opcional (R4.5): aquilo não é obrigação não atendida.
   */
  bloqueios: Impedimento[];
  /** Memória textual auditável do status (sempre preenchida). */
  memoria: string;
}

/**
 * A MATRIZ DE ONBOARDING montada (R4.1 + R4.2/R4.3). Projeção read-only,
 * apresentável diretamente: identifica o estabelecimento, a competência e cada
 * eixo exigido pelo requisito (modelos, perfil, setor, regime especial, Blocos
 * B/K/1, 1601, combustíveis/monofásicos, inventário por motivo, controles ST), e
 * ainda a lista de `impedimentos` explícitos derivada dos sinais de
 * aplicabilidade × suporte (tarefa 4.2).
 */
export interface OnboardingMatriz {
  clienteId: string;
  competencia: string;
  estabelecimento: {
    razaoSocial: string | null;
    cnpj: string | null;
    uf: string | null;
  };
  configurado: boolean;
  perfil: PerfilEfd | null;
  setor: {
    indAtiv: IndicadorAtividade | null;
    descricao: string;
  };
  regimeEspecial: RegimeEspecial;
  modelos: ModeloUsado[];
  blocos: CoberturaBlocos;
  combustiveis: CoberturaCombustiveis;
  inventariosPorMotivo: InventarioPorMotivo[];
  controleSt: ControleSt;
  /**
   * Impedimentos EXPLÍCITOS (tarefa 4.2 — R4.2/R4.3): documentos/obrigações
   * aplicáveis mas não suportados. Vazio quando nada aplicável está sem suporte;
   * ordenado de forma estável (por eixo, depois código/motivo). Nunca é omitido:
   * a presença de um impedimento é o que impede um arquivo vazio enganoso.
   */
  impedimentos: Impedimento[];
  /**
   * PRONTIDÃO PARA ENTREGA (tarefa 4.3 — R4.4/R4.5): status derivado dos
   * `impedimentos`. `prontoParaEntrega` é `true` SOMENTE quando não há obrigação
   * não atendida (impedimentos vazio); qualquer impedimento → `IMPEDIDO`.
   * Ausência de registro opcional não impede nem é defeito (R4.5).
   */
  prontidao: Prontidao;
}

/**
 * MONTA a matriz de onboarding a partir dos fatos carregados (tarefa 4.1 —
 * R4.1). Puro e determinístico: os mesmos fatos sempre produzem a mesma matriz.
 *
 * A função APRESENTA a cobertura E, a partir dos sinais de aplicabilidade ×
 * suporte, DERIVA os impedimentos explícitos (tarefa 4.2 — R4.2/R4.3): cada eixo
 * aplicável e não suportado (Bloco K com movimento, Bloco B, inventário com
 * motivo não suportado, modelo não suportado) vira um `impedimento` com
 * código/eixo/motivo, espelhando os bloqueios conservadores da geração. O status
 * "pronto para entrega" (4.3) consome estes impedimentos — não é decidido aqui.
 */
export function montarMatrizOnboarding(
  fatos: OnboardingMatrizFatos,
): OnboardingMatriz {
  const config = fatos.configuracao;
  const perfil = normalizarPerfil(config?.perfilEfd);
  const indAtiv = normalizarIndAtiv(config?.indAtiv);
  const indicadores = config?.indicadores1010 ?? {};

  const modelos = montarModelos(fatos.modelosContagem);
  const combustiveis = montarCombustiveis(fatos.sinaisItens, indicadores);
  const controleSt = montarControleSt(fatos.sinaisItens);
  const inventariosPorMotivo = montarInventarios(fatos.inventarios);
  const blocos = montarBlocos({
    indAtiv,
    blocoKComMovimento: config?.blocoKComMovimento ?? false,
    temModeloServico: modelos.some((m) => m.modelo === '57'),
    combustiveisPresente: combustiveis.presente,
    stPresente: controleSt.presente,
  });

  const impedimentos = derivarImpedimentos({
    blocos,
    modelos,
    inventariosPorMotivo,
  });

  return {
    clienteId: fatos.clienteId,
    competencia: fatos.competencia,
    estabelecimento: {
      razaoSocial: fatos.cliente.razaoSocial,
      cnpj: fatos.cliente.cnpj,
      uf: fatos.cliente.uf,
    },
    // Configurado quando há linha de configuração SPED; o detalhamento de cada
    // eixo distingue ausência (não defeito, R4.5) de presença.
    configurado: config != null,
    perfil,
    setor: {
      indAtiv,
      descricao: descricaoSetor(indAtiv),
    },
    regimeEspecial: {
      regimeTributario: naoVazio(fatos.cliente.regimeTributario),
      indicadoresAtivos: indicadoresAtivos(indicadores),
    },
    modelos,
    blocos,
    combustiveis,
    inventariosPorMotivo,
    controleSt,
    impedimentos,
    prontidao: derivarProntidao(impedimentos),
  };
}

/**
 * DERIVA a prontidão para entrega (tarefa 4.3 — R4.4/R4.5) a partir da lista de
 * impedimentos já montada (tarefa 4.2). Regra única e literal do design: o
 * estabelecimento está "pronto para entrega" SOMENTE quando não há obrigação
 * não atendida — isto é, quando `impedimentos` está VAZIO (R4.4). Qualquer
 * impedimento → `IMPEDIDO` e não pronto.
 *
 * Porque `impedimentos` já captura apenas o APLICÁVEL × NÃO SUPORTADO, a
 * ausência de um registro OPCIONAL nunca está nessa lista: assim, uma ausência
 * opcional não impede a prontidão nem é tratada como defeito (R4.5). A projeção
 * é read-only — apenas lê os impedimentos, não reavalia os fatos.
 */
function derivarProntidao(impedimentos: Impedimento[]): Prontidao {
  const prontoParaEntrega = impedimentos.length === 0;
  const bloqueios = [...impedimentos];
  return {
    prontoParaEntrega,
    status: prontoParaEntrega ? 'PRONTO' : 'IMPEDIDO',
    bloqueios,
    memoria: prontoParaEntrega
      ? 'Pronto para entrega: nenhuma obrigação não atendida. A ausência de ' +
      'registros opcionais (combustíveis, ST, inventário não obrigatório, ' +
      '1601 opcional) não impede a entrega nem é defeito (R4.5).'
      : `Não pronto para entrega: ${bloqueios.length} obrigação(ões) não ` +
      `atendida(s) impede(m) a entrega (${bloqueios
        .map((b) => b.codigo)
        .join(', ')}). Resolva os impedimentos antes de entregar (R4.4).`,
  };
}

/**
 * DERIVA os impedimentos explícitos (tarefa 4.2 — R4.2/R4.3) a partir dos sinais
 * de aplicabilidade × suporte já montados. Regra única e honesta: um eixo gera
 * impedimento QUANDO é APLICÁVEL e NÃO SUPORTADO. Cada impedimento usa o código
 * que ESPELHA o bloqueio conservador da geração, para serem a mesma barreira.
 *
 * O resultado é determinístico e ordenado de forma estável (por eixo, depois
 * motivo), para que a projeção read-only seja reproduzível.
 */
function derivarImpedimentos(input: {
  blocos: CoberturaBlocos;
  modelos: ModeloUsado[];
  inventariosPorMotivo: InventarioPorMotivo[];
}): Impedimento[] {
  const impedimentos: Impedimento[] = [];

  // Bloco K aplicável mas não suportado (K com movimento declarado): espelha o
  // bloqueio de geração BLOCO_K_MOVIMENTO_NAO_CONFIGURADO.
  if (input.blocos.blocoK.aplicavel && !input.blocos.blocoK.suportado) {
    impedimentos.push({
      codigo: IMPEDIMENTO_BLOCO_K,
      eixo: 'blocoK',
      motivo:
        'Bloco K aplicável com movimento declarado, mas a geração do Bloco K ' +
        'com movimento não é suportada. É necessário informar os dados de ' +
        'produção/estoque antes de gerar — não é possível entregar sem o Bloco K.',
    });
  }

  // Bloco B aplicável mas não suportado: espelha o bloqueio de geração do Bloco B.
  if (input.blocos.blocoB.aplicavel && !input.blocos.blocoB.suportado) {
    impedimentos.push({
      codigo: IMPEDIMENTO_BLOCO_B,
      eixo: 'blocoB',
      motivo:
        'Bloco B (ISS/serviços) aplicável ao estabelecimento, mas a geração do ' +
        'Bloco B não é suportada. Conclua a escrituração do Bloco B antes de ' +
        'gerar — a entrega sem o Bloco B produziria um arquivo incompleto.',
    });
  }

  // Inventário com motivo não suportado (≠ 01): espelha o bloqueio de
  // `assertInventoryPayload` ("somente o motivo 01 pode ser fechado").
  for (const inv of input.inventariosPorMotivo) {
    if (inv.motivoSuportado) continue;
    impedimentos.push({
      codigo: IMPEDIMENTO_INVENTARIO_MOTIVO,
      eixo: 'inventario',
      motivo:
        `Inventário de ${inv.dataInventario} com motivo ${inv.motivo} ` +
        `(${inv.descricaoMotivo}) não é suportado para fechamento: somente o ` +
        'motivo 01 (final do período) é suportado; os motivos 02 a 06 exigem ' +
        'registros complementares (H020/H030) ainda não suportados.',
    });
  }

  // Modelo de documento usado mas não suportado (ex.: 57/CT-e): a presença de um
  // modelo não suportado é obrigação não atendida — impedimento explícito.
  for (const modelo of input.modelos) {
    if (MODELOS_SUPORTADOS.has(modelo.modelo)) continue;
    impedimentos.push({
      codigo: IMPEDIMENTO_MODELO,
      eixo: 'modelo',
      motivo:
        `Modelo ${modelo.modelo} (${modelo.descricao}) usado em ` +
        `${modelo.quantidade} documento(s), mas a escrituração desse modelo não ` +
        'é suportada. A entrega não pode omitir silenciosamente esses documentos.',
    });
  }

  return impedimentos.sort((a, b) => {
    const e = a.eixo.localeCompare(b.eixo);
    if (e !== 0) return e;
    return a.motivo.localeCompare(b.motivo);
  });
}

/** Lista os modelos usados (com contagem), em ordem estável de modelo. */
function montarModelos(
  contagem: Array<{ modelo: string; quantidade: number }>,
): ModeloUsado[] {
  const usados: ModeloUsado[] = [];
  for (const linha of contagem) {
    const modelo = normalizarModelo(linha.modelo);
    if (modelo == null) continue;
    if (linha.quantidade <= 0) continue;
    usados.push({
      modelo,
      descricao: MODELO_DOCUMENTO_LABEL[modelo],
      quantidade: linha.quantidade,
    });
  }
  return usados.sort((a, b) => a.modelo.localeCompare(b.modelo));
}

/** Deriva o sinal de combustíveis/monofásicos e a aplicabilidade do 1601. */
function montarCombustiveis(
  sinais: OnboardingMatrizFatos['sinaisItens'],
  indicadores: Record<string, string>,
): CoberturaCombustiveis {
  const indComb = indicadores['IND_COMB'] === 'S';
  const cstIcmsMonofasico = sinais.temCstIcmsMonofasico;
  const cstPisCofinsMonofasico = sinais.temCstPisCofinsMonofasico;
  const presente = indComb || cstIcmsMonofasico || cstPisCofinsMonofasico;
  const sinaisTexto: string[] = [];
  if (indComb) sinaisTexto.push('IND_COMB=S (registro 1010)');
  if (cstIcmsMonofasico) {
    sinaisTexto.push('CST ICMS monofásico de combustíveis (02/15/53/61)');
  }
  if (cstPisCofinsMonofasico) {
    sinaisTexto.push('CST PIS/COFINS monofásico (04)');
  }
  return {
    presente,
    indComb,
    cstIcmsMonofasico,
    cstPisCofinsMonofasico,
    obrigacao1601Aplicavel: presente,
    memoria: presente
      ? `Combustíveis/monofásicos detectados: ${sinaisTexto.join('; ')}. A ` +
      'obrigação 1601 (apuração do ICMS monofásico de combustíveis na EFD ' +
      'Contribuições) é APLICÁVEL. Suporte/impedimento é avaliado adiante (4.2).'
      : 'Sem sinais de combustíveis/monofásicos na competência. Obrigação 1601 ' +
      'não aplicável (ausência de registro opcional não é defeito — R4.5).',
  };
}

/** Resume os sinais de ST observados nos itens da competência. */
function montarControleSt(
  sinais: OnboardingMatrizFatos['sinaisItens'],
): ControleSt {
  const presente =
    sinais.itensComCest > 0 ||
    sinais.itensComIcmsSt > 0 ||
    sinais.itensComStRetido > 0;
  return {
    presente,
    itensComCest: sinais.itensComCest,
    itensComIcmsSt: sinais.itensComIcmsSt,
    itensComStRetido: sinais.itensComStRetido,
    memoria: presente
      ? `Controles de ST presentes: ${sinais.itensComCest} item(ns) com CEST, ` +
      `${sinais.itensComIcmsSt} com ICMS-ST destacado, ` +
      `${sinais.itensComStRetido} com ST retido anteriormente. O enquadramento/` +
      'cálculo de ST segue os portões de verificação e enquadramento (Fase 4).'
      : 'Sem sinais de ST na competência (ausência não é defeito — R4.5).',
  };
}

/** Lista os inventários por motivo, marcando o suporte de cada motivo. */
function montarInventarios(
  inventarios: Array<{
    dataInventario: string;
    motivo: string;
    status: string;
  }>,
): InventarioPorMotivo[] {
  const linhas: InventarioPorMotivo[] = [];
  for (const inv of inventarios) {
    const motivo = normalizarMotivo(inv.motivo);
    if (motivo == null) continue;
    linhas.push({
      dataInventario: inv.dataInventario,
      motivo,
      descricaoMotivo: MOTIVO_INVENTARIO_LABEL[motivo],
      status: inv.status,
      // Hoje só o motivo 01 (final do período) é suportado para fechamento; os
      // demais exigem registros complementares não suportados (bloqueio
      // conservador preservado — a decisão é da 4.2; aqui só o sinal).
      motivoSuportado: motivo === '01',
    });
  }
  return linhas.sort((a, b) => {
    const d = a.dataInventario.localeCompare(b.dataInventario);
    return d !== 0 ? d : a.motivo.localeCompare(b.motivo);
  });
}

/** Deriva a aplicabilidade/suporte dos Blocos B, K e 1. */
function montarBlocos(input: {
  indAtiv: IndicadorAtividade | null;
  blocoKComMovimento: boolean;
  temModeloServico: boolean;
  combustiveisPresente: boolean;
  stPresente: boolean;
}): CoberturaBlocos {
  // Bloco B (ISS municipal): aplicável quando há atividade de serviços. Sinal
  // conservador: presença de CT-e (modelo 57) ou setor "outros" não industrial.
  // O Bloco B não é gerado pelo sistema hoje — mantém o bloqueio conservador.
  const blocoBAplicavel = input.temModeloServico;
  const blocoB: BlocoAplicabilidade = {
    aplicavel: blocoBAplicavel,
    suportado: false,
    memoria: blocoBAplicavel
      ? 'Bloco B (ISS) possivelmente aplicável (atividade de serviços detectada). ' +
      'Geração do Bloco B NÃO suportada hoje — bloqueio conservador preservado ' +
      '(R4.3); impedimento explícito avaliado adiante (4.2).'
      : 'Bloco B (ISS) não aplicável para o estabelecimento na competência.',
  };

  // Bloco K (controle de produção/estoque): aplicável para industrial/equiparado
  // (IND_ATIV=0) e/ou quando o estabelecimento declara movimento de Bloco K. A
  // geração do Bloco K com movimento NÃO é suportada hoje (bloqueio conservador).
  const blocoKAplicavel = input.indAtiv === '0' || input.blocoKComMovimento;
  const blocoK: BlocoAplicabilidade = {
    aplicavel: blocoKAplicavel,
    // Suportado apenas quando aplicável SEM movimento declarado (bloco K vazio/
    // sem produção); com movimento permanece não suportado (bloqueio conservador).
    suportado: blocoKAplicavel && !input.blocoKComMovimento,
    memoria: !blocoKAplicavel
      ? 'Bloco K não aplicável (estabelecimento não industrial/equiparado e sem ' +
      'movimento declarado).'
      : input.blocoKComMovimento
        ? 'Bloco K aplicável COM movimento declarado. Geração do Bloco K com ' +
        'movimento NÃO suportada hoje — bloqueio conservador preservado (R4.3); ' +
        'impedimento explícito avaliado adiante (4.2).'
        : 'Bloco K aplicável (industrial/equiparado) sem movimento declarado.',
  };

  // Bloco 1 (informações de obrigações específicas): aplicável quando há
  // combustíveis (1601) ou controles de ST (ressarcimento/complemento). A
  // apresentação é informativa; o suporte por registro é avaliado adiante.
  const bloco1Aplicavel = input.combustiveisPresente || input.stPresente;
  const bloco1: BlocoAplicabilidade = {
    aplicavel: bloco1Aplicavel,
    suportado: !bloco1Aplicavel ? true : false,
    memoria: bloco1Aplicavel
      ? 'Bloco 1 aplicável (combustíveis/1601 e/ou controles de ST detectados). ' +
      'Suporte por registro específico avaliado adiante (4.2).'
      : 'Bloco 1 sem registros específicos aplicáveis na competência (ausência ' +
      'não é defeito — R4.5).',
  };

  return { blocoB, blocoK, bloco1 };
}

function descricaoSetor(indAtiv: IndicadorAtividade | null): string {
  switch (indAtiv) {
    case '0':
      return 'Industrial ou equiparado a industrial';
    case '1':
      return 'Outros';
    default:
      return 'Setor não configurado';
  }
}

/** Indicadores `1010` ativos (`'S'`), em ordem alfabética estável. */
function indicadoresAtivos(indicadores: Record<string, string>): string[] {
  return Object.keys(indicadores)
    .filter((key) => indicadores[key] === 'S')
    .sort((a, b) => a.localeCompare(b));
}

function normalizarPerfil(value: string | null | undefined): PerfilEfd | null {
  return value === 'A' || value === 'B' || value === 'C' ? value : null;
}

function normalizarIndAtiv(
  value: string | null | undefined,
): IndicadorAtividade | null {
  return value === '0' || value === '1' ? value : null;
}

function normalizarModelo(
  value: string | null | undefined,
): ModeloDocumento | null {
  return value === '55' || value === '57' || value === '65' ? value : null;
}

function normalizarMotivo(
  value: string | null | undefined,
): MotivoInventario | null {
  return value != null && Object.hasOwn(MOTIVO_INVENTARIO_LABEL, value)
    ? (value as MotivoInventario)
    : null;
}

function naoVazio(valor: string | null | undefined): string | null {
  if (valor == null) return null;
  const t = valor.trim();
  return t === '' ? null : t;
}
