/**
 * NÚCLEO PURO DO SANEAMENTO ASSISTIDO DO CIAP (Fase 5, tarefa 5.4 — R5.4).
 *
 * O design (§Rollout §13) é literal: "Não reconstruir competência CIAP por
 * contador; saneamento assistido." R5.4 reforça: o sistema NÃO DEVE reconstruir
 * competências CIAP a partir de contador acumulado; casos ambíguos DEVEM ser
 * tratados como SANEAMENTO ASSISTIDO (correção revisada por humano), nunca por
 * fabricação automática.
 *
 * Esta é a QUARTA tarefa do grupo 5 (rollout), logo após o inventário read-only
 * (5.1), os critérios de homologação (5.2) e a preparação de diferenças para o
 * fiscal (5.3). Segue EXATAMENTE o mesmo padrão de RESOLVER PURO
 * (`rollout-inventario.ts`, `retificacao-decisao-fiscal.ts`): determinístico,
 * testável sem banco, que apenas CLASSIFICA e APRESENTA — nunca escreve, nunca
 * migra, e sobretudo NUNCA reconstrói competências.
 *
 * A GARANTIA CENTRAL, EM UMA FRASE: dado o CONTADOR acumulado de uma ficha
 * (`parcelasApropriadas`) e o conjunto de apropriações POR COMPETÊNCIA
 * efetivamente conhecidas (a razão `ciap_apropriacoes`), este núcleo NUNCA
 * infere/fabrica as competências que "faltam" para fechar o contador. Quando o
 * contador diverge da razão conhecida (contador > 0 sem registros, contador
 * maior que o nº de competências conhecidas, nº de parcela inconsistente, ou a
 * ficha já marcada para saneamento / sem identidade comprovada), a ficha é
 * classificada como `AMBIGUO_SANEAMENTO_ASSISTIDO` — encaminhada para decisão
 * humana — em vez de ter sua história per-competência reconstruída.
 *
 * O campo `saneamentoPendente` (preenchido pela migração de identidade da Fase
 * 2, `migrarIdentidadePorAquisicao`) é um dos sinais de entrada: quando já está
 * marcado, a classificação o RESPEITA (continua ambíguo). O núcleo não "limpa"
 * nem "resolve" o flag — apenas o consolida junto às demais evidências.
 */

/**
 * Classificação de uma ficha CIAP para o saneamento (R5.4):
 *  - `OK`: a razão por competência é CONSISTENTE com o contador — o nº de
 *    apropriações conhecidas bate com `parcelasApropriadas`, os números de
 *    parcela são coerentes, a identidade é comprovada e não há flag de
 *    saneamento pendente. Nada a sanear.
 *  - `AMBIGUO_SANEAMENTO_ASSISTIDO`: há ambiguidade (contador sem lastro na
 *    razão, divergência de contagem/numeração, identidade não comprovada ou
 *    flag de saneamento) — a correção DEVE ser revisada por humano. O núcleo
 *    NUNCA reconstrói as competências ausentes a partir do contador.
 */
export type ClassificacaoSaneamentoCiap =
  | 'OK'
  | 'AMBIGUO_SANEAMENTO_ASSISTIDO';

/**
 * Motivo auditável da ambiguidade (quando houver). Cada motivo descreve POR QUE
 * a ficha não pode ser confirmada sem decisão humana — e, implicitamente, por
 * que NÃO reconstruímos a história a partir do contador.
 */
export type MotivoSaneamentoCiap =
  // `saneamentoPendente === true`: a migração de identidade (Fase 2) já marcou
  // esta ficha para saneamento assistido (ex.: SKU com múltiplas aquisições).
  | 'FLAG_SANEAMENTO_PENDENTE'
  // Identidade não comprovada: `origemIdentidade === 'reconstruido_nao_comprovado'`
  // (ou ainda `sku_legado`), sem lastro em item escriturado.
  | 'IDENTIDADE_NAO_COMPROVADA'
  // Contador > 0 mas NENHUMA apropriação por competência conhecida: o estado é
  // "só contador". Reconstruir as competências a partir dele é proibido (R5.4).
  | 'CONTADOR_SEM_RAZAO'
  // Contador diverge do nº de apropriações por competência conhecidas
  // (contador > conhecidas, ou conhecidas > contador): razão incompleta/incoerente.
  | 'CONTADOR_DIVERGE_DA_RAZAO'
  // Números de parcela da razão são inconsistentes (duplicados, fora de
  // 1..quantidadeParcelas, ou a maior parcela não bate com o contador).
  | 'NUMERACAO_PARCELA_INCONSISTENTE';

