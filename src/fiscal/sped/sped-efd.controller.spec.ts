import { NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { Response } from 'express';
import { AuthGuard } from '../../auth/auth.guard';
import { ROLES_KEY } from '../../auth/roles.decorator';
import {
  AdminSpedEfdController,
  ClienteSpedEfdController,
} from './sped-efd.controller';

/**
 * Contrato HTTP da entrega SPED EFD ICMS/IPI (camada 3 do §11.1 — F22).
 *
 * O spec de contrato existente (`controllers/fiscal-apuracao.controller.spec`)
 * cobre a apuração; este fecha o lado da ENTREGA (o fluxo central da Fase 5),
 * cujo controller carregava guardas/escopo e um contrato de resposta de ARQUIVO
 * ainda sem spec. Aqui provamos o CONTRATO — não o cálculo do EFD, que é da
 * camada de arquivo (`efd-icms-ipi.*`):
 *
 *   - AUTH/ESCOPO: `AuthGuard` em ambos os controllers; `@StaffOnly`
 *     (ADMIN/COLABORADOR) apenas no admin — o controller do cliente NÃO expõe o
 *     escopo de staff (resolve o cliente pela sessão).
 *   - DTO/RESOLUÇÃO DE ESCOPO: o controller do cliente deriva o `clienteId` da
 *     SESSÃO (nunca do corpo); o admin recebe `clienteId` validado no DTO. Um
 *     usuário sem empresa recebe 404 — sem vazar para o serviço.
 *   - ENVELOPE `{ data }`: os GETs/PUTs de leitura/escrita respondem no envelope.
 *   - RESPOSTA DE ARQUIVO: `gerar` escreve o TXT em Latin-1 com os cabeçalhos
 *     normativos (Content-Type ISO-8859-1, Content-Disposition com filename,
 *     nosniff, ETag = hash, id de geração) — o contrato que o PVA/entrega consome.
 */

type ClienteDeps = {
  clientesService: { getClientForUser: jest.Mock };
  configuracaoService: { obter: jest.Mock; atualizar: jest.Mock };
  apuracaoContextoService: { obter: jest.Mock; atualizar: jest.Mock };
  inventarioService: { obter: jest.Mock; atualizar: jest.Mock };
  efdService: { preview: jest.Mock; gerar: jest.Mock };
};

function clienteDeps(overrides?: Partial<ClienteDeps>): ClienteDeps {
  return {
    clientesService: {
      getClientForUser: jest.fn().mockResolvedValue({ id: 'cliente-1' }),
    },
    configuracaoService: {
      obter: jest.fn().mockResolvedValue({ obrigadoEfdIcmsIpi: true }),
      atualizar: jest.fn().mockResolvedValue({ obrigadoEfdIcmsIpi: true }),
    },
    apuracaoContextoService: {
      obter: jest.fn().mockResolvedValue({ saldo: '0.00' }),
      atualizar: jest.fn().mockResolvedValue({ saldo: '0.00' }),
    },
    inventarioService: {
      obter: jest.fn().mockResolvedValue({ itens: [] }),
      atualizar: jest.fn().mockResolvedValue({ itens: [] }),
    },
    efdService: {
      preview: jest.fn().mockResolvedValue({ data: { inconsistencias: [] } }),
      gerar: jest.fn(),
    },
    ...overrides,
  };
}

function createClienteController(overrides?: Partial<ClienteDeps>) {
  const deps = clienteDeps(overrides);
  const controller = new ClienteSpedEfdController(
    deps.clientesService as never,
    deps.configuracaoService as never,
    deps.apuracaoContextoService as never,
    deps.inventarioService as never,
    deps.efdService as never,
  );
  return { controller, deps };
}

const user = { id: 'user-1' } as never;

function fakeResponse() {
  const headers: Record<string, unknown> = {};
  const res = {
    setHeader: jest.fn((name: string, value: unknown) => {
      headers[name] = value;
    }),
    end: jest.fn(),
  } as unknown as Response;
  return { res, headers };
}

const fakeRequest = { headers: {} } as never;

describe('SPED EFD — auth/escopo (contrato, §11.1 camada 3)', () => {
  it('aplica o AuthGuard nos dois controllers', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, ClienteSpedEfdController),
    ).toContain(AuthGuard);
    expect(
      Reflect.getMetadata(GUARDS_METADATA, AdminSpedEfdController),
    ).toContain(AuthGuard);
  });

  it('restringe o escopo de staff (ADMIN/COLABORADOR) SÓ ao controller admin', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AdminSpedEfdController)).toEqual([
      'ADMIN',
      'COLABORADOR',
    ]);
    // O controller do cliente NÃO é staff-only — resolve a empresa pela sessão.
    expect(
      Reflect.getMetadata(ROLES_KEY, ClienteSpedEfdController),
    ).toBeUndefined();
  });
});

