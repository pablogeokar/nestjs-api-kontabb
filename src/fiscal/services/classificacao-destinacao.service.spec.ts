import {
  ClassificacaoDestinacaoService,
  inferirPorPerfil,
  vocacaoCnae,
} from './classificacao-destinacao.service';

const input = {
  clienteId: 'cliente-1',
  ncm: '72011000',
  codigoProduto: 'A',
  emitenteCnpjCpf: '12.345.678/0001-95',
  descricao: 'Aço',
};
describe('classificação de destinação', () => {
  it.each([
    ['0510001', 'INDUSTRIA'],
    ['3314701', 'INDUSTRIA'],
    ['4711301', 'COMERCIO'],
    ['6201501', 'OUTRAS'],
    [null, 'DESCONHECIDA'],
    ['47', 'DESCONHECIDA'],
  ])('mapeia CNAE %s', (codigo, esperado) => {
    expect(vocacaoCnae(codigo)).toBe(esperado);
  });
  it('diferencia indústria, comércio e serviço sem dispensar confirmação', () => {
    expect(inferirPorPerfil(input, '2411300')).toMatchObject({
      destinacao: 'INDUSTRIALIZACAO',
      requerConfirmacao: true,
    });
    expect(inferirPorPerfil(input, '4711301')).toMatchObject({
      destinacao: 'REVENDA',
      requerConfirmacao: true,
    });
    expect(inferirPorPerfil(input, '6201501')).toMatchObject({
      destinacao: null,
      requerConfirmacao: true,
    });
  });
  it('reduz confiança de perfil misto e não determina ativo pelo NCM', () => {
    expect(
      inferirPorPerfil(input, '4711301', [{ code: '2411300' }]).confianca,
    ).toBeLessThan(inferirPorPerfil(input, '4711301').confianca);
    expect(
      inferirPorPerfil({ ...input, ncm: '84713012' }, '6201501').destinacao,
    ).toBeNull();
  });
  it('aceita apenas histórico unânime com pelo menos três confirmações', async () => {
    const service = historico([{ destinacao: 'REVENDA', total: 3 }]);
    await expect(service.classificar(input)).resolves.toMatchObject({
      destinacao: 'REVENDA',
      origem: 'HISTORICO',
      confianca: 0.95,
      requerConfirmacao: false,
    });
    await expect(
      historico([{ destinacao: 'REVENDA', total: 2 }]).classificar(input),
    ).resolves.toMatchObject({ requerConfirmacao: true });
  });
  it('bloqueia histórico conflitante independentemente da maioria', async () => {
    await expect(
      historico([
        { destinacao: 'REVENDA', total: 100 },
        { destinacao: 'USO_CONSUMO', total: 1 },
      ]).classificar(input),
    ).resolves.toMatchObject({ destinacao: null, requerConfirmacao: true });
  });
});
function historico(rows: unknown[]) {
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    groupBy: () => Promise.resolve(rows),
    limit: () => Promise.resolve([{ principal: '4711301', secundarios: [] }]),
  };
  const select = jest.fn().mockReturnValue(chain);
  return new ClassificacaoDestinacaoService({ db: { select } } as never);
}
