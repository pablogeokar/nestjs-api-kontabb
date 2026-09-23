import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AuthGuard } from '../../auth/auth.guard';
import { ROLES_KEY } from '../../auth/roles.decorator';
import {
  AdminFiscalApuracaoController,
  ClienteFiscalApuracaoController,
} from './fiscal-apuracao.controller';

type Deps = {
  clientesService: { getClientForUser: jest.Mock };
  fiscalItensService: { getApuracaoIcms: jest.Mock };
};

function createController(overrides?: Partial<Deps>) {
  const deps: Deps = {
    clientesService: {
      getClientForUser: jest.fn().mockResolvedValue({ id: 'cliente-1' }),
    },
    fiscalItensService: {
      getApuracaoIcms: jest.fn().mockResolvedValue({
        total_creditos: '0.00',
        total_debitos: '0.00',
        saldo_apurado: '0.00',
        creditos_frete_cte: '0.00',
        observacao: null,
      }),
    },
    ...overrides,
  };
  const controller = new ClienteFiscalApuracaoController(
    deps.clientesService as never,
    {} as never, // ciapService
    {} as never, // difalService
    {} as never, // guiasService
    {} as never, // pisCofinsService
    deps.fiscalItensService as never,
  );
  return { controller, deps };
}

const user = { id: 'user-1' } as never;

describe('ClienteFiscalApuracaoController — apurarIcms', () => {
  it('converte a competência AAAA-MM no intervalo do mês no servidor', async () => {
    const { controller, deps } = createController();

    await controller.apurarIcms('2026-02', user);

    const call = deps.fiscalItensService.getApuracaoIcms.mock.calls[0][0];
    expect(call.clienteId).toBe('cliente-1');
    expect(call.dataInicio.toISOString()).toBe('2026-02-01T00:00:00.000Z');
    // Fevereiro de 2026 tem 28 dias.
    expect(call.dataFim.toISOString()).toBe('2026-02-28T23:59:59.999Z');
  });

  it('devolve o resultado dentro do envelope { data }', async () => {
    const apuracao = {
      total_creditos: '10.00',
      total_debitos: '100.00',
      saldo_apurado: '90.00',
      creditos_frete_cte: '0.00',
      observacao: null,
    };
    const { controller } = createController({
      fiscalItensService: {
        getApuracaoIcms: jest.fn().mockResolvedValue(apuracao),
      },
    });

    const response = await controller.apurarIcms('2026-01', user);

    expect(response).toEqual({ data: apuracao });
  });

  it('cada competência é convertida no seu próprio intervalo', async () => {
    const { controller, deps } = createController();

    await controller.apurarIcms('2026-01', user);
    await controller.apurarIcms('2026-02', user);

    const [primeira] = deps.fiscalItensService.getApuracaoIcms.mock.calls[0];
    const [segunda] = deps.fiscalItensService.getApuracaoIcms.mock.calls[1];
    expect(primeira.dataInicio.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(primeira.dataFim.toISOString()).toBe('2026-01-31T23:59:59.999Z');
    expect(segunda.dataInicio.toISOString()).toBe('2026-02-01T00:00:00.000Z');
    expect(segunda.dataFim.toISOString()).toBe('2026-02-28T23:59:59.999Z');
  });

  it('rejeita competência inválida com BadRequest sem consultar o serviço', async () => {
    const { controller, deps } = createController();

    await expect(controller.apurarIcms('2026-13', user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(controller.apurarIcms('fevereiro', user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(deps.fiscalItensService.getApuracaoIcms).not.toHaveBeenCalled();
  });
});

describe('AdminFiscalApuracaoController — guarda de staff preservada (R6.4)', () => {
  it('mantém o AuthGuard aplicado no controller admin', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      AdminFiscalApuracaoController,
    );
    expect(guards).toContain(AuthGuard);
  });

  it('mantém o @StaffOnly (roles ADMIN/COLABORADOR) no controller admin', () => {
    // @StaffOnly() aplica SetMetadata(ROLES_KEY, ['ADMIN', 'COLABORADOR']).
    const roles = Reflect.getMetadata(
      ROLES_KEY,
      AdminFiscalApuracaoController,
    );
    expect(roles).toEqual(['ADMIN', 'COLABORADOR']);
  });
});
