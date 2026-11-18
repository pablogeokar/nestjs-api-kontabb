import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../auth/auth.guard';
import { StaffOnly } from '../../auth/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { CurrentUser as CurrentUserType } from '../../common/types';
import { SalvarSimplesBeneficioDto } from '../dto/simples-beneficio.dto';
import { SimplesBeneficiosService } from '../services/simples-beneficios.service';

@ApiTags('Fiscal - Benefícios do Simples')
@ApiBearerAuth('session-token')
@Controller('admin/fiscal/simples/beneficios')
@UseGuards(AuthGuard)
@StaffOnly()
export class SimplesBeneficiosController {
  constructor(private readonly service: SimplesBeneficiosService) {}
  @Get() async listar() {
    return { data: await this.service.listar() };
  }
  @Post() async salvar(
    @Body() input: SalvarSimplesBeneficioDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return { data: await this.service.salvar(input, user.id) };
  }
}
