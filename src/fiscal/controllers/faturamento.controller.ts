import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthGuard } from '../../auth/auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { Roles } from '../../auth/roles.decorator';
import type { CurrentUser as CurrentUserType } from '../../common/types';
import { RateLimitService } from '../../common/rate-limit.service';
import { FaturamentoService } from '../services/faturamento.service';

@Controller('cliente/fiscal/faturamento')
@UseGuards(AuthGuard)
@Roles('CLIENTE')
export class FaturamentoClienteController {
  constructor(private readonly faturamento: FaturamentoService) {}

  @Get()
  listar(@CurrentUser() user: CurrentUserType) {
    return this.faturamento.listar(user.id);
  }

  @Post()
  emitir(
    @CurrentUser() user: CurrentUserType,
    @Body() body: { inicio: string; fim: string },
  ) {
    return this.faturamento.emitir(
      user.id,
      body.inicio,
      body.fim,
      user.impersonatedBy ?? user.id,
    );
  }

  @Get(':codigo/pdf')
  async pdf(
    @CurrentUser() user: CurrentUserType,
    @Param('codigo') codigo: string,
    @Res() response: Response,
  ) {
    const buffer = await this.faturamento.documento(codigo, user.id);
    response.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition':
        'attachment; filename="demonstrativo-faturamento.pdf"',
      'Cache-Control': 'no-store',
    });
    response.send(buffer);
  }
}

@Controller('public/faturamento')
export class FaturamentoPublicoController {
  constructor(
    private readonly faturamento: FaturamentoService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Post('verificar')
  async verificar(
    @Req() request: Request,
    @Body() body: { codigo: string },
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.rateLimit.consume({
      key: `faturamento:publico:${request.ip}`,
      limit: 30,
      windowMs: 60 * 60 * 1000,
    });
    response.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
    return this.faturamento.verificar(this.code(body));
  }

  @Post('documento')
  async documento(
    @Req() request: Request,
    @Body() body: { codigo: string },
    @Res() response: Response,
  ) {
    await this.rateLimit.consume({
      key: `faturamento:pdf:${request.ip}`,
      limit: 15,
      windowMs: 60 * 60 * 1000,
    });
    const buffer = await this.faturamento.documento(this.code(body));
    response.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition':
        'attachment; filename="demonstrativo-faturamento-original.pdf"',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    });
    response.send(buffer);
  }

  private code(body: { codigo?: unknown } | undefined): string {
    return typeof body?.codigo === 'string'
      ? body.codigo.trim().toUpperCase()
      : '';
  }
}
