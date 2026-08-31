import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  AtualizarInventarioSpedDto,
  SpedInventarioItemDto,
  SpedInventarioParticipanteDto,
} from './dto/sped-inventario.dto';
import {
  assertInventoryPayload,
  assertInventoryAccountingAccounts,
  calculateInventoryItemValue,
  normalizeInventoryUnitCode,
  stableInventoryItemCode,
  stableInventoryParticipantCode,
} from './sped-inventario.service';

function makeItem(
  overrides: Partial<SpedInventarioItemDto> = {},
): SpedInventarioItemDto {
  return {
    codigoExterno: 'SKU-0001',
    descricao: 'Mercadoria para revenda',
    unidade: 'UN',
    descricaoUnidade: 'Unidade',
    tipoItem: '00',
    ncm: '22030000',
    quantidade: '10.500',
    valorUnitario: '12.345679',
    valorItem: '129.63',
    indicadorPropriedade: '0',
    ...overrides,
  };
}

function makeInventory(
  overrides: Partial<AtualizarInventarioSpedDto> = {},
): AtualizarInventarioSpedDto {
  return {
    motivo: '01',
    valorTotal: '129.63',
    status: 'FECHADO',
    itens: [makeItem()],
    ...overrides,
  };
}

function makeParticipant(
  overrides: Partial<SpedInventarioParticipanteDto> = {},
): SpedInventarioParticipanteDto {
  return {
    tipoDocumento: 'CNPJ',
    documento: '09157533000156',
    nome: 'Depositário do estoque',
    codigoPais: '01058',
    inscricaoEstadual: 'ISENTO',
    codigoMunicipioIbge: '2927408',
    logradouro: 'Rua do Depósito',
    numero: '100',
    bairro: 'Centro',
    cep: '40000000',
    ...overrides,
  };
}

