import {
    BadRequestException,
    Body,
    Controller,
    ForbiddenException,
    HttpCode,
    HttpStatus,
    Patch,
    UseGuards,
} from '@nestjs/common';
import { ClienteService } from './cliente.service';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { CurrentUser as CurrentUserType } from '../common/types';
import { RateLimitService } from '../common/rate-limit.service';

@Controller('cliente')
@UseGuards(AuthGuard)
export class ClienteController {
    constructor(
        private readonly clienteService: ClienteService,
        private readonly rateLimit: RateLimitService,
    ) { }

    @Patch('first-login')
    @HttpCode(HttpStatus.OK)
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
            throw new BadRequestException('A nova senha deve ser diferente da senha atual.');
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
            throw new BadRequestException('Não foi possível alterar a senha. Confira a senha atual.');
        }

        return { success: true };
    }
}
