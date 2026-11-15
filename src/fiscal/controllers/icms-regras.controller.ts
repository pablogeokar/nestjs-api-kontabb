import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../auth/auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AdminOnly, StaffOnly } from '../../auth/roles.decorator';
import type { CurrentUser as CurrentUserType } from '../../common/types';
import {
  HomologarIcmsRegrasDto,
  QueryIcmsRegrasDto,
  SalvarIcmsRegrasDto,
} from '../dto/icms-regras.dto';
import { IcmsRegrasService } from '../services/icms-regras.service';

@ApiTags('Fiscal - Regras ICMS')
@ApiBearerAuth('session-token')
@Controller('admin/fiscal/icms/regras')
@UseGuards(AuthGuard)
@StaffOnly()
export class IcmsRegrasController {
  constructor(private readonly service: IcmsRegrasService) {}

  @Get()
  async consultar(@Query() query: QueryIcmsRegrasDto) {
    return { data: await this.service.consultar(query) };
  }

  @Put()
  @AdminOnly()
  async salvar(
    @Body() input: SalvarIcmsRegrasDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return { data: await this.service.salvar(input, user.id) };
  }

  @Post('homologar')
  @AdminOnly()
  async homologar(
    @Body() input: HomologarIcmsRegrasDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return { data: await this.service.homologar(input, user.id) };
  }
}
