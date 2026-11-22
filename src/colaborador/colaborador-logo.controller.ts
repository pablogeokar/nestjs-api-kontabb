import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ColaboradorAuthGuard } from './colaborador-auth.guard';
import { ColaboradorRequirePasswordChangedGuard } from './colaborador-require-password-changed.guard';
import { Colaborador } from './colaborador.decorator';
import type { ColaboradorTokenPayload } from './colaborador-session.service';
import { ColaboradorLogoService } from './colaborador-logo.service';
import { RateLimitService } from '../common/rate-limit.service';

@ApiTags('Colaborador')
@Controller('colaborador/logo')
@UseGuards(ColaboradorAuthGuard, ColaboradorRequirePasswordChangedGuard)
export class ColaboradorLogoController {
  constructor(
    private readonly logos: ColaboradorLogoService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Get('imagem')
  @ApiOperation({ summary: 'Logo da empresa do colaborador para o crachá' })
  async getImagem(
    @Colaborador() actor: ColaboradorTokenPayload,
    @Res() res: Response,
  ) {
    await this.rateLimit.consume({
      key: `colaborador-logo:${actor.funcionarioId}`,
      limit: 60,
      windowMs: 60_000,
    });
    const { bytes, contentType } = await this.logos.getImagem(actor);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(bytes);
  }
}
