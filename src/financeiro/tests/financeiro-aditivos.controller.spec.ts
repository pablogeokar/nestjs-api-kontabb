import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FinanceiroAdminController } from '../controllers/financeiro-admin.controller';
import { FinanceiroContratosService } from '../services/financeiro-contratos.service';
import { FinanceiroFaturasService } from '../services/financeiro-faturas.service';
import { FinanceiroTiposService } from '../services/financeiro-tipos.service';
import { FinanceiroLancamentosService } from '../services/financeiro-lancamentos.service';
import { FinanceiroBaixasService } from '../services/financeiro-baixas.service';
import { FinanceiroDashboardService } from '../services/financeiro-dashboard.service';
import { FinanceiroDocumentosService } from '../services/financeiro-documentos.service';
import { FinanceiroContratoDocumentoService } from '../services/financeiro-contrato-documento.service';
import { FinanceiroContratoPreferenciasService } from '../services/financeiro-contrato-preferencias.service';
import { FinanceiroAditivoDocumentoService } from '../services/financeiro-aditivo-documento.service';
import { AuthGuard } from '../../auth/auth.guard';
import { AuthService } from '../../auth/auth.service';
import { SessionTokenService } from '../../auth/session-token.service';
import { AppLogger } from '../../common/logger.service';
import type { Request } from 'express';

describe('rotas de reajustes e aditivos (HTTP e autorização)', () => {
  let app: INestApplication;
  let base: string;
  const contratos = {
    listarAditivos: jest.fn().mockResolvedValue([]),
    previaReajuste: jest.fn().mockResolvedValue({ valorNovo: '990.00' }),
    reajustar: jest.fn().mockResolvedValue({ versao: 2 }),
  };
  const clienteId = 'c0512240-4322-4bca-8e14-e3326f6d33c7';
  const payload = {
    percentual: 10,
    competenciaInicio: '12/2026',
    motivo: 'Reajuste anual revisado',
    versaoEsperada: 1,
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [FinanceiroAdminController],
      providers: [
        AuthGuard,
        {
          provide: AuthService,
          useValue: {
            validateSession: (token: string) =>
              Promise.resolve(
                ['ADMIN', 'COLABORADOR', 'CLIENTE'].includes(token)
                  ? { id: 'actor-test', role: token }
                  : null,
              ),
          },
        },
        {
          provide: SessionTokenService,
          useValue: {
            extract: (request: Request) =>
              request.headers.authorization?.replace(/^Bearer /, ''),
          },
        },
        {
          provide: AppLogger,
          useValue: {
            info: jest.fn(),
            generateRequestId: () => 'test-request',
          },
        },
        { provide: FinanceiroContratosService, useValue: contratos },
        ...[
          FinanceiroFaturasService,
          FinanceiroTiposService,
          FinanceiroLancamentosService,
          FinanceiroBaixasService,
          FinanceiroDashboardService,
          FinanceiroDocumentosService,
          FinanceiroContratoDocumentoService,
          FinanceiroContratoPreferenciasService,
          FinanceiroAditivoDocumentoService,
        ].map((provide) => ({ provide, useValue: {} })),
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    base = `${await app.getUrl()}/api/admin/financeiro/contratos/cliente/${clienteId}`;
  });
  afterAll(async () => app.close());
  beforeEach(() => jest.clearAllMocks());
  it.each([undefined, 'CLIENTE'])(
    'recusa usuário sem acesso à equipe (%s)',
    async (token) => {
      const response = await fetch(`${base}/reajustes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      });
      expect(response.status).toBe(token ? 403 : 401);
      expect(contratos.reajustar).not.toHaveBeenCalled();
    },
  );
  it.each(['ADMIN', 'COLABORADOR'])(
    'permite revisão e confirmação pela equipe (%s) e registra o ator autenticado',
    async (token) => {
      const options = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      };
      expect((await fetch(`${base}/reajustes/previa`, options)).status).toBe(
        201,
      );
      expect(contratos.reajustar).not.toHaveBeenCalled();
      expect((await fetch(`${base}/reajustes`, options)).status).toBe(201);
      expect(contratos.reajustar).toHaveBeenCalledWith(
        clienteId,
        expect.objectContaining(payload),
        'actor-test',
      );
    },
  );
  it('rejeita payload com campo desconhecido ou sem versão antes de chamar o serviço', async () => {
    for (const body of [
      { ...payload, criadoPor: 'outro-usuario' },
      { ...payload, versaoEsperada: undefined },
      { ...payload, percentual: -10 },
    ]) {
      const response = await fetch(`${base}/reajustes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ADMIN',
        },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
    }
    expect(contratos.reajustar).not.toHaveBeenCalled();
  });
});