/**
 * Uma APROPRIAÇÃO POR COMPETÊNCIA conhecida (fato da razão `ciap_apropriacoes`),
 * reduzida ao que importa para o saneamento. Representa um registro REAL,
 * efetivamente gravado — nunca uma competência inferida.
 */
export interface ApropriacaoCompetenciaFato {
  /** Competência da apropriação ('YYYY-MM' já normalizada pelo serviço). */
  competencia: string;
  /** Número da parcela (1..quantidadeParcelas), derivado do calendário (R1.4). */
  numeroParcela: number;
}

/**
 * Fatos de UMA ficha CIAP já carregados do banco (read-only) para a
 * classificação de saneamento (R5.4). O `contadorParcelasApropriadas` é o
 * `parcelasApropriadas` da ficha — o CONTADOR acumulado que NÃO pode fundamentar
 * reconstrução. As `apropriacoesConhecidas` são os registros REAIS da razão.
 */
export interface FichaCiapSaneamentoFatos {
  bemId: string;
  codigoBem: string;
  identificacaoBem: string;
  status: string;
  /** Procedência da identidade (aquisicao | reconstruido_nao_comprovado | sku_legado). */
  origemIdentidade: string;
  /** Flag de saneamento assistido já marcado pela migração de identidade (Fase 2). */
  saneamentoPendente: boolean;
  quantidadeParcelas: number;
  /** CONTADOR acumulado da ficha (`parcelasApropriadas`). */
  contadorParcelasApropriadas: number;
  /** Apropriações POR COMPETÊNCIA conhecidas (razão real), nunca inferidas. */
  apropriacoesConhecidas: ApropriacaoCompetenciaFato[];
}

/**
 * Resultado da classificação de UMA ficha (R5.4). É um RETRATO read-only para
 * a decisão humana; NUNCA fabrica/reconstrói competências.
 */
export interface FichaCiapSaneamento {
  bemId: string;
  codigoBem: string;
  identificacaoBem: string;
  classificacao: ClassificacaoSaneamentoCiap;
  /** Motivos da ambiguidade (vazio quando `OK`), em ordem estável. */
  motivos: MotivoSaneamentoCiap[];
  /** Contador acumulado da ficha (apenas apresentado, nunca usado para reconstruir). */
  contadorParcelasApropriadas: number;
  /** Nº de apropriações POR COMPETÊNCIA conhecidas (razão real). */
  competenciasConhecidas: number;
  /**
   * SEMPRE `false`: este núcleo NUNCA reconstrói competências a partir do
   * contador (R5.4). Mantido explícito no contrato como garantia auditável de
   * que a correção de casos ambíguos depende de saneamento assistido (humano).
   */
  reconstruidoPorContador: false;
  /** Memória textual auditável do retrato (sempre preenchida). */
  memoria: string;
}

/**
 * Diagnóstico de saneamento assistido do CIAP de um cliente (R5.4). Projeção
 * read-only, apresentável diretamente: fichas OK × fichas que exigem saneamento
 * assistido, com os motivos. É um RETRATO — não altera nada no banco e não
 * reconstrói nenhuma competência.
 */
export interface DiagnosticoSaneamentoCiap {
  clienteId: string;
  geradoEm: string;
  fichas: FichaCiapSaneamento[];
  resumo: {
    totalFichas: number;
    fichasOk: number;
    fichasAmbiguas: number;
    /** Contagem de fichas por motivo de ambiguidade (motivo → nº de fichas). */
    porMotivo: Record<MotivoSaneamentoCiap, number>;
    /**
     * SEMPRE `false`: nenhuma competência foi reconstruída a partir de contador
     * (R5.4). Garantia auditável no nível do diagnóstico inteiro.
     */
    reconstruiuPorContador: false;
  };
}

/**
 * Fatos do diagnóstico de saneamento JÁ CARREGADOS do banco (read-only) pelo
 * serviço. Contrato de entrada do núcleo puro: nenhuma consulta aqui.
 */
export interface DiagnosticoSaneamentoCiapFatos {
  clienteId: string;
  /** Momento do retrato (ISO), para registrar quando o diagnóstico foi tirado. */
  geradoEm: string;
  fichas: FichaCiapSaneamentoFatos[];
}

/** Ordem estável e previsível dos motivos na apresentação. */
const ORDEM_MOTIVOS: MotivoSaneamentoCiap[] = [
  'FLAG_SANEAMENTO_PENDENTE',
  'IDENTIDADE_NAO_COMPROVADA',
  'CONTADOR_SEM_RAZAO',
  'CONTADOR_DIVERGE_DA_RAZAO',
  'NUMERACAO_PARCELA_INCONSISTENTE',
];

