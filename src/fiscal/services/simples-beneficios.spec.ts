import { validate } from 'class-validator';
import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AuthGuard } from '../../auth/auth.guard';
import { ROLES_KEY } from '../../auth/roles.decorator';
import { SimplesBeneficiosController } from '../controllers/simples-beneficios.controller';
import { SalvarSimplesBeneficioDto } from '../dto/simples-beneficio.dto';
import {
  assinaturaBeneficios,
  BENEFICIO_BA_2026,
  regrasBeneficioConflitam,
  resolverBeneficioSimples,
  type ContextoBeneficioSimples,
  type RegraBeneficioSimples,
} from './simples-beneficios';

const regra: RegraBeneficioSimples = {
  ...BENEFICIO_BA_2026,
  id: 'ba',
  versao: 1,
  atual: true,
};
const contexto: ContextoBeneficioSimples = {
  uf: 'BA',
  competencia: '2026-10',
  rbt12Faixa: '180000.00',
  rbt12Real: '180000.00',
  rbaAtual: '500000.00',
  rbaAnterior: '180000.00',
  dataAberturaCnpj: '2020-01-01',
  rbt12Proporcional: false,
};
describe('benefícios de ICMS do Simples', () => {
  it('BA inclui exatamente 180 mil nos 12 meses anteriores, mesmo com receita anual diferente', () => {
    expect(
      resolverBeneficioSimples([regra], contexto, 'ANEXO_I'),
    ).toMatchObject({
      codigo: regra.codigo,
      baseReceita: '180000.00',
      percentualReducao: '1.0000',
    });
    expect(
      resolverBeneficioSimples(
        [regra],
        { ...contexto, rbt12Faixa: '180000.01' },
        'ANEXO_I',
      ),
    ).toBeNull();
  });
  it('no início usa a receita anualizada para o benefício, mantendo a receita real separada', () => {
    const inicio = {
      ...contexto,
      dataAberturaCnpj: '2026-10-10',
      rbaAnterior: '0.00',
      rbt12Proporcional: true,
      rbt12Real: '0.00',
      rbt12Faixa: '180000.00',
    };
    expect(
      resolverBeneficioSimples([regra], inicio, 'ANEXO_II'),
    ).not.toBeNull();
    expect(
      resolverBeneficioSimples(
        [regra],
        { ...inicio, rbt12Faixa: '180000.12' },
        'ANEXO_II',
      ),
    ).toBeNull();
    expect(() =>
      resolverBeneficioSimples(
        [regra],
        { ...inicio, dataAberturaCnpj: null },
        'ANEXO_II',
      ),
    ).toThrow('data de abertura');
  });
  it('não aplica a outro estado, fora da vigência, em regra inativa ou atividade diferente', () => {
    expect(
      resolverBeneficioSimples([regra], { ...contexto, uf: 'SP' }, 'ANEXO_I'),
    ).toBeNull();
    expect(
      resolverBeneficioSimples(
        [regra],
        { ...contexto, competencia: '2027-01' },
        'ANEXO_I',
      ),
    ).toBeNull();
    expect(
      resolverBeneficioSimples(
        [{ ...regra, ativo: false }],
        contexto,
        'ANEXO_I',
      ),
    ).toBeNull();
    expect(
      resolverBeneficioSimples(
        [{ ...regra, atividades: ['ANEXO_II'] }],
        contexto,
        'ANEXO_I',
      ),
    ).toBeNull();
    expect(
      resolverBeneficioSimples(
        [regra],
        { ...contexto, competencia: '2026-12' },
        'ANEXO_I',
      ),
    ).not.toBeNull();
  });
  it('respeita o enquadramento como ME e o limite proporcional do ano anterior de abertura', () => {
    expect(
      resolverBeneficioSimples(
        [regra],
        { ...contexto, rbaAnterior: '360000.01' },
        'ANEXO_I',
      ),
    ).toBeNull();
    const inicial = {
      ...contexto,
      dataAberturaCnpj: '2025-11-15',
      rbaAnterior: '60000.00',
    };
    expect(
      resolverBeneficioSimples([regra], inicial, 'ANEXO_I'),
    ).not.toBeNull();
    expect(
      resolverBeneficioSimples(
        [regra],
        { ...inicial, rbaAnterior: '60000.01' },
        'ANEXO_I',
      ),
    ).toBeNull();
  });
  it('aceita regras futuras por receita anual e impede acumular benefícios sobrepostos', () => {
    const anual = {
      ...regra,
      somenteMe: false,
      criterioReceita: 'RBA_ATUAL',
      receitaAte: '600000.00',
    };
    expect(
      resolverBeneficioSimples([anual], contexto, 'ANEXO_I')?.baseReceita,
    ).toBe('500000.00');
    expect(regrasBeneficioConflitam(regra, anual)).toBe(true);
    expect(
      regrasBeneficioConflitam(regra, {
        ...regra,
        receitaDe: '180000.01',
        receitaAte: '360000.00',
      }),
    ).toBe(false);
    expect(
      regrasBeneficioConflitam(regra, {
        ...regra,
        vigenciaInicio: '2027-01-01',
        vigenciaFim: '2027-12-01',
      }),
    ).toBe(false);
    expect(() =>
      resolverBeneficioSimples(
        [regra, { ...regra, id: 'duplicada' }],
        contexto,
        'ANEXO_I',
      ),
    ).toThrow('conflitantes');
  });
  it('assina a configuração independentemente da ordem, detectando versões novas', () => {
    const outra = { ...regra, id: 'sp', uf: 'SP' };
    expect(assinaturaBeneficios([regra, outra])).toBe(
      assinaturaBeneficios([outra, regra]),
    );
    expect(assinaturaBeneficios([regra])).not.toBe(
      assinaturaBeneficios([{ ...regra, versao: 2 }]),
    );
  });
  it('protege a API para ADMIN e COLABORADOR e exclui CLIENTE', () => {
    const reflector = new Reflector();
    expect(
      reflector.get<string[]>(ROLES_KEY, SimplesBeneficiosController),
    ).toEqual(['ADMIN', 'COLABORADOR']);
    expect(
      reflector.get<unknown[]>(GUARDS_METADATA, SimplesBeneficiosController),
    ).toContain(AuthGuard);
  });
  it('valida os campos do cadastro antes de chegar à persistência', async () => {
    const dto = Object.assign(
      new SalvarSimplesBeneficioDto(),
      BENEFICIO_BA_2026,
      { versaoAnterior: 0 },
    );
    expect(await validate(dto)).toEqual([]);
    const erros = await validate(
      Object.assign(new SalvarSimplesBeneficioDto(), dto, {
        uf: 'XX',
        atividades: ['ANEXO_III'],
        fonteUrl: 'javascript:alert(1)',
        vigenciaInicio: '2026-13-01',
        percentualReducao: '1e2',
      }),
    );
    expect(erros.map((erro) => erro.property)).toEqual(
      expect.arrayContaining([
        'uf',
        'atividades',
        'fonteUrl',
        'vigenciaInicio',
        'percentualReducao',
      ]),
    );
  });
});
