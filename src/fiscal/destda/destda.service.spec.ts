import { UnprocessableEntityException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DestdaService } from './destda.service';
import type { DestdaTotais } from './destda.types';
import { validateDestdaFile } from './destda-validator';

jest.mock('../../cadastros/contadores/contador-resolver', () => ({
  resolverContadorDoCliente: jest.fn(),
}));
import { resolverContadorDoCliente } from '../../cadastros/contadores/contador-resolver';

const empresaBase = {
  tipoPessoa: 'PJ',
  cnpj: '00.123.456/0001-90',
  razaoSocial: 'Comércio Exemplo ME',
  emails: ['contato@exemplo.com.br'],
  cep: '40000000',
  logradouro: 'Rua A',
  numero: '10',
  complemento: null,
  bairro: 'Centro',
  uf: 'BA',
  regimeTributario: 'SIMPLES_NACIONAL',
  inscricaoEstadual: '012.345.678',
  inscricaoMunicipalCadastro: null,
  contadorId: 'contador-1',
  configuracaoId: 'config-1',
  codigoMunicipioIbge: '2927408',
  nomeFantasia: 'Exemplo',
  inscricaoMunicipal: null,
  suframa: null,
  nire: null,
  telefone: null,
  fax: null,
  responsavelNome: 'Maria Souza',
  responsavelCpf: '12345678909',
  responsavelCodAssinante: '801',
  inscricoesSubstituto: [{ uf: 'SP', ie: '111.222.333.444' }],
  perfil: {},
  spedCodigoMunicipioIbge: null,
  spedNomeFantasia: null,
  spedInscricaoMunicipal: null,
  spedSuframa: null,
  spedTelefone: null,
  spedFax: null,
};

const contador = {
  id: 'contador-1',
  nome: 'Contador Exemplo',
  cpf: '98765432100',
  crc: 'BA012345',
  cnpj: null,
  cep: null,
  logradouro: null,
  numero: null,
  complemento: null,
  bairro: null,
  telefone: null,
  fax: null,
  email: null,
  codigoMunicipioIbge: '2927408',
};

const totaisComMovimento: DestdaTotais = {
  entradas: [{ indSit: '1', totalNf: 12345n, ajustes: 0n }],
  consumoFinal: [{ uf: 'SP', totalNf: 2050n, ajustes: 0n }],
  st: [
    {
      indOper: '1',
      indEmit: '0',
      uf: 'SP',
      indTpSt: '0',
      totalNf: 500n,
      ajustes: 0n,
    },
  ],
};

function criar(options: {
  empresa?: Record<string, unknown>;
  contador?: typeof contador | null;
  totais?: DestdaTotais;
  inconsistencias?: Array<{
    codigo: string;
    severidade: 'ERRO' | 'AVISO';
    mensagem: string;
  }>;
}) {
  const empresa = { ...empresaBase, ...options.empresa };
  const select = jest.fn().mockReturnValue({
    from: () => ({
      leftJoin: () => ({
        leftJoin: () => ({
          where: () => ({ limit: () => Promise.resolve([empresa]) }),
        }),
      }),
    }),
  });
  const values = jest.fn().mockResolvedValue(undefined);
  const where = jest.fn().mockResolvedValue(undefined);
  const set = jest.fn().mockReturnValue({ where });
  const db = {
    select,
    insert: jest.fn().mockReturnValue({ values }),
    update: jest.fn().mockReturnValue({ set }),
  };
  (resolverContadorDoCliente as jest.Mock).mockResolvedValue(
    options.contador === null
      ? null
      : { contador: options.contador ?? contador, origem: 'VINCULO_EXPLICITO' },
  );
  const apuracao = {
    apurar: jest.fn().mockResolvedValue({
      totais: options.totais ?? totaisComMovimento,
      inconsistencias: options.inconsistencias ?? [],
    }),
  };
  const storage = { upload: jest.fn().mockResolvedValue(undefined) };
  const logger = { error: jest.fn() };
  const service = new DestdaService(
    { db } as never,
    storage as never,
    logger as never,
    apuracao as never,
  );
  return { service, values, set, storage, apuracao };
}