/**
 * CLASSIFICA UMA ficha CIAP para o saneamento assistido (R5.4). Puro e
 * determinístico: os mesmos fatos sempre produzem a mesma classificação. NUNCA
 * reconstrói competências — `reconstruidoPorContador` é sempre `false`.
 *
 * A ficha é `AMBIGUO_SANEAMENTO_ASSISTIDO` quando QUALQUER sinal de ambiguidade
 * está presente; só é `OK` quando TODOS os sinais estão limpos:
 *
 *  1. FLAG_SANEAMENTO_PENDENTE — a migração de identidade (Fase 2) já marcou
 *     `saneamentoPendente`. Respeitamos o flag (não o "resolvemos").
 *  2. IDENTIDADE_NAO_COMPROVADA — `origemIdentidade` não é `'aquisicao'`
 *     (ficha legada/reconstruída sem lastro em item escriturado).
 *  3. CONTADOR_SEM_RAZAO — contador > 0 e NENHUMA apropriação por competência
 *     conhecida. O estado é "só contador"; reconstruir dele é proibido (R5.4).
 *  4. CONTADOR_DIVERGE_DA_RAZAO — contador ≠ nº de competências conhecidas (em
 *     qualquer direção): a razão está incompleta ou tem registros a mais.
 *  5. NUMERACAO_PARCELA_INCONSISTENTE — números de parcela duplicados, fora de
 *     1..quantidadeParcelas, ou a MAIOR parcela não coincide com o contador.
 *
 * Note que NENHUM ramo "preenche" as competências ausentes para zerar a
 * divergência — a divergência vira motivo de saneamento, não insumo de
 * reconstrução.
 */
export function classificarFichaSaneamento(
  ficha: FichaCiapSaneamentoFatos,
): FichaCiapSaneamento {
  const motivos: MotivoSaneamentoCiap[] = [];
  const contador = ficha.contadorParcelasApropriadas;
  const competencias = ficha.apropriacoesConhecidas;
  const conhecidas = competencias.length;

  // 1. Flag de saneamento já marcado pela migração de identidade (Fase 2).
  if (ficha.saneamentoPendente) {
    motivos.push('FLAG_SANEAMENTO_PENDENTE');
  }

  // 2. Identidade não comprovada (sem lastro em item escriturado).
  if (ficha.origemIdentidade !== 'aquisicao') {
    motivos.push('IDENTIDADE_NAO_COMPROVADA');
  }

  // 3./4. Relação entre o CONTADOR e a RAZÃO conhecida. NUNCA reconstruímos as
  // competências que faltam para fechar o contador — a divergência é motivo de
  // saneamento, não insumo de inferência (R5.4).
  if (contador > 0 && conhecidas === 0) {
    motivos.push('CONTADOR_SEM_RAZAO');
  } else if (contador !== conhecidas) {
    // Contador e razão existem, mas não batem (em qualquer direção).
    motivos.push('CONTADOR_DIVERGE_DA_RAZAO');
  }

  // 5. Coerência interna dos números de parcela da razão conhecida.
  if (conhecidas > 0 && numeracaoInconsistente(competencias, ficha, contador)) {
    motivos.push('NUMERACAO_PARCELA_INCONSISTENTE');
  }

  const ambigua = motivos.length > 0;
  const classificacao: ClassificacaoSaneamentoCiap = ambigua
    ? 'AMBIGUO_SANEAMENTO_ASSISTIDO'
    : 'OK';

  return {
    bemId: ficha.bemId,
    codigoBem: ficha.codigoBem,
    identificacaoBem: ficha.identificacaoBem,
    classificacao,
    motivos: ordenarMotivos(motivos),
    contadorParcelasApropriadas: contador,
    competenciasConhecidas: conhecidas,
    reconstruidoPorContador: false,
    memoria: montarMemoria(
      ficha,
      classificacao,
      ordenarMotivos(motivos),
      conhecidas,
    ),
  };
}

/**
 * MONTA o diagnóstico de saneamento assistido do CIAP a partir dos fatos
 * carregados (tarefa 5.4 — R5.4). Puro e determinístico. APENAS classifica/
 * agrega — não escreve, não migra e, acima de tudo, não reconstrói competências.
 */
export function montarDiagnosticoSaneamentoCiap(
  fatos: DiagnosticoSaneamentoCiapFatos,
): DiagnosticoSaneamentoCiap {
  const fichas = fatos.fichas
    .map(classificarFichaSaneamento)
    .sort((a, b) => a.codigoBem.localeCompare(b.codigoBem));

  const porMotivo = contarPorMotivo(fichas);
  const fichasAmbiguas = fichas.filter(
    (f) => f.classificacao === 'AMBIGUO_SANEAMENTO_ASSISTIDO',
  ).length;

  return {
    clienteId: fatos.clienteId,
    geradoEm: fatos.geradoEm,
    fichas,
    resumo: {
      totalFichas: fichas.length,
      fichasOk: fichas.length - fichasAmbiguas,
      fichasAmbiguas,
      porMotivo,
      reconstruiuPorContador: false,
    },
  };
}

