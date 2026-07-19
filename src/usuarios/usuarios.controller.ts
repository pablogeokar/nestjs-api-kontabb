import {
    BadRequestException,
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    NotFoundException,
    Param,
    Patch,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common';
import { UsuariosService } from './usuarios.service';
import { AuthGuard } from '../auth/auth.guard';
import { AdminOnly } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AppLogger } from '../common/logger.service';
import { parsePaginationParams, buildPaginatedResponse } from '../common/pagination';
import type { CurrentUser as CurrentUserType } from '../common/types';

@Controller('admin/usuarios')
@UseGuards(AuthGuard)
@AdminOnly()
export class UsuariosController {
    constructor(
        private readonly usuariosService: UsuariosService,
        private readonly logger: AppLogger,
    ) { }

    @Get()
    async list(@Query() query: { page?: string; pageSize?: string; role?: string; search?: string }) {
        const pagination = parsePaginationParams(query);
        const result = await this.usuariosService.listSystemUsers({
            role: query.role || '',
            search: query.search?.trim() || '',
            pagination,
        });
        return buildPaginatedResponse(result.data, result.total, pagination);
    }

    @Post()
    async create(
        @Body() body: { name: string; email: string; password: string; role?: string },
        @CurrentUser() currentUser: CurrentUserType,
    ) {
        const requestId = this.logger.generateRequestId();
        const { name, email, password, role = 'COLABORADOR' } = body;

        if (await this.usuariosService.existsByEmail(email.trim().toLowerCase())) {
            throw new BadRequestException('Email já cadastrado.');
        }

        const result = await this.usuariosService.createSystemUser({
            requestId,
            actorUserId: currentUser.id,
            name: name.trim(),
            email: email.trim().toLowerCase(),
            password,
            role,
        });

        if (!result.ok) {
            if (result.code === 'DUPLICATE') throw new BadRequestException('Email já cadastrado.');
            throw new BadRequestException('Erro ao criar usuário.');
        }

        return { success: true, user: { id: result.userId, name, email, role } };
    }

    @Patch(':id')
    async update(
        @Param('id') id: string,
        @Body() body: { name?: string; role?: string },
        @CurrentUser() currentUser: CurrentUserType,
    ) {
        if (id === currentUser.id) {
            throw new BadRequestException('Você não pode alterar seu próprio perfil por aqui.');
        }
        const updated = await this.usuariosService.updateSystemUser({
            userId: id,
            actorUserId: currentUser.id,
            name: body.name?.trim(),
            role: body.role,
        });
        if (!updated) throw new NotFoundException('Usuário não encontrado.');
        return { success: true };
    }

    @Delete(':id')
    async delete(@Param('id') id: string, @CurrentUser() currentUser: CurrentUserType) {
        if (id === currentUser.id) {
            throw new BadRequestException('Você não pode excluir sua própria conta.');
        }
        const deleted = await this.usuariosService.deleteSystemUser({
            userId: id,
            actorUserId: currentUser.id,
        });
        if (!deleted) throw new NotFoundException('Usuário não encontrado.');
        return { success: true, message: 'Usuário excluído com sucesso.' };
    }

    @Patch(':id/password')
    @HttpCode(HttpStatus.OK)
    async changePassword(
        @Param('id') id: string,
        @Body() body: { password: string },
        @CurrentUser() currentUser: CurrentUserType,
    ) {
        const updated = await this.usuariosService.changePassword({
            userId: id,
            actorUserId: currentUser.id,
            password: body.password,
        });
        if (!updated) throw new NotFoundException('Usuário não encontrado.');
        return { success: true, message: 'Senha atualizada com sucesso.' };
    }
}