const entrada = {
  clienteId: 'cliente-1',
  competencia: '2026-02',
  finalidade: '0' as const,
};

describe('DestdaService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('monta a prévia e libera a geração quando tudo está completo', async () => {
    const { service } = criar({});
    const preview = await service.preview(entrada);
    expect(preview.podeGerar).toBe(true);
    expect(preview.inconsistencias).toEqual([]);
    expect(preview.codVersao).toBe('2000');
    expect(preview.semMovimento).toBe(false);
    expect(preview.totais.totalADeclarar).toBe('148.95');
    expect(preview.contadores.porRegistro).toMatchObject({
      '0000': 1,
      '0002': 1,
      G600: 1,
      G615: 1,
      G625: 1,
    });
  });

  it('gera, valida, armazena e devolve o arquivo com o hash do conteúdo', async () => {
    const { service, values, storage, set } = criar({});
    const arquivo = await service.gerar({
      ...entrada,
      actorUserId: 'user-1',
    });
    expect(arquivo.filename).toBe('DESTDA_00123456000190_202602.txt');
    expect(validateDestdaFile(arquivo.buffer).valid).toBe(true);
    expect(arquivo.hashSha256).toBe(
      createHash('sha256').update(arquivo.buffer).digest('hex'),
    );
    expect(storage.upload).toHaveBeenCalledWith(
      expect.stringMatching(
        /^clientes\/00123456000190\/fiscais\/destda\/2026\/02\/.+\.txt$/u,
      ),
      arquivo.buffer,
      'text/plain; charset=ISO-8859-1',
    );
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'PROCESSANDO', codVersao: '2000' }),
    );
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'GERADO' }),
    );
  });

  it('recusa empresa que não é optante pelo Simples Nacional', async () => {
    const { service } = criar({
      empresa: { regimeTributario: 'LUCRO_PRESUMIDO' },
    });
    await expect(service.preview(entrada)).rejects.toMatchObject({
      response: { code: 'ESTABELECIMENTO_NAO_SIMPLES' },
    });
  });

  it('bloqueia quando faltam responsável, município e contabilista', async () => {
    const { service } = criar({
      empresa: {
        responsavelNome: null,
        responsavelCpf: null,
        codigoMunicipioIbge: null,
      },
      contador: null,
    });
    const preview = await service.preview(entrada);
    expect(preview.podeGerar).toBe(false);
    expect(preview.inconsistencias.map((item) => item.codigo)).toEqual(
      expect.arrayContaining([
        'RESPONSAVEL_AUSENTE',
        'COD_MUN_AUSENTE',
        'CONTABILISTA_AUSENTE',
      ]),
    );
    await expect(
      service.gerar({ ...entrada, actorUserId: 'user-1' }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('exige inscrição de substituto para a UF com ICMS-ST retido', async () => {
    const { service } = criar({ empresa: { inscricoesSubstituto: [] } });
    const preview = await service.preview(entrada);
    expect(preview.podeGerar).toBe(false);
    expect(preview.inconsistencias).toContainEqual(
      expect.objectContaining({ codigo: 'IE_SUBSTITUTO_AUSENTE' }),
    );
  });

  it('propaga as pendências da apuração e não grava nada', async () => {
    const { service, values, storage } = criar({
      inconsistencias: [
        {
          codigo: 'DIFAL_ENTRADA_PENDENTE',
          severidade: 'ERRO',
          mensagem: 'pendente',
        },
      ],
    });
    const preview = await service.preview(entrada);
    expect(preview.podeGerar).toBe(false);
    await expect(
      service.gerar({ ...entrada, actorUserId: 'user-1' }),
    ).rejects.toMatchObject({ response: { code: 'DESTDA_INCONSISTENTE' } });
    expect(values).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('gera arquivo sem movimento quando não há valores a declarar', async () => {
    const { service } = criar({
      totais: { entradas: [], consumoFinal: [], st: [] },
    });
    const arquivo = await service.gerar({
      ...entrada,
      actorUserId: 'user-1',
    });
    const texto = arquivo.buffer.toString('latin1');
    expect(texto).toContain('|G020|9|01022026|28022026|\r\n');
    expect(validateDestdaFile(arquivo.buffer).valid).toBe(true);
  });
});
