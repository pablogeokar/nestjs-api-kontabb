import {
  BadRequestException,
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
  ServiceUnavailableException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
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
  LookupCnpjParamsDto,
  type ClientAddressDto,
  type ClientCnaeDto,
} from './clientes.dto';
import {
  CnpjLookupFailure,
  CnpjLookupService,
  isValidCnpj,
} from './cnpj-lookup.service';
import { RateLimitService } from '../common/rate-limit.service';
import {
  hasValidFileSignature,
  extensionForMime,
  type AllowedUploadType,
} from '../common/file-validation';

@ApiTags('Clientes (Admin)')
@ApiBearerAuth('session-token')
@Controller('admin/clientes')
@UseGuards(AuthGuard)
@StaffOnly()
export class ClientesController {
  constructor(
    private readonly clientesService: ClientesService,
    private readonly cnpjLookupService: CnpjLookupService,
    private readonly rateLimit: RateLimitService,
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

  @Get('consulta-cnpj/:cnpj')
  @ApiOperation({
    summary: 'Consultar dados de um CNPJ',
    description:
      'Consulta a OpenCNPJ e usa a ReceitaWS como fallback, retornando endereço e CNAEs em um contrato único.',
  })
  @ApiParam({ name: 'cnpj', description: 'CNPJ com 14 dígitos' })
  @ApiResponse({ status: 200, description: 'Dados cadastrais normalizados.' })
  @ApiResponse({ status: 404, description: 'CNPJ não encontrado.' })
  @ApiResponse({
    status: 503,
    description: 'Provedores temporariamente indisponíveis.',
  })
  async lookupCnpj(
    @Param() params: LookupCnpjParamsDto,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    if (!isValidCnpj(params.cnpj)) {
      throw new BadRequestException({
        code: 'INVALID_CNPJ',
        message: 'CNPJ inválido.',
      });
    }

    await this.rateLimit.consume({
      key: `cnpj-lookup:${currentUser.id}`,
      limit: currentUser.role === 'ADMIN' ? 20 : 10,
      windowMs: 60_000,
    });

    const requestId = this.logger.generateRequestId();
    try {
      return await this.cnpjLookupService.lookup(params.cnpj, {
        requestId,
        userId: currentUser.id,
      });
    } catch (error) {
      if (error instanceof CnpjLookupFailure && error.code === 'NOT_FOUND') {
        throw new NotFoundException({
          code: 'CNPJ_NOT_FOUND',
          message: 'CNPJ não encontrado nas bases consultadas.',
        });
      }
      throw new ServiceUnavailableException({
        code: 'CNPJ_LOOKUP_UNAVAILABLE',
        message:
          'Não foi possível consultar o CNPJ agora. Preencha os dados manualmente ou tente novamente.',
      });
    }
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
    const cnpj = dto.cnpj?.replace(/[^0-9A-Za-z]/g, '').toUpperCase() ?? '';
    const cpf = dto.cpf?.replace(/\D/g, '') ?? '';

    if (tipoPessoa === 'PJ' && !isValidCnpj(cnpj)) {
      throw new BadRequestException({
        code: 'INVALID_CNPJ',
        message: 'CNPJ inválido.',
      });
    }

    const result = await this.clientesService.registerClient({
      requestId,
      actorUserId: currentUser.id,
      tipoPessoa,
      companyName: dto.company_name.trim(),
      cnpj,
      cpf,
      emails,
      address: dto.address ? this.mapAddress(dto.address) : undefined,
      primaryActivity: dto.primary_activity
        ? this.mapCnae(dto.primary_activity)
        : dto.primary_activity,
      secondaryActivities: this.mapSecondaryCnaes(
        dto.secondary_activities,
        dto.primary_activity?.code,
      ),
      optanteSimplesNacional: dto.optante_simples_nacional,
      simplesNacionalFonte: dto.simples_nacional_fonte,
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
      if (!isValidCnpj(client.cnpj)) {
        results.push({
          cnpj: client.cnpj,
          company_name: client.company_name,
          success: false,
          message: 'CNPJ inválido.',
        });
        continue;
      }
      const result = await this.clientesService.registerClient({
        requestId,
        actorUserId: currentUser.id,
        tipoPessoa: 'PJ',
        cnpj: client.cnpj.replace(/[^0-9A-Za-z]/g, '').toUpperCase(),
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
    description:
      'Atualiza dados cadastrais e a configuração tributária de um cliente existente.',
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
      address: dto.address ? this.mapAddress(dto.address) : undefined,
      primaryActivity: dto.primary_activity
        ? this.mapCnae(dto.primary_activity)
        : dto.primary_activity,
      secondaryActivities: this.mapSecondaryCnaes(
        dto.secondary_activities,
        dto.primary_activity?.code,
      ),
      regimeTributario: dto.regime_tributario,
      apuraIcms: dto.apura_icms,
      inscricaoEstadual: dto.inscricao_estadual,
      tipoContribuinteIcms: dto.tipo_contribuinte_icms,
      optanteSimplesNacional: dto.optante_simples_nacional,
      simplesNacionalFonte: dto.simples_nacional_fonte,
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

  @Post(':id/logo')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }),
  )
  @ApiOperation({
    summary: 'Upload de logo do cliente',
    description:
      "Faz upload da logo do cliente (JPEG, PNG ou WebP, máx 2MB). A logo será utilizada como marca d'água nos recibos de salário.",
  })
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
    description: 'ID do cliente',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Imagem da logo (JPEG, PNG ou WebP, máx 2MB)',
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Logo enviada com sucesso.' })
  @ApiResponse({ status: 400, description: 'Arquivo inválido.' })
  @ApiResponse({ status: 404, description: 'Cliente não encontrado.' })
  async uploadLogo(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    if (!file) {
      throw new BadRequestException('Nenhum arquivo enviado.');
    }

    const allowedImageTypes: AllowedUploadType[] = [
      'image/jpeg',
      'image/png',
      'image/webp',
    ];
    if (!allowedImageTypes.includes(file.mimetype as AllowedUploadType)) {
      throw new BadRequestException(
        'Formato não suportado. Envie JPEG, PNG ou WebP.',
      );
    }

    const bytes = new Uint8Array(file.buffer);
    if (!hasValidFileSignature(bytes, file.mimetype)) {
      throw new BadRequestException(
        'Conteúdo do arquivo não corresponde ao formato declarado.',
      );
    }

    const extension = extensionForMime(file.mimetype as AllowedUploadType);
    const result = await this.clientesService.uploadLogo({
      clientId: id,
      actorUserId: currentUser.id,
      bytes: Buffer.from(file.buffer),
      mimeType: file.mimetype,
      extension,
    });

    if (!result.ok) {
      if (result.code === 'NOT_FOUND') {
        throw new NotFoundException('Cliente não encontrado.');
      }
      throw new InternalServerErrorException('Falha ao enviar logo.');
    }

    return { success: true, logo_url: result.logoUrl };
  }

  @Delete(':id/logo')
  @ApiOperation({
    summary: 'Remover logo do cliente',
    description: 'Remove a logo do cliente do storage.',
  })
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
    description: 'ID do cliente',
  })
  @ApiResponse({ status: 200, description: 'Logo removida com sucesso.' })
  @ApiResponse({ status: 404, description: 'Cliente não encontrado.' })
  async deleteLogo(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const result = await this.clientesService.deleteLogo({
      clientId: id,
      actorUserId: currentUser.id,
    });

    if (!result.ok) {
      if (result.code === 'NOT_FOUND') {
        throw new NotFoundException('Cliente não encontrado.');
      }
      throw new InternalServerErrorException('Falha ao remover logo.');
    }

    return { success: true };
  }

  private normalizeEmails(
    input: string | string[] | undefined | null,
  ): string[] {
    const list = Array.isArray(input) ? input : input ? [input] : [];
    return list.map((e) => e.trim().toLowerCase()).filter(Boolean);
  }

  private mapAddress(address: ClientAddressDto) {
    return {
      postalCode: address.postal_code.trim(),
      street: address.street.trim(),
      number: address.number.trim(),
      complement: address.complement.trim(),
      district: address.district.trim(),
      city: address.city.trim(),
      state: address.state.trim().toUpperCase(),
    };
  }

  private mapCnae(cnae: ClientCnaeDto) {
    return {
      code: cnae.code.replace(/\D/g, ''),
      description: cnae.description.trim(),
    };
  }

  private mapSecondaryCnaes(
    cnaes: ClientCnaeDto[] | undefined,
    primaryCode: string | undefined,
  ) {
    if (!cnaes) return undefined;
    const normalizedPrimary = primaryCode?.replace(/\D/g, '');
    const unique = new Map<string, { code: string; description: string }>();
    for (const cnae of cnaes) {
      const normalized = this.mapCnae(cnae);
      if (
        normalized.code !== normalizedPrimary &&
        !unique.has(normalized.code)
      ) {
        unique.set(normalized.code, normalized);
      }
    }
    return [...unique.values()];
  }
}
