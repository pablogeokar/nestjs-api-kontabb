import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { RegistrarPerfilManualDto } from '../dto/perfil-fiscal.dto';
import { clientesPerfisFiscais } from '../../database/schema';
import { validarPerfilManual } from './estabelecimento-perfil';
import { EstabelecimentoPerfilService } from './estabelecimento-perfil.service';

const base = {
  vigenciaInicio: '2025-03-01',
  vigenciaFim: null,
  uf: 'ba',
  inscricaoEstadual: '123456',
  regimeTributario: 'LUCRO_REAL',
  fonte: 'Comprovante de inscrição SEFAZ-BA',
  justificativa: 'Mudança de regime com efeitos desde março/2025',
};

// tx falso. `selects` é a fila de resultados de select (cliente, sobrepostos,
// perfil...). Cada update devolve o próximo item de `returns`.
function fakeDb(selects: unknown[][], returns: unknown[][] = []) {
  const updates: Array<{ set: Record<string, unknown> }> = [];
  const inserts: Array<Record<string, unknown>> = [];
  const next = () => Promise.resolve(selects.shift() ?? []);
  const where = () => {
    const p = next();
    return Object.assign(p, { limit: () => p, orderBy: () => p });
  };
  const tx = {
    execute: jest.fn().mockResolvedValue(undefined),
    select: () => ({ from: () => ({ where }) }),
    update: (table: unknown) => {
      expect(table).toBe(clientesPerfisFiscais);
      return {
        set: (set: Record<string, unknown>) => {
          updates.push({ set });
          const ret = Promise.resolve(returns.shift() ?? []);
          return {
            where: () =>
              Object.assign(Promise.resolve(), { returning: () => ret }),
          };
        },
      };
    },
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        inserts.push(v);
        return { returning: () => Promise.resolve([v]) };
      },
    }),
  };
  return {
    updates,
    inserts,
    db: { transaction: (cb: (t: typeof tx) => unknown) => cb(tx) },
  };
}

describe('validarPerfilManual', () => {
  it('aceita um perfil válido', () => {
    expect(validarPerfilManual(base)).toEqual([]);
  });
  it('rejeita data inexistente, fim anterior ao início, UF e regime inválidos', () => {
    expect(
      validarPerfilManual({ ...base, vigenciaInicio: '2025-02-30' }),
    ).toHaveLength(1);
    expect(
      validarPerfilManual({ ...base, vigenciaFim: '2025-02-28' }),
    ).toContain('O fim da vigência não pode ser anterior ao início.');
    expect(validarPerfilManual({ ...base, uf: 'ZZ' })).toContain(
      'UF inválida.',
    );
    expect(validarPerfilManual({ ...base, regimeTributario: 'MEI' })).toContain(
      'Regime tributário inválido.',
    );
  });
  it('exige fonte e justificativa', () => {
    const e = validarPerfilManual({
      ...base,
      fonte: ' ',
      justificativa: 'curta',
    });
    expect(e).toHaveLength(2);
  });
});

describe('RegistrarPerfilManualDto', () => {
  it('normaliza a UF e valida formato', () => {
    const ok = plainToInstance(RegistrarPerfilManualDto, base);
    expect(validateSync(ok)).toEqual([]);
    expect(ok.uf).toBe('BA');
    const ruim = plainToInstance(RegistrarPerfilManualDto, {
      ...base,
      vigenciaInicio: '01/03/2025',
    });
    expect(validateSync(ruim)).not.toEqual([]);
  });
});

describe('EstabelecimentoPerfilService.registrarManual', () => {
  it('cria o perfil MANUAL com autor, fonte e substitui linhas automáticas do período', async () => {
    const f = fakeDb([[{ id: 'c1' }], []], [[{ id: 'a1' }, { id: 'a2' }]]);
    const out = await new EstabelecimentoPerfilService(
      f as never,
    ).registrarManual('c1', base, 'u1');

    expect(out.linhas_automaticas_substituidas).toBe(2);
    expect(out.competencias_afetadas).toEqual({ de: '2025-03', ate: null });
    const criado = f.inserts[0];
    expect(criado).toMatchObject({
      clienteId: 'c1',
      origem: 'MANUAL',
      uf: 'BA',
      criadoPor: 'u1',
      fonte: base.fonte,
    });
    // As linhas desativadas apontam para o perfil criado (restauração possível).
    expect(f.updates[0].set).toEqual({
      ativo: false,
      substituidoPor: criado.id,
    });
  });

  it('recusa sobreposição com outro perfil manual ativo, sem escrever nada', async () => {
    const f = fakeDb([
      [{ id: 'c1' }],
      [{ id: 'm1', vigenciaInicio: '2025-01-01', vigenciaFim: '2025-06-30' }],
    ]);
    await expect(
      new EstabelecimentoPerfilService(f as never).registrarManual(
        'c1',
        base,
        'u1',
      ),
    ).rejects.toThrow('Já existe perfil manual ativo');
    expect(f.updates).toHaveLength(0);
    expect(f.inserts).toHaveLength(0);
  });

  it('retorna 404 para empresa inexistente e 400 para dados inválidos', async () => {
    const f = fakeDb([[]]);
    const svc = new EstabelecimentoPerfilService(f as never);
    await expect(svc.registrarManual('c1', base, 'u1')).rejects.toThrow(
      'Empresa não encontrada',
    );
    await expect(
      svc.registrarManual('c1', { ...base, uf: 'ZZ' }, 'u1'),
    ).rejects.toThrow();
    expect(f.inserts).toHaveLength(0);
  });
});

describe('EstabelecimentoPerfilService.removerManual', () => {
  const manual = {
    id: 'p1',
    clienteId: 'c1',
    origem: 'MANUAL',
    ativo: true,
    vigenciaInicio: '2025-03-01',
    vigenciaFim: null,
  };

  it('desativa o perfil e restaura as linhas automáticas substituídas', async () => {
    const f = fakeDb([[manual]], [[], [{ id: 'a1' }]]);
    const out = await new EstabelecimentoPerfilService(
      f as never,
    ).removerManual('c1', 'p1');
    expect(out.linhas_automaticas_restauradas).toBe(1);
    expect(f.updates[0].set).toEqual({ ativo: false });
    expect(f.updates[1].set).toEqual({ ativo: true, substituidoPor: null });
  });

  it('não remove linha automática, de outro cliente ou já removida', async () => {
    const svc = (rows: unknown[]) =>
      new EstabelecimentoPerfilService(fakeDb([rows]) as never);
    await expect(
      svc([{ ...manual, origem: 'ALTERACAO_CADASTRAL' }]).removerManual(
        'c1',
        'p1',
      ),
    ).rejects.toThrow('Só perfis informados manualmente');
    await expect(svc([]).removerManual('c1', 'p1')).rejects.toThrow(
      'Perfil não encontrado',
    );
    await expect(
      svc([{ ...manual, ativo: false }]).removerManual('c1', 'p1'),
    ).rejects.toThrow('já removido');
  });
});