describe('SpedInventarioService invariants', () => {
  it('calcula quantidade por valor unitário com arredondamento fiscal em centavos', () => {
    expect(calculateInventoryItemValue('10.500', '12.345679')).toBe(12_963n);
    expect(calculateInventoryItemValue('1.000', '0.005000')).toBe(1n);
  });

  it('aceita inventário cujo cabeçalho e itens fecham exatamente', () => {
    expect(() => assertInventoryPayload(makeInventory())).not.toThrow();
  });

  it('rejeita divergência entre a soma dos itens e o valor total', () => {
    expect(() =>
      assertInventoryPayload(makeInventory({ valorTotal: '129.62' })),
    ).toThrow(BadRequestException);
  });

  it('rejeita valor do item divergente de quantidade vezes valor unitário', () => {
    expect(() =>
      assertInventoryPayload(
        makeInventory({
          valorTotal: '129.62',
          itens: [makeItem({ valorItem: '129.62' })],
        }),
      ),
    ).toThrow('deve ser 129.63');
  });

  it('exige participante para bens de propriedade 1 ou 2', () => {
    expect(() =>
      assertInventoryPayload(
        makeInventory({
          itens: [makeItem({ indicadorPropriedade: '1' })],
        }),
      ),
    ).toThrow('exige participante');
  });

  it('rejeita participante em item de propriedade própria', () => {
    expect(() =>
      assertInventoryPayload(
        makeInventory({
          itens: [makeItem({ participanteDocumento: '09157533000156' })],
        }),
      ),
    ).toThrow('não deve informar participante');
  });

  it('não aceita o mesmo item duas vezes para o mesmo indicador e participante', () => {
    expect(() =>
      assertInventoryPayload(
        makeInventory({
          valorTotal: '259.26',
          itens: [makeItem(), makeItem()],
        }),
      ),
    ).toThrow('está duplicado');
  });

  it('permite inventário fechado sem estoque e impede H010 com total zero', () => {
    expect(() =>
      assertInventoryPayload(
        makeInventory({ status: 'FECHADO', valorTotal: '0.00', itens: [] }),
      ),
    ).not.toThrow();
    expect(() =>
      assertInventoryPayload(
        makeInventory({
          valorTotal: '0.00',
          itens: [
            makeItem({
              quantidade: '0.000',
              valorUnitario: '0.000000',
              valorItem: '0.00',
            }),
          ],
        }),
      ),
    ).toThrow('H010 não pode ser informado');
  });

  it('permite o mesmo item em poder ou propriedade de participantes distintos', () => {
    expect(() =>
      assertInventoryPayload(
        makeInventory({
          valorTotal: '259.26',
          itens: [
            makeItem({
              indicadorPropriedade: '1',
              participanteDocumento: '09157533000156',
            }),
            makeItem({
              indicadorPropriedade: '1',
              participanteDocumento: '12345678000190',
            }),
          ],
        }),
      ),
    ).not.toThrow();
  });

  it('aceita no payload o participante necessário à primeira geração', () => {
    expect(() =>
      assertInventoryPayload(
        makeInventory({
          itens: [
            makeItem({
              indicadorPropriedade: '1',
              participanteDocumento: '09157533000156',
            }),
          ],
          participantes: [makeParticipant()],
        }),
      ),
    ).not.toThrow();
  });

  it('rejeita tipo documental incompatível e definições duplicadas divergentes', () => {
    expect(() =>
      assertInventoryPayload(
        makeInventory({
          participantes: [makeParticipant({ tipoDocumento: 'CPF' })],
        }),
      ),
    ).toThrow('não corresponde ao tipo CPF');

    expect(() =>
      assertInventoryPayload(
        makeInventory({
          participantes: [
            makeParticipant(),
            makeParticipant({ nome: 'Outro nome' }),
          ],
        }),
      ),
    ).toThrow('dados divergentes');
  });

  it('não fecha motivos que exigem H020/H030 ainda não suportados', () => {
    expect(() =>
      assertInventoryPayload(makeInventory({ motivo: '02' })),
    ).toThrow('Somente o inventário de motivo 01 pode ser fechado');
    expect(() =>
      assertInventoryPayload(
        makeInventory({ motivo: '02', status: 'RASCUNHO' }),
      ),
    ).not.toThrow();
  });

  it('exige conta contábil ao fechar inventário dos perfis A e B', () => {
    expect(() =>
      assertInventoryAccountingAccounts('A', makeInventory()),
    ).toThrow('COD_CTA');
    expect(() =>
      assertInventoryAccountingAccounts(
        'B',
        makeInventory({ itens: [makeItem({ codigoConta: '1.1.3.01' })] }),
      ),
    ).not.toThrow();
    expect(() =>
      assertInventoryAccountingAccounts('C', makeInventory()),
    ).not.toThrow();
  });

  it('gera códigos estáveis compatíveis com o catálogo e normaliza unidades', () => {
    expect(stableInventoryItemCode('SKU-0001')).toMatch(/^I[A-F0-9]{15}$/);
    expect(stableInventoryItemCode('SKU-0001')).toBe(
      stableInventoryItemCode('SKU-0001'),
    );
    expect(stableInventoryItemCode('SKU-0001')).not.toBe(
      stableInventoryItemCode('SKU-0002'),
    );
    expect(normalizeInventoryUnitCode('  peça  ')).toBe('PECA');
    expect(normalizeInventoryUnitCode('unidade')).toBe('UNIDADE');
    expect(stableInventoryParticipantCode('09157533000156')).toMatch(
      /^P[A-F0-9]{15}$/,
    );
  });

  it('aceita CNPJ alfanumérico normalizado no DTO', async () => {
    const dto = plainToInstance(AtualizarInventarioSpedDto, {
      motivo: '01',
      valorTotal: '129,63',
      status: 'fechado',
      itens: [
        {
          ...makeItem({ indicadorPropriedade: '2' }),
          participanteDocumento: 'ABC123DEF456-78',
        },
      ],
      participantes: [
        makeParticipant({
          documento: 'ABC123DEF456-78',
          codigoPais: '1058',
        }),
      ],
    });

    expect(await validate(dto)).toEqual([]);
    expect(dto.valorTotal).toBe('129.63');
    expect(dto.status).toBe('FECHADO');
    expect(dto.itens[0].participanteDocumento).toBe('ABC123DEF45678');
    expect(dto.participantes?.[0].documento).toBe('ABC123DEF45678');
    expect(dto.participantes?.[0].codigoPais).toBe('01058');
  });

  it('aplica os limites oficiais de casas decimais e tamanho da unidade', async () => {
    const valid = plainToInstance(AtualizarInventarioSpedDto, makeInventory());
    expect(await validate(valid)).toEqual([]);

    const invalid = plainToInstance(AtualizarInventarioSpedDto, {
      ...makeInventory(),
      itens: [
        makeItem({
          unidade: 'unidade',
          quantidade: '10.5000',
          valorUnitario: '12.3456789',
        }),
      ],
    });
    const errors = await validate(invalid);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('itens');
  });
});
