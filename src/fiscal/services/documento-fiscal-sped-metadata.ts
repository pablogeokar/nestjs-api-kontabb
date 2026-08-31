import type { ParsedDocumentoFiscal } from './dfe-document.parser';

export function buildDocumentoFiscalSpedMetadata(
  documento: ParsedDocumentoFiscal,
) {
  const totais = documento.icmsTot ? flattenTotals(documento) : null;
  const integridadeStatus =
    documento.integridade.status === 'DIVERGENTE' ? 'DIVERGENTE' : 'OK';

  return {
    dataEntradaSaida: documento.dataEntradaSaida,
    dataEmissaoFiscal: documento.dataEmissaoFiscal,
    dataEntradaSaidaFiscal: documento.dataEntradaSaidaFiscal,
    modalidadeFrete: documento.modalidadeFrete,
    codSituacaoSped:
      documento.situacao === 'AUTORIZADA'
        ? ('00' as const)
        : documento.situacao === 'CANCELADA'
          ? ('02' as const)
          : null,
    valorTotalDeclaradoXml: documento.icmsTot?.vNF || documento.valorTotal,
    totaisDeclaradosXml: totais,
    quantidadeItensDeclaradaXml: documento.quantidadeItensDeclarada,
    integridadeConferida: true,
    integridadeStatus,
    integridadeDetalhes: {
      ...documento.integridade,
      verificacoes: documento.integridade.verificacoes.map((item) => ({
        ...item,
      })),
      divergencias: documento.integridade.divergencias.map((item) => ({
        ...item,
      })),
    },
    emitenteDados: { ...documento.emitente },
    destinatarioDados: documento.destinatario
      ? { ...documento.destinatario }
      : null,
    informacoesComplementares:
      documento.informacoesComplementares.contribuinte || null,
  };
}

export function documentoNfePrecisaRevisao(
  documento: ParsedDocumentoFiscal,
  itens: ReadonlyArray<{ cfopRevisaoNecessaria?: boolean }>,
) {
  return (
    documento.integridade.status === 'DIVERGENTE' ||
    itens.some((item) => item.cfopRevisaoNecessaria === true)
  );
}

function flattenTotals(documento: ParsedDocumentoFiscal) {
  const icmsTot = documento.icmsTot!;
  const { camposAdicionais, ...knownTotals } = icmsTot;
  return {
    ...camposAdicionais,
    ...knownTotals,
    vPISST: documento.pisCofinsTotais?.vPISST ?? null,
    vCOFINSST: documento.pisCofinsTotais?.vCOFINSST ?? null,
  };
}