describe('SPED EFD cliente — resolução de escopo pela sessão (contrato)', () => {
  it('deriva o clienteId da sessão (nunca do corpo) ao atualizar a configuração', async () => {
    const { controller, deps } = createClienteController();

    await controller.atualizarConfiguracao(
      { obrigadoEfdIcmsIpi: true } as never,
      user,
    );

    expect(deps.clientesService.getClientForUser).toHaveBeenCalledWith(
      'user-1',
    );
    const [call] = deps.configuracaoService.atualizar.mock.calls[0] as [
      { clienteId: string; actorUserId: string },
    ];
    expect(call.clienteId).toBe('cliente-1');
    expect(call.actorUserId).toBe('user-1');
  });

  it('devolve 404 quando a sessão não tem empresa — sem tocar o serviço', async () => {
    const { controller, deps } = createClienteController({
      clientesService: { getClientForUser: jest.fn().mockResolvedValue(null) },
    });

    await expect(
      controller.obterContextoApuracao({ competencia: '2026-08' }, user),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(deps.apuracaoContextoService.obter).not.toHaveBeenCalled();
  });

  it('responde a leitura no envelope { data }', async () => {
    const { controller } = createClienteController();

    const resposta = await controller.obterConfiguracao(user);

    expect(resposta).toEqual({ data: { obrigadoEfdIcmsIpi: true } });
  });
});

describe('SPED EFD admin — escopo explícito por DTO (contrato)', () => {
  function createAdminController() {
    const deps = clienteDeps();
    const controller = new AdminSpedEfdController(
      deps.configuracaoService as never,
      deps.apuracaoContextoService as never,
      deps.inventarioService as never,
      deps.efdService as never,
    );
    return { controller, deps };
  }

  it('usa o clienteId do DTO (não da sessão) e mantém o envelope { data }', async () => {
    const { controller, deps } = createAdminController();

    const resposta = await controller.obterConfiguracao('cliente-xyz');

    expect(deps.configuracaoService.obter).toHaveBeenCalledWith('cliente-xyz');
    expect(resposta).toEqual({ data: { obrigadoEfdIcmsIpi: true } });
  });
});

describe('SPED EFD — contrato de resposta de ARQUIVO (gerar)', () => {
  it('escreve o TXT em Latin-1 com os cabeçalhos normativos e o buffer gerado', async () => {
    const buffer = Buffer.from('|0000|EFD|', 'latin1');
    const file = {
      buffer,
      filename: 'efd-icms-ipi-2026-08.txt',
      hashSha256: 'f'.repeat(64),
      id: 'ger-1',
    };
    const { controller, deps } = createClienteController({
      efdService: {
        preview: jest.fn(),
        gerar: jest.fn().mockResolvedValue(file),
      },
    });
    const { res, headers } = fakeResponse();

    await controller.gerar(
      { competencia: '2026-08', finalidade: '0' } as never,
      user,
      fakeRequest,
      res,
    );

    // O escopo resolvido pela sessão chega ao serviço.
    const [gerarCall] = deps.efdService.gerar.mock.calls[0] as [
      { clienteId: string; competencia: string; actorUserId: string },
    ];
    expect(gerarCall.clienteId).toBe('cliente-1');
    expect(gerarCall.competencia).toBe('2026-08');
    expect(gerarCall.actorUserId).toBe('user-1');

    // Contrato de arquivo: Latin-1, download com filename, nosniff, ETag=hash.
    expect(headers['Content-Type']).toBe('text/plain; charset=ISO-8859-1');
    expect(headers['Content-Length']).toBe(buffer.length);
    expect(headers['Content-Disposition']).toBe(
      'attachment; filename="efd-icms-ipi-2026-08.txt"',
    );
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['X-SPED-Generation-Id']).toBe('ger-1');
    expect(headers['ETag']).toBe(`"${'f'.repeat(64)}"`);
    const [endArg] = (res.end as jest.Mock).mock.calls[0] as [Buffer];
    expect(endArg).toBe(buffer);
  });
});
