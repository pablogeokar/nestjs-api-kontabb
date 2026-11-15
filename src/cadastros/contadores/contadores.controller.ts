import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '../../auth/auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AdminOnly, StaffOnly } from '../../auth/roles.decorator';
import {
  buildPaginatedResponse,
  parsePaginationParams,
} from '../../common/pagination';
import type { CurrentUser as CurrentUserType } from '../../common/types';
import { AtualizarContadorDto, CriarContadorDto } from './contadores.dto';
import { ContadoresService } from './contadores.service';
import { ContadorCertificadoService } from './contador-certificado.service';

@ApiTags('Cadastros - Contadores')
@ApiBearerAuth('session-token')
@Controller('admin/cadastros/contadores')
@UseGuards(AuthGuard)
@StaffOnly()
export class ContadoresController {
  constructor(
    private readonly service: ContadoresService,
    private readonly certificados: ContadorCertificadoService,
  ) {}

  @Get(':id/certificado')
  @AdminOnly()
  certificadoStatus(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.certificados.status(id);
  }

  @Post(':id/certificado')
  @AdminOnly()
  @UseInterceptors(
    FileInterceptor('arquivo', { limits: { fileSize: 2 * 1024 * 1024 } }),
  )
  uploadCertificado(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @UploadedFile() arquivo: Express.Multer.File,
    @Body() body: { senha: string },
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.certificados.upload({
      contadorId: id,
      arquivo,
      senha: body?.senha ?? '',
      actorId: user.id,
    });
  }

  @Delete(':id/certificado')
  @AdminOnly()
  @HttpCode(HttpStatus.NO_CONTENT)
  removerCertificado(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.certificados.remove(id, user.id);
  }

  @Get()
  async listar(
    @Query() query: { page?: string; pageSize?: string; search?: string },
  ) {
    const pagination = parsePaginationParams(query);
    const result = await this.service.listar({
      search: query.search?.trim() ?? '',
      pagination,
    });
    return buildPaginatedResponse(result.data, result.total, pagination);
  }

  @Get(':id')
  obter(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.service.obter(id);
  }

  @Post()
  criar(@Body() dto: CriarContadorDto, @CurrentUser() user: CurrentUserType) {
    return this.service.criar(dto, user.id);
  }

  @Patch(':id')
  atualizar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: AtualizarContadorDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.service.atualizar(id, dto, user.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  excluir(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.service.excluir(id);
  }
}
