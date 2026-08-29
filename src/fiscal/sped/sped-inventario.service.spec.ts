import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  AtualizarInventarioSpedDto,
  SpedInventarioItemDto,
} from './dto/sped-inventario.dto';
import {
  assertInventoryPayload,
  calculateInventoryItemValue,
  normalizeInventoryUnitCode,
  stableInventoryItemCode,
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
    quantidade: '10.5000',
    valorUnitario: '12.3456789000',
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

describe('SpedInventarioService invariants', () => {
  it('calcula quantidade por valor unitário com arredondamento fiscal em centavos', () => {
    expect(calculateInventoryItemValue('10.5000', '12.3456789000')).toBe(
      12_963n,
    );
    expect(calculateInventoryItemValue('1.0000', '0.0050000000')).toBe(1n);
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

  it('não aceita o mesmo item duas vezes para o mesmo indicador', () => {
    expect(() =>
      assertInventoryPayload(
        makeInventory({
          valorTotal: '259.26',
          itens: [makeItem(), makeItem()],
        }),
      ),
    ).toThrow('está duplicado');
  });

  it('permite rascunho vazio somente com total zero', () => {
    expect(() =>
      assertInventoryPayload(
        makeInventory({ status: 'RASCUNHO', valorTotal: '0.00', itens: [] }),
      ),
    ).not.toThrow();
    expect(() =>
      assertInventoryPayload(
        makeInventory({ status: 'FECHADO', valorTotal: '0.00', itens: [] }),
      ),
    ).toThrow('ao menos um item');
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
    expect(normalizeInventoryUnitCode('unidade')).toBe('UNIDAD');
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
    });

    expect(await validate(dto)).toEqual([]);
    expect(dto.valorTotal).toBe('129.63');
    expect(dto.status).toBe('FECHADO');
    expect(dto.itens[0].participanteDocumento).toBe('ABC123DEF45678');
  });
});
