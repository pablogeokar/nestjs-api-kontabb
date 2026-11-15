import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  InternalServerErrorException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ClienteService } from './cliente.service';
import { ClientesService } from '../clientes/clientes.service';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { CurrentUser as CurrentUserType } from '../common/types';
import { RateLimitService } from '../common/rate-limit.service';
import {
  hasValidFileSignature,
  extensionForMime,
  type AllowedUploadType,
} from '../common/file-validation';

@ApiTags('Cliente')
@ApiBearerAuth('session-token')
@Controller('cliente')
@UseGuards(AuthGuard)
export class ClienteController {
  constructor(
    private readonly clienteService: ClienteService,
    private readonly clientesService: ClientesService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Get('logo')
  @ApiOperation({
    summary: 'Obter logo do cliente',
    description:
      "Retorna a URL assinada da logo do cliente autenticado. Utilizada como marca d'água nos recibos e nas telas do sistema.",
  })
  @ApiResponse({
    status: 200,
    description: 'URL da logo (pode ser null se não cadastrada).',
    schema: {
      properties: {
        logo_url: { type: 'string', nullable: true },
      },
    },
  })
  @ApiResponse({ status: 403, description: 'Sem permissão — apenas clientes.' })
  async getLogo(@CurrentUser() currentUser: CurrentUserType) {
    if (currentUser.role !== 'CLIENTE') {
      throw new ForbiddenException('Sem permissão.');
    }
    const client = await this.clientesService.getClientForUser(currentUser.id);
    if (!client) {
      throw new BadRequestException('Cliente não encontrado.');
    }
    const logoUrl = await this.clientesService.getLogoUrl(client.id);
    return { logo_url: logoUrl };
  }

  @Get('perfil')
  @ApiOperation({
    summary: 'Perfil da empresa (somente leitura)',
    description:
      'Retorna os dados cadastrais da empresa do cliente autenticado para consulta.',
  })
  @ApiResponse({ status: 200, description: 'Dados cadastrais da empresa.' })
  @ApiResponse({ status: 403, description: 'Sem permissão — apenas clientes.' })
  @ApiResponse({ status: 404, description: 'Cliente não encontrado.' })
  async getPerfil(@CurrentUser() currentUser: CurrentUserType) {
    if (currentUser.role !== 'CLIENTE') {
      throw new ForbiddenException('Sem permissão.');
    }
    const client = await this.clientesService.getClientForUser(currentUser.id);
    if (!client) throw new NotFoundException('Cliente não encontrado.');
    return this.clientesService.getClientSummary(client.id);
  }

  @Post('logo')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }),
  )
  @ApiOperation({
    summary: 'Enviar logo da empresa',
    description:
      'Permite que o cliente autenticado envie ou substitua a logo da própria empresa (JPEG, PNG ou WebP, máx 2MB). Nenhum dado cadastral é alterado.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiResponse({ status: 200, description: 'Logo enviada com sucesso.' })
  @ApiResponse({ status: 400, description: 'Arquivo inválido.' })
  @ApiResponse({ status: 403, description: 'Sem permissão — apenas clientes.' })
  async uploadLogo(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    if (currentUser.role !== 'CLIENTE') {
      throw new ForbiddenException('Sem permissão.');
    }
    if (!file) {
      throw new BadRequestException('Nenhum arquivo enviado.');
    }
    await this.rateLimit.consume({
      key: `cliente-logo:${currentUser.id}`,
      limit: 10,
      windowMs: 60_000,
    });
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
    if (!hasValidFileSignature(new Uint8Array(file.buffer), file.mimetype)) {
      throw new BadRequestException(
        'Conteúdo do arquivo não corresponde ao formato declarado.',
      );
    }
    const client = await this.clientesService.getClientForUser(currentUser.id);
    if (!client) {
      throw new BadRequestException('Cliente não encontrado.');
    }
    const result = await this.clientesService.uploadLogo({
      clientId: client.id,
      actorUserId: currentUser.id,
      bytes: Buffer.from(file.buffer),
      mimeType: file.mimetype,
      extension: extensionForMime(file.mimetype as AllowedUploadType),
    });
    if (!result.ok) {
      if (result.code === 'NOT_FOUND') {
        throw new NotFoundException('Cliente não encontrado.');
      }
      throw new InternalServerErrorException('Falha ao enviar logo.');
    }
    return { success: true, logo_url: result.logoUrl };
  }

  @Patch('first-login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Concluir primeiro acesso',
    description:
      'Permite que o cliente altere a senha provisória no primeiro login. Requer role CLIENTE.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['currentPassword', 'newPassword'],
      properties: {
        currentPassword: {
          type: 'string',
          description: 'Senha atual (provisória)',
        },
        newPassword: { type: 'string', description: 'Nova senha desejada' },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Senha alterada com sucesso.',
    schema: {
      properties: {
        success: { type: 'boolean' },
        primeiroLogin: {
          type: 'boolean',
          description: 'Sempre false após sucesso',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Erro de validação ou senha inválida.',
  })
  @ApiResponse({ status: 401, description: 'Não autorizado.' })
  @ApiResponse({ status: 403, description: 'Sem permissão — apenas clientes.' })
  @ApiResponse({
    status: 429,
    description: 'Rate limit excedido (5 tentativas/minuto).',
  })
  async completeFirstLogin(
    @Body() body: { currentPassword: string; newPassword: string },
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    if (currentUser.role !== 'CLIENTE') {
      throw new ForbiddenException('Sem permissão.');
    }

    await this.rateLimit.consume({
      key: `first-login:${currentUser.id}`,
      limit: 5,
      windowMs: 60_000,
    });

    if (body.currentPassword === body.newPassword) {
      throw new BadRequestException(
        'A nova senha deve ser diferente da senha atual.',
      );
    }

    const result = await this.clienteService.completeFirstLogin({
      userId: currentUser.id,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
    });

    if (!result.ok) {
      if (result.code === 'CLIENT_NOT_FOUND') {
        throw new BadRequestException('Cliente não encontrado.');
      }
      if (result.code === 'ALREADY_COMPLETED') {
        throw new BadRequestException('O primeiro acesso já foi concluído.');
      }
      throw new BadRequestException(
        'Não foi possível alterar a senha. Confira a senha atual.',
      );
    }

    return { success: true, primeiroLogin: false };
  }
}

@ApiTags('Cliente')
@ApiBearerAuth('session-token')
@Controller('clientes')
@UseGuards(AuthGuard)
export class ClientesMeController {
  constructor(private readonly clientesService: ClientesService) {}

  @Get('me')
  @ApiOperation({
    summary: 'Obter o cadastro do cliente autenticado',
    description:
      'Retorna os dados cadastrais e a configuração tributária da empresa vinculada à sessão.',
  })
  @ApiResponse({ status: 200, description: 'Dados do cliente autenticado.' })
  @ApiResponse({ status: 403, description: 'Sem permissão — apenas clientes.' })
  @ApiResponse({ status: 404, description: 'Cliente não encontrado.' })
  async me(@CurrentUser() currentUser: CurrentUserType) {
    if (currentUser.role !== 'CLIENTE') {
      throw new ForbiddenException('Sem permissão.');
    }
    const client = await this.clientesService.getClientForUser(currentUser.id);
    if (!client) throw new NotFoundException('Cliente não encontrado.');
    return this.clientesService.getClientSummary(client.id);
  }
}
