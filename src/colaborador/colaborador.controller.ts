import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ColaboradorService } from './colaborador.service';
import {
  ColaboradorSessionService,
  type ColaboradorTokenPayload,
} from './colaborador-session.service';
import { ClientesService } from '../clientes/clientes.service';
import { RateLimitService } from '../common/rate-limit.service';
import { AppLogger } from '../common/logger.service';
import { parsePaginationParams } from '../common/pagination';

@ApiTags('Colaborador')
@Controller('colaborador')
export class ColaboradorController {
  constructor(
    private readonly colaboradorService: ColaboradorService,
    private readonly sessionService: ColaboradorSessionService,
    private readonly clientesService: ClientesService,
    private readonly rateLimit: RateLimitService,
    private readonly logger: AppLogger,
  ) {}

  // ─── Auth endpoints ───

  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login do colaborador (CNPJ + código + senha)' })
  async login(
    @Body() body: { cnpj: string; codigoFuncionario: string; senha: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const cnpj = body.cnpj?.replace(/\D/g, '').trim();
    const codigoFuncionario = body.codigoFuncionario?.trim();
    const senha = body.senha;

    if (!cnpj || !codigoFuncionario || !senha) {
      throw new BadRequestException(
        'CNPJ, código do funcionário e senha são obrigatórios.',
      );
    }

    if (cnpj.length !== 14) {
      throw new BadRequestException('CNPJ inválido.');
    }

    await this.rateLimit.consume({
      key: `colaborador-login:${cnpj}:${codigoFuncionario}`,
      limit: 5,
      windowMs: 60_000,
    });

    const session = await this.colaboradorService.authenticate({
      cnpj,
      codigoFuncionario,
      senha,
    });

    if (!session) {
      throw new UnauthorizedException(
        'Credenciais inválidas. Verifique CNPJ, código e senha.',
      );
    }

    const token = this.sessionService.createToken({
      funcionarioId: session.funcionarioId,
      clienteId: session.clienteId,
      codigoFuncionario: session.codigoFuncionario,
      nomeCompleto: session.nomeCompleto,
      cargo: session.cargo,
      cnpj: session.cnpj,
      razaoSocial: session.razaoSocial,
      primeiroAcesso: session.primeiroAcesso,
    });

    this.sessionService.setCookie(res, token);

    this.logger.info('colaborador_login', {
      funcionarioId: session.funcionarioId,
      cnpj,
      codigoFuncionario,
    });

    return {
      user: {
        funcionarioId: session.funcionarioId,
        nomeCompleto: session.nomeCompleto,
        cargo: session.cargo,
        cnpj: session.cnpj,
        razaoSocial: session.razaoSocial,
        primeiroAcesso: session.primeiroAcesso,
      },
    };
  }

  @Post('auth/logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout do colaborador' })
  async logout(@Res({ passthrough: true }) res: Response) {
    this.sessionService.clearCookie(res);
    return { success: true };
  }

  @Get('auth/session')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Obter sessão do colaborador' })
  async getSession(@Req() req: Request) {
    const payload = this.sessionService.extractFromRequest(req);
    if (!payload) {
      return { user: null };
    }

    return {
      user: {
        funcionarioId: payload.funcionarioId,
        nomeCompleto: payload.nomeCompleto,
        cargo: payload.cargo,
        cnpj: payload.cnpj,
        razaoSocial: payload.razaoSocial,
        primeiroAcesso: payload.primeiroAcesso,
      },
    };
  }

  @Get('logo')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Obter logo da empresa do colaborador' })
  async getLogo(@Req() req: Request) {
    const payload = this.sessionService.extractFromRequest(req);
    if (!payload) {
      throw new UnauthorizedException('Não autorizado.');
    }

    const logoUrl = await this.clientesService.getLogoUrl(payload.clienteId);
    return { logo_url: logoUrl };
  }

