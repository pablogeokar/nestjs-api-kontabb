import {
  Body,
  Controller,
  ConflictException,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  InternalServerErrorException,
  NotFoundException,
  Param,
  ParseUUIDPipe,
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
import { ClientesService } from './clientes.service';
import { AuthGuard } from '../auth/auth.guard';
import { StaffOnly } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AppLogger } from '../common/logger.service';
import {
  parsePaginationParams,
  buildPaginatedResponse,
} from '../common/pagination';
import type { CurrentUser as CurrentUserType } from '../common/types';
import {
  CreateClientDto,
  UpdateClientDto,
  BatchClientDto,
} from './clientes.dto';

@ApiTags('Clientes (Admin)')
@ApiBearerAuth('session-token')
@Controller('admin/clientes')
@UseGuards(AuthGuard)
@StaffOnly()
export class ClientesController {
  constructor(
    private readonly clientesService: ClientesService,
    private readonly logger: AppLogger,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Listar clientes',
    description:
      'Retorna lista paginada de clientes cadastrados. Permite busca por razão social, CNPJ ou CPF.',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Número da página (padrão: 1)',
  })
  @ApiQuery({
    name: 'pageSize',
    required: false,
    type: Number,
    description: 'Itens por página (padrão: 20, máx: 100)',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Busca por razão social, CNPJ ou CPF',
  })
  @ApiResponse({ status: 200, description: 'Lista paginada de clientes.' })
  @ApiResponse({ status: 401, description: 'Não autorizado.' })
  @ApiResponse({ status: 403, description: 'Sem permissão (apenas staff).' })
  async list(
    @Query() query: { page?: string; pageSize?: string; search?: string },
  ) {
    const pagination = parsePaginationParams(query);
    const result = await this.clientesService.listClients({
      search: query.search?.trim() || '',
      pagination,
    });
    return buildPaginatedResponse(result.data, result.total, pagination);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Obter cliente por ID',
    description: 'Retorna os dados resumidos de um cliente específico.',
  })
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
    description: 'ID do cliente',
  })
  @ApiResponse({ status: 200, description: 'Dados do cliente.' })
  @ApiResponse({ status: 404, description: 'Cliente não encontrado.' })
  async get(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    const client = await this.clientesService.getClientSummary(id);
    if (!client) throw new NotFoundException('Cliente não encontrado.');
    return client;
  }

  @Post()
  @ApiOperation({
    summary: 'Criar cliente',
    description:
      'Cadastra um novo cliente (PF ou PJ). Cria automaticamente o usuário de autenticação com senha provisória.',
  })
  @ApiResponse({
    status: 201,
    description: 'Cliente criado com sucesso.',
    schema: {
      properties: {
        success: { type: 'boolean' },
        id: { type: 'string', format: 'uuid' },
      },
    },
  })
  @ApiResponse({ status: 409, description: 'CNPJ ou CPF já cadastrado.' })
  @ApiResponse({ status: 500, description: 'Erro interno ao criar cliente.' })
  async create(
    @Body() dto: CreateClientDto,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const requestId = this.logger.generateRequestId();
    const emails = this.normalizeEmails(dto.emails);
    const tipoPessoa = dto.tipo_pessoa;
    const cnpj = dto.cnpj?.replace(/\D/g, '') ?? '';
    const cpf = dto.cpf?.replace(/\D/g, '') ?? '';

    const result = await this.clientesService.registerClient({
      requestId,
      actorUserId: currentUser.id,
      tipoPessoa,
      companyName: dto.company_name.trim(),
      cnpj,
      cpf,
      emails,
    });

    if (!result.ok) {
      if (result.code === 'DUPLICATE') {
        const identifier = tipoPessoa === 'PF' ? 'CPF' : 'CNPJ';
        throw new ConflictException({
          code: 'DUPLICATE',
          message: `${identifier} já cadastrado.`,
        });
      }
      throw new InternalServerErrorException({
        code: result.code,
        message: 'Erro ao criar cliente.',
      });
    }

    return { success: true, id: result.clientId };
  }

  @Post('batch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Criar clientes em lote',
    description:
      'Cadastra múltiplos clientes PJ de uma vez (máx 100). Retorna resultado individual para cada item.',
  })
  @ApiResponse({ status: 200, description: 'Resultado do cadastro em lote.' })
  async batchCreate(
    @Body() dto: BatchClientDto,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const requestId = this.logger.generateRequestId();
    const results: Array<{
      cnpj: string;
      company_name: string;
      success: boolean;
      message: string;
    }> = [];

    for (const client of dto.clients) {
      const result = await this.clientesService.registerClient({
        requestId,
        actorUserId: currentUser.id,
        tipoPessoa: 'PJ',
        cnpj: client.cnpj.replace(/\D/g, ''),
        cpf: '',
        companyName: client.company_name.trim(),
        emails: [],
      });
      results.push({
        cnpj: client.cnpj,
        company_name: client.company_name,
        success: result.ok,
        message: result.ok
          ? 'Cadastrado com sucesso.'
          : result.code === 'DUPLICATE'
            ? 'CNPJ já cadastrado.'
            : 'Não foi possível cadastrar o cliente.',
      });
    }

    const allSuccess = results.every((r) => r.success);
    return {
      success: allSuccess,
      total: results.length,
      registered: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    };
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Atualizar cliente',
    description: 'Atualiza razão social e/ou e-mails de um cliente existente.',
  })
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
    description: 'ID do cliente',
  })
  @ApiResponse({ status: 200, description: 'Cliente atualizado com sucesso.' })
  @ApiResponse({ status: 404, description: 'Cliente não encontrado.' })
  async update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateClientDto,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const updated = await this.clientesService.updateClient({
      clientId: id,
      actorUserId: currentUser.id,
      companyName: dto.company_name?.trim(),
      emails: dto.emails ? this.normalizeEmails(dto.emails) : undefined,
    });
    if (!updated) throw new NotFoundException('Cliente não encontrado.');
    return { success: true };
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Excluir cliente',
    description:
      'Remove o cliente, seu usuário de autenticação e agenda limpeza dos documentos associados no storage.',
  })
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
    description: 'ID do cliente',
  })
  @ApiResponse({ status: 200, description: 'Cliente excluído com sucesso.' })
  @ApiResponse({ status: 404, description: 'Cliente não encontrado.' })
  async delete(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const requestId = this.logger.generateRequestId();
    const result = await this.clientesService.deleteClient({
      requestId,
      clientId: id,
      actorUserId: currentUser.id,
    });
    if (!result.deleted) throw new NotFoundException('Cliente não encontrado.');
    return {
      success: true,
      message: 'Cliente excluído com sucesso.',
      cleanupPending: result.cleanupPending,
    };
  }

  private normalizeEmails(
    input: string | string[] | undefined | null,
  ): string[] {
    const list = Array.isArray(input) ? input : input ? [input] : [];
    return list.map((e) => e.trim().toLowerCase()).filter(Boolean);
  }
}
