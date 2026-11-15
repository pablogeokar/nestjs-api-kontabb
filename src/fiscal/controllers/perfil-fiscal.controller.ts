import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../auth/auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AdminOnly, StaffOnly } from '../../auth/roles.decorator';
import type { CurrentUser as CurrentUserType } from '../../common/types';
import { RegistrarPerfilManualDto } from '../dto/perfil-fiscal.dto';
import { EstabelecimentoPerfilService } from '../services/estabelecimento-perfil.service';

@ApiTags('Fiscal - Perfil do estabelecimento')
@ApiBearerAuth('session-token')
@Controller('admin/fiscal/clientes/:clienteId/perfis-fiscais')
@UseGuards(AuthGuard)
@StaffOnly()
export class PerfilFiscalController {
  constructor(private readonly service: EstabelecimentoPerfilService) {}

  @Get()
  async listar(@Param('clienteId', ParseUUIDPipe) clienteId: string) {
    return { data: await this.service.listarAuditoria(clienteId) };
  }

  @Post()
  @AdminOnly()
  async registrar(
    @Param('clienteId', ParseUUIDPipe) clienteId: string,
    @Body() input: RegistrarPerfilManualDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return {
      data: await this.service.registrarManual(clienteId, input, user.id),
    };
  }

  @Delete(':perfilId')
  @AdminOnly()
  async remover(
    @Param('clienteId', ParseUUIDPipe) clienteId: string,
    @Param('perfilId', ParseUUIDPipe) perfilId: string,
  ) {
    return { data: await this.service.removerManual(clienteId, perfilId) };
  }
}
