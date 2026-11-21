import {
  Body,
  Controller,
  Delete,
  Get,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../auth/auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AdminOnly, StaffOnly } from '../../auth/roles.decorator';
import type { CurrentUser as CurrentUserType } from '../../common/types';
import { QueryIcmsRegrasDto } from '../dto/icms-regras.dto';
import {
  AprovarFonteStDto,
  RemoverStEstadualDto,
  SalvarDifalEstadualDto,
  SalvarStEstadualDto,
} from '../dto/regras-estaduais.dto';
import { RegrasEstaduaisService } from '../services/regras-estaduais.service';

/** Regras de DIFAL e de ST por estado, compartilhadas por todos os clientes. */
@ApiTags('Fiscal - Regras estaduais')
@ApiBearerAuth('session-token')
@Controller('admin/fiscal/regras-estaduais')
@UseGuards(AuthGuard)
@StaffOnly()
export class RegrasEstaduaisController {
  constructor(private readonly service: RegrasEstaduaisService) {}
  @Get('difal')
  async consultarDifal(@Query() query: QueryIcmsRegrasDto) {
    return { data: await this.service.consultarDifal(query) };
  }
  @Put('difal')
  @AdminOnly()
  async salvarDifal(
    @Body() input: SalvarDifalEstadualDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return { data: await this.service.salvarDifal(input, user.id) };
  }
  @Get('st')
  async consultarSt(@Query() query: QueryIcmsRegrasDto) {
    return { data: await this.service.consultarSt(query) };
  }
  @Put('st')
  @AdminOnly()
  async salvarSt(
    @Body() input: SalvarStEstadualDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return { data: await this.service.salvarSt(input, user.id) };
  }
  @Put('st/fonte')
  @AdminOnly()
  async aprovarFonteSt(
    @Body() input: AprovarFonteStDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return { data: await this.service.aprovarFonteSt(input, user.id) };
  }
  @Delete('st')
  @AdminOnly()
  async removerSt(@Body() input: RemoverStEstadualDto) {
    return { data: await this.service.removerSt(input) };
  }
}