/**
 * Coerência interna da numeração de parcela da razão conhecida. Retorna `true`
 * (inconsistente) quando: há número duplicado; algum número está fora de
 * 1..quantidadeParcelas; ou a MAIOR parcela conhecida não coincide com o
 * contador (quando o contador e a razão têm a mesma cardinalidade — i.e. não há
 * já uma divergência de contagem a reportar). Nenhuma competência é inferida.
 */
function numeracaoInconsistente(
  competencias: ApropriacaoCompetenciaFato[],
  ficha: FichaCiapSaneamentoFatos,
  contador: number,
): boolean {
  const numeros = competencias.map((c) => c.numeroParcela);

  // Fora da faixa legal 1..quantidadeParcelas.
  for (const n of numeros) {
    if (!Number.isInteger(n) || n < 1 || n > ficha.quantidadeParcelas) {
      return true;
    }
  }

  // Duplicados (duas apropriações para o mesmo número de parcela).
  if (new Set(numeros).size !== numeros.length) {
    return true;
  }

  // Quando contagem bate com o contador, a MAIOR parcela deveria coincidir com
  // ele (parcela de calendário é monotônica, R1.4). Se não coincide, a razão é
  // internamente incoerente — mas NÃO tentamos "consertar" preenchendo lacunas.
  if (competencias.length === contador && contador > 0) {
    const maior = Math.max(...numeros);
    if (maior !== contador) return true;
  }

  return false;
}

/** Ordena os motivos pela ordem estável de apresentação. */
function ordenarMotivos(
  motivos: MotivoSaneamentoCiap[],
): MotivoSaneamentoCiap[] {
  return ORDEM_MOTIVOS.filter((m) => motivos.includes(m));
}

/** Contagem de fichas por motivo (motivo → nº de fichas), zerada por padrão. */
function contarPorMotivo(
  fichas: FichaCiapSaneamento[],
): Record<MotivoSaneamentoCiap, number> {
  const contagem = {
    FLAG_SANEAMENTO_PENDENTE: 0,
    IDENTIDADE_NAO_COMPROVADA: 0,
    CONTADOR_SEM_RAZAO: 0,
    CONTADOR_DIVERGE_DA_RAZAO: 0,
    NUMERACAO_PARCELA_INCONSISTENTE: 0,
  } satisfies Record<MotivoSaneamentoCiap, number>;
  for (const ficha of fichas) {
    for (const motivo of ficha.motivos) {
      contagem[motivo] += 1;
    }
  }
  return contagem;
}

/** Memória textual auditável do retrato de uma ficha (R5.4). */
function montarMemoria(
  ficha: FichaCiapSaneamentoFatos,
  classificacao: ClassificacaoSaneamentoCiap,
  motivos: MotivoSaneamentoCiap[],
  conhecidas: number,
): string {
  const escopo = `Ficha ${ficha.codigoBem} (${ficha.identificacaoBem})`;
  const estado =
    `contador=${ficha.contadorParcelasApropriadas}, competências ` +
    `conhecidas na razão=${conhecidas} de ${ficha.quantidadeParcelas}`;

  if (classificacao === 'OK') {
    return (
      `${escopo}: razão por competência CONSISTENTE com o contador (${estado}); ` +
      'nada a sanear.'
    );
  }

  const descricaoMotivo: Record<MotivoSaneamentoCiap, string> = {
    FLAG_SANEAMENTO_PENDENTE:
      'ficha já marcada para saneamento assistido pela migração de identidade',
    IDENTIDADE_NAO_COMPROVADA: `identidade não comprovada (origem=${ficha.origemIdentidade})`,
    CONTADOR_SEM_RAZAO:
      'contador acumulado sem nenhuma apropriação por competência na razão',
    CONTADOR_DIVERGE_DA_RAZAO:
      'contador acumulado diverge do nº de competências conhecidas',
    NUMERACAO_PARCELA_INCONSISTENTE:
      'numeração de parcela da razão internamente inconsistente',
  };

  const lista = motivos.map((m) => descricaoMotivo[m]).join('; ');
  return (
    `${escopo}: AMBÍGUA — ${lista} (${estado}). As competências ausentes NÃO ` +
    'são reconstruídas a partir do contador (R5.4); encaminhar para saneamento ' +
    'assistido (decisão humana).'
  );
}
