import {
  BadGatewayException,
  Controller,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AdminOnly } from '../auth/roles.decorator';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { CurrentUser as CurrentUserType } from '../common/types';
import { AppLogger } from '../common/logger.service';
import { RateLimitService } from '../common/rate-limit.service';
import { CrmService } from './crm.service';

@ApiTags('CRM (Admin)')
@ApiBearerAuth('session-token')
@Controller('admin/crm')
@UseGuards(AuthGuard)
@AdminOnly()
export class CrmController {
  constructor(
    private readonly crmService: CrmService,
    private readonly logger: AppLogger,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Post('clientes/:clienteId/boas-vindas')
  @ApiOperation({
    summary: 'Reenviar e-mail de boas-vindas',
    description:
      'Reenvia ao cliente as instruções de acesso e apresentação do painel Kontabb.',
  })
  @ApiParam({
    name: 'clienteId',
    type: String,
    format: 'uuid',
    description: 'ID do cliente destinatário',
  })
  @ApiResponse({ status: 201, description: 'E-mail enviado com sucesso.' })
  @ApiResponse({ status: 404, description: 'Cliente não encontrado.' })
  @ApiResponse({
    status: 422,
    description: 'Cliente sem e-mail de contato ou suspenso.',
  })
  @ApiResponse({ status: 502, description: 'Serviço de e-mail indisponível.' })
  async reenviarEmailBoasVindas(
    @Param('clienteId', new ParseUUIDPipe({ version: '4' })) clienteId: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const result = await this.crmService.enviarEmailBoasVindas({
      clienteId,
      requestId: this.logger.generateRequestId(),
      actorUserId: currentUser.id,
    });

    if (result.ok) return { success: true };

    switch (result.code) {
      case 'CLIENTE_NAO_ENCONTRADO':
        throw new NotFoundException({
          code: result.code,
          message: 'Cliente não encontrado.',
        });
      case 'SEM_EMAIL':
        throw new UnprocessableEntityException({
          code: result.code,
          message: 'Cliente sem e-mail de contato disponível para envio.',
        });
      case 'ENVIO_FALHOU':
        throw new BadGatewayException({
          code: result.code,
          message: 'Não foi possível enviar o e-mail de boas-vindas.',
        });
    }
  }

  @Post('clientes/:clienteId/obrigacoes-vencidas')
  @ApiOperation({
    summary: 'Enviar aviso de obrigações vencidas',
    description:
      'Varre as obrigações vencidas do cliente e envia e-mail orientando a informar os pagamentos pelo painel.',
  })
  @ApiParam({
    name: 'clienteId',
    type: String,
    format: 'uuid',
    description: 'ID do cliente destinatário',
  })
  @ApiResponse({ status: 201, description: 'E-mail enviado com sucesso.' })
  @ApiResponse({ status: 404, description: 'Cliente não encontrado.' })
  @ApiResponse({
    status: 422,
    description: 'Cliente sem e-mail, suspenso ou sem obrigações vencidas.',
  })
  @ApiResponse({ status: 502, description: 'Serviço de e-mail indisponível.' })
  async enviarEmailObrigacoesVencidas(
    @Param('clienteId', new ParseUUIDPipe({ version: '4' })) clienteId: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    // Um aviso por cliente por hora, evitando cliques repetidos.
    await this.rateLimit.consume({
      key: `crm:overdue-notice:${clienteId}`,
      limit: 1,
      windowMs: 60 * 60 * 1000,
    });

    const result = await this.crmService.enviarEmailObrigacoesVencidas({
      clienteId,
      requestId: this.logger.generateRequestId(),
      actorUserId: currentUser.id,
    });

    if (result.ok) return { success: true, total: result.total };

    switch (result.code) {
      case 'CLIENTE_NAO_ENCONTRADO':
        throw new NotFoundException({
          code: result.code,
          message: 'Cliente não encontrado.',
        });
      case 'SEM_EMAIL':
        throw new UnprocessableEntityException({
          code: result.code,
          message: 'Cliente sem e-mail de contato disponível para envio.',
        });
      case 'SEM_OBRIGACOES_VENCIDAS':
        throw new UnprocessableEntityException({
          code: result.code,
          message: 'Este cliente não possui obrigações vencidas.',
        });
      case 'ENVIO_FALHOU':
        throw new BadGatewayException({
          code: result.code,
          message: 'Não foi possível enviar o e-mail de obrigações vencidas.',
        });
    }
  }
}
