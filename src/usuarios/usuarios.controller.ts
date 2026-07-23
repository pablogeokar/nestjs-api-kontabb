import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { UsuariosService } from './usuarios.service';
import { AuthGuard } from '../auth/auth.guard';
import { AdminOnly } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AppLogger } from '../common/logger.service';
import {
  parsePaginationParams,
  buildPaginatedResponse,
} from '../common/pagination';
import type { CurrentUser as CurrentUserType } from '../common/types';

@ApiTags('Usuários')
@ApiBearerAuth('session-token')
@Controller('admin/usuarios')
@UseGuards(AuthGuard)
@AdminOnly()
export class UsuariosController {
  constructor(
    private readonly usuariosService: UsuariosService,
    private readonly logger: AppLogger,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Listar usuários do sistema',
    description:
      'Retorna lista paginada de usuários (ADMIN e COLABORADOR). Permite filtros por role e busca por nome/e-mail.',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Número da página',
  })
  @ApiQuery({
    name: 'pageSize',
    required: false,
    type: Number,
    description: 'Itens por página',
  })
  @ApiQuery({
    name: 'role',
    required: false,
    type: String,
    description: 'Filtrar por role (ADMIN, COLABORADOR)',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Busca por nome ou e-mail',
  })
  @ApiResponse({ status: 200, description: 'Lista paginada de usuários.' })
  @ApiResponse({ status: 401, description: 'Não autorizado.' })
  @ApiResponse({ status: 403, description: 'Sem permissão (apenas admin).' })
  async list(
    @Query()
    query: {
      page?: string;
      pageSize?: string;
      role?: string;
      search?: string;
    },
  ) {
    const pagination = parsePaginationParams(query);
    const result = await this.usuariosService.listSystemUsers({
      role: query.role || '',
      search: query.search?.trim() || '',
      pagination,
    });
    return buildPaginatedResponse(result.data, result.total, pagination);
  }

  @Post()
  @ApiOperation({
    summary: 'Criar usuário do sistema',
    description:
      'Cria um novo usuário (ADMIN ou COLABORADOR) com e-mail e senha.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['name', 'email', 'password'],
      properties: {
        name: { type: 'string', description: 'Nome completo' },
        email: {
          type: 'string',
          format: 'email',
          description: 'E-mail do usuário',
        },
        password: { type: 'string', description: 'Senha' },
        role: {
          type: 'string',
          enum: ['ADMIN', 'COLABORADOR'],
          default: 'COLABORADOR',
          description: 'Role do usuário',
        },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Usuário criado com sucesso.' })
  @ApiResponse({
    status: 400,
    description: 'E-mail já cadastrado ou dados inválidos.',
  })
  async create(
    @Body()
    body: { name: string; email: string; password: string; role?: string },
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const requestId = this.logger.generateRequestId();
    const { name, email, password, role = 'COLABORADOR' } = body;

    if (await this.usuariosService.existsByEmail(email.trim().toLowerCase())) {
      throw new BadRequestException('Email já cadastrado.');
    }

    const result = await this.usuariosService.createSystemUser({
      requestId,
      actorUserId: currentUser.id,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      password,
      role,
    });

    if (!result.ok) {
      if (result.code === 'DUPLICATE')
        throw new BadRequestException('Email já cadastrado.');
      throw new BadRequestException('Erro ao criar usuário.');
    }

    return { success: true, user: { id: result.userId, name, email, role } };
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Atualizar usuário',
    description:
      'Atualiza nome e/ou role de um usuário. Não é possível alterar o próprio perfil por esta rota.',
  })
  @ApiParam({ name: 'id', type: String, description: 'ID do usuário' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        role: { type: 'string', enum: ['ADMIN', 'COLABORADOR'] },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Usuário atualizado.' })
  @ApiResponse({
    status: 400,
    description: 'Tentativa de alterar o próprio perfil.',
  })
  @ApiResponse({ status: 404, description: 'Usuário não encontrado.' })
  async update(
    @Param('id') id: string,
    @Body() body: { name?: string; role?: string },
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    if (id === currentUser.id) {
      throw new BadRequestException(
        'Você não pode alterar seu próprio perfil por aqui.',
      );
    }
    const updated = await this.usuariosService.updateSystemUser({
      userId: id,
      actorUserId: currentUser.id,
      name: body.name?.trim(),
      role: body.role,
    });
    if (!updated) throw new NotFoundException('Usuário não encontrado.');
    return { success: true };
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Excluir usuário',
    description:
      'Remove um usuário do sistema. Não é possível excluir a própria conta.',
  })
  @ApiParam({ name: 'id', type: String, description: 'ID do usuário' })
  @ApiResponse({ status: 200, description: 'Usuário excluído.' })
  @ApiResponse({
    status: 400,
    description: 'Tentativa de excluir a própria conta.',
  })
  @ApiResponse({ status: 404, description: 'Usuário não encontrado.' })
  async delete(
    @Param('id') id: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    if (id === currentUser.id) {
      throw new BadRequestException('Você não pode excluir sua própria conta.');
    }
    const deleted = await this.usuariosService.deleteSystemUser({
      userId: id,
      actorUserId: currentUser.id,
    });
    if (!deleted) throw new NotFoundException('Usuário não encontrado.');
    return { success: true, message: 'Usuário excluído com sucesso.' };
  }

  @Patch(':id/password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Alterar senha do usuário',
    description: 'Redefine a senha de um usuário do sistema.',
  })
  @ApiParam({ name: 'id', type: String, description: 'ID do usuário' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['password'],
      properties: { password: { type: 'string', description: 'Nova senha' } },
    },
  })
  @ApiResponse({ status: 200, description: 'Senha atualizada com sucesso.' })
  @ApiResponse({ status: 404, description: 'Usuário não encontrado.' })
  async changePassword(
    @Param('id') id: string,
    @Body() body: { password: string },
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const updated = await this.usuariosService.changePassword({
      userId: id,
      actorUserId: currentUser.id,
      password: body.password,
    });
    if (!updated) throw new NotFoundException('Usuário não encontrado.');
    return { success: true, message: 'Senha atualizada com sucesso.' };
  }
}
