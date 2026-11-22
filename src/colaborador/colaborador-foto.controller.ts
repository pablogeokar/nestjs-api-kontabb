import {
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ColaboradorAuthGuard } from './colaborador-auth.guard';
import { ColaboradorRequirePasswordChangedGuard } from './colaborador-require-password-changed.guard';
import { Colaborador } from './colaborador.decorator';
import type { ColaboradorTokenPayload } from './colaborador-session.service';
import { ColaboradorFotoService } from './colaborador-foto.service';
import { MAX_FOTO_BYTES } from './colaborador-foto-image';
import { RateLimitService } from '../common/rate-limit.service';

@ApiTags('Colaborador')
@Controller('colaborador/foto')
@UseGuards(ColaboradorAuthGuard, ColaboradorRequirePasswordChangedGuard)
export class ColaboradorFotoController {
  constructor(
    private readonly fotos: ColaboradorFotoService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'URL autenticada da própria foto' })
  async getFoto(@Colaborador() actor: ColaboradorTokenPayload) {
    await this.limit(actor, 'read', 60);
    return this.fotos.getFoto(actor);
  }

  @Get('imagem')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Imagem da própria foto, sem expor o bucket' })
  async getImagem(
    @Colaborador() actor: ColaboradorTokenPayload,
    @Res() res: Response,
  ) {
    await this.limit(actor, 'read', 60);
    const bytes = await this.fotos.getImagem(actor);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(bytes);
  }

  @Post()
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_FOTO_BYTES, files: 1, fields: 0 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiOperation({ summary: 'Enviar foto JPEG, PNG ou WebP de até 2 MB' })
  async upload(
    @Colaborador() actor: ColaboradorTokenPayload,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    await this.limit(actor, 'write', 10);
    return this.fotos.upload(actor, file);
  }

  @Delete()
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Remover a própria foto' })
  async remove(@Colaborador() actor: ColaboradorTokenPayload) {
    await this.limit(actor, 'write', 10);
    return this.fotos.remove(actor);
  }

  private limit(actor: ColaboradorTokenPayload, action: string, limit: number) {
    return this.rateLimit.consume({
      key: `colaborador-foto:${action}:${actor.funcionarioId}`,
      limit,
      windowMs: 60_000,
    });
  }
}
