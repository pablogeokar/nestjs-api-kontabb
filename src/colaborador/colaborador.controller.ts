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
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ColaboradorService } from './colaborador.service';
import {
  ColaboradorSessionService,
  type ColaboradorTokenPayload,
} from './colaborador-session.service';
import { ColaboradorAuthGuard } from './colaborador-auth.guard';
import { ColaboradorRequirePasswordChangedGuard } from './colaborador-require-password-changed.guard';
import { ColaboradorPublic } from './colaborador-public.decorator';
import { Colaborador } from './colaborador.decorator';
import { ClientesService } from '../clientes/clientes.service';
import { RateLimitService } from '../common/rate-limit.service';
import { AppLogger } from '../common/logger.service';
import { parsePaginationParams } from '../common/pagination';

@ApiTags('Colaborador')
@Controller('colaborador')
@UseGuards(ColaboradorAuthGuard)
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
  @ColaboradorPublic()
  @ApiOperation({ summary: 'Login do colaborador (CNPJ + código + senha)' })
  async login(
    @Body() body: { cnpj: string; codigoFuncionario: string; senha: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const cnpj =
      typeof body?.cnpj === 'string'
        ? body.cnpj.toUpperCase().replace(/[^0-9A-Z]/g, '')
        : '';
    const codigoFuncionario =
      typeof body?.codigoFuncionario === 'string'
        ? body.codigoFuncionario.trim()
        : '';
    const senha = typeof body?.senha === 'string' ? body.senha : '';

    if (!cnpj || !codigoFuncionario || !senha) {
      throw new BadRequestException(
        'CNPJ, código do funcionário e senha são obrigatórios.',
      );
    }

    if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(cnpj)) {
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
      tokenVersion: session.tokenVersion,
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
  @ColaboradorPublic()
  @ApiOperation({ summary: 'Logout do colaborador' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const payload = this.sessionService.extractFromRequest(req);
    if (payload) {
      // Revoke all outstanding tokens for this employee.
      await this.colaboradorService.logout(payload.funcionarioId);
    }
    this.sessionService.clearCookie(res);
    return { success: true };
  }

  @Get('auth/session')
  @HttpCode(HttpStatus.OK)
  @ColaboradorPublic()
  @ApiOperation({ summary: 'Obter sessão do colaborador' })
  async getSession(@Req() req: Request) {
    const payload = this.sessionService.extractFromRequest(req);
    if (!payload) {
      return { user: null };
    }

    const revocation = await this.colaboradorService.getRevocationState(
      payload.funcionarioId,
    );
    if (
      !revocation ||
      !revocation.ativo ||
      revocation.tokenVersion !== payload.tokenVersion
    ) {
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
  async getLogo(@Colaborador() payload: ColaboradorTokenPayload) {
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
    @Colaborador() payload: ColaboradorTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
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

    // changePassword bumped tokenVersion (revoking the old token). Reissue a
    // new token with the updated version so the current user isn't self-revoked.
    const revocation = await this.colaboradorService.getRevocationState(
      payload.funcionarioId,
    );
    if (!revocation) {
      throw new UnauthorizedException('Não autorizado.');
    }

    const newToken = this.sessionService.createToken({
      ...payload,
      primeiroAcesso: false,
      tokenVersion: revocation.tokenVersion,
    });
    this.sessionService.setCookie(res, newToken);

    return { success: true, message: 'Senha alterada com sucesso.' };
  }

  // ─── Portal endpoints ───

  @Get('perfil')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ColaboradorRequirePasswordChangedGuard)
  @ApiOperation({ summary: 'Perfil do colaborador' })
  async getPerfil(@Colaborador() payload: ColaboradorTokenPayload) {
    const perfil = await this.colaboradorService.getPerfil(
      payload.funcionarioId,
    );
    if (!perfil) throw new NotFoundException('Funcionário não encontrado.');

    return perfil;
  }

  @Get('recibos')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ColaboradorRequirePasswordChangedGuard)
  @ApiOperation({ summary: 'Listar recibos de pagamento do colaborador' })
  async listRecibos(
    @Colaborador() payload: ColaboradorTokenPayload,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
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
  @UseGuards(ColaboradorRequirePasswordChangedGuard)
  @ApiOperation({ summary: 'Detalhes de um recibo de pagamento' })
  async getRecibo(
    @Colaborador() payload: ColaboradorTokenPayload,
    @Param('id') id: string,
  ) {
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
  @UseGuards(ColaboradorRequirePasswordChangedGuard)
  @ApiOperation({ summary: 'Dados do recibo no formato para geração de PDF' })
  async getReciboPdf(
    @Colaborador() payload: ColaboradorTokenPayload,
    @Param('id') id: string,
  ) {
    const recibo = await this.colaboradorService.getReciboPdf(
      payload.funcionarioId,
      id,
    );

    if (!recibo) {
      throw new NotFoundException('Recibo não encontrado.');
    }

    return recibo;
  }
}