  @Post('auth/trocar-senha')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Trocar senha do colaborador (primeiro acesso ou alteração)',
  })
  async trocarSenha(
    @Body() body: { senhaAtual: string; novaSenha: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const payload = this.requireAuth(req);

    if (!body.senhaAtual || !body.novaSenha) {
      throw new BadRequestException(
        'Senha atual e nova senha são obrigatórias.',
      );
    }

    if (body.novaSenha.length < 6) {
      throw new BadRequestException(
        'A nova senha deve ter pelo menos 6 caracteres.',
      );
    }

    await this.rateLimit.consume({
      key: `colaborador-change-pwd:${payload.funcionarioId}`,
      limit: 5,
      windowMs: 60_000,
    });

    const result = await this.colaboradorService.changePassword({
      funcionarioId: payload.funcionarioId,
      senhaAtual: body.senhaAtual,
      novaSenha: body.novaSenha,
    });

    if (!result.ok) {
      if (result.code === 'WRONG_PASSWORD') {
        throw new BadRequestException('Senha atual incorreta.');
      }
      if (result.code === 'SAME_PASSWORD') {
        throw new BadRequestException(
          'A nova senha deve ser diferente da senha atual.',
        );
      }
      throw new BadRequestException('Não foi possível alterar a senha.');
    }

    // Issue a new token with primeiroAcesso = false
    const newToken = this.sessionService.createToken({
      ...payload,
      primeiroAcesso: false,
    });
    this.sessionService.setCookie(res, newToken);

    return { success: true, message: 'Senha alterada com sucesso.' };
  }

  // ─── Portal endpoints ───

  @Get('perfil')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Perfil do colaborador' })
  async getPerfil(@Req() req: Request) {
    const payload = this.requireAuth(req);
    this.requirePasswordChanged(payload);

    const perfil = await this.colaboradorService.getPerfil(
      payload.funcionarioId,
    );
    if (!perfil) throw new NotFoundException('Funcionário não encontrado.');

    return perfil;
  }

  @Get('recibos')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar recibos de pagamento do colaborador' })
  async listRecibos(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const payload = this.requireAuth(req);
    this.requirePasswordChanged(payload);

    const pagination = parsePaginationParams({ page, pageSize });

    const result = await this.colaboradorService.listRecibos(
      payload.funcionarioId,
      pagination,
    );

    return {
      data: result.data,
      pagination: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        total: result.total,
        totalPages: Math.ceil(result.total / pagination.pageSize),
        hasNext: pagination.offset + pagination.limit < result.total,
        hasPrev: pagination.page > 1,
      },
    };
  }

  @Get('recibos/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Detalhes de um recibo de pagamento' })
  async getRecibo(@Req() req: Request, @Param('id') id: string) {
    const payload = this.requireAuth(req);
    this.requirePasswordChanged(payload);

    const recibo = await this.colaboradorService.getReciboDetalhe(
      payload.funcionarioId,
      id,
    );

    if (!recibo) {
      throw new NotFoundException('Recibo não encontrado.');
    }

    return recibo;
  }

  @Get('recibos/:id/pdf')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Dados do recibo no formato para geração de PDF' })
  async getReciboPdf(@Req() req: Request, @Param('id') id: string) {
    const payload = this.requireAuth(req);
    this.requirePasswordChanged(payload);

    const recibo = await this.colaboradorService.getReciboPdf(
      payload.funcionarioId,
      id,
    );

    if (!recibo) {
      throw new NotFoundException('Recibo não encontrado.');
    }

    return recibo;
  }

  // ─── Helpers ───

  private requireAuth(req: Request): ColaboradorTokenPayload {
    const payload = this.sessionService.extractFromRequest(req);
    if (!payload) {
      throw new UnauthorizedException('Não autorizado.');
    }
    return payload;
  }

  private requirePasswordChanged(payload: ColaboradorTokenPayload): void {
    if (payload.primeiroAcesso) {
      throw new UnauthorizedException(
        'É necessário alterar a senha antes de acessar o sistema.',
      );
    }
  }
}
