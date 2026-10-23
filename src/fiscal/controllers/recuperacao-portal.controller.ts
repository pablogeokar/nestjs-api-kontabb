import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '../../auth/auth.guard';
import { StaffOnly } from '../../auth/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { CurrentUser as User } from '../../common/types';
import { RateLimitService } from '../../common/rate-limit.service';
import { getRequestId, type RequestWithId } from '../../common/request-id';
import { RecuperacaoPortalService } from '../services/recuperacao-portal.service';
import {
  ImportarRecuperacaoPortalDto,
  PrepararRecuperacaoPortalDto,
} from '../dto/recuperacao-portal.dto';

@Controller('admin/fiscal/recuperacao-portal')
@UseGuards(AuthGuard)
@StaffOnly()
export class RecuperacaoPortalController {
  constructor(
    private readonly service: RecuperacaoPortalService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Post('preparar')
  @HttpCode(200)
  async preparar(
    @Body() body: PrepararRecuperacaoPortalDto,
    @CurrentUser() user: User,
  ) {
    await this.rateLimit.consume({
      key: `portal-prepare:${user.id}`,
      limit: 20,
      windowMs: 60_000,
    });
    return { data: await this.service.preparar(body.clienteId, body.chaves) };
  }

  @Post('importar')
  @HttpCode(200)
  @UseInterceptors(
    FileInterceptor('arquivo', { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  async importar(
    @Body() body: ImportarRecuperacaoPortalDto,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: User,
    @Req() request: RequestWithId,
  ) {
    await this.rateLimit.consume({
      key: `fiscal-xml-import:${user.id}`,
      limit: 60,
      windowMs: 60_000,
    });
    const data = await this.service.importar({
      ...body,
      file,
      actorUserId: user.id,
      requestId: getRequestId(request),
    });
    return { success: data.erros === 0 && data.ignorados === 0, data };
  }
}
