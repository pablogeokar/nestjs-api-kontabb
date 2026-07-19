import {
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
import { ClientesService } from './clientes.service';
import { AuthGuard } from '../auth/auth.guard';
import { StaffOnly } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AppLogger } from '../common/logger.service';
import { parsePaginationParams, buildPaginatedResponse } from '../common/pagination';
import type { CurrentUser as CurrentUserType } from '../common/types';
import { CreateClientDto, UpdateClientDto, BatchClientDto } from './clientes.dto';

@Controller('admin/clientes')
@UseGuards(AuthGuard)
@StaffOnly()
export class ClientesController {
    constructor(
        private readonly clientesService: ClientesService,
        private readonly logger: AppLogger,
    ) { }

    @Get()
    async list(@Query() query: { page?: string; pageSize?: string; search?: string }) {
        const pagination = parsePaginationParams(query);
        const result = await this.clientesService.listClients({
            search: query.search?.trim() || '',
            pagination,
        });
        return buildPaginatedResponse(result.data, result.total, pagination);
    }

    @Post()
    async create(@Body() dto: CreateClientDto, @CurrentUser() currentUser: CurrentUserType) {
        const requestId = this.logger.generateRequestId();
        const emails = this.normalizeEmails(dto.emails);

        const result = await this.clientesService.registerClient({
            requestId,
            actorUserId: currentUser.id,
            companyName: dto.company_name.trim(),
            cnpj: dto.cnpj.replace(/\D/g, ''),
            emails,
        });

        if (!result.ok) {
            if (result.code === 'DUPLICATE') {
                return { code: 'DUPLICATE', error: 'CNPJ já cadastrado.', message: 'CNPJ já cadastrado.', statusCode: 409 };
            }
            return { code: result.code, error: 'Erro ao criar cliente.', message: 'Erro ao criar cliente.', statusCode: 500 };
        }

        return { success: true, id: result.clientId };
    }

    @Post('batch')
    @HttpCode(HttpStatus.OK)
    async batchCreate(@Body() dto: BatchClientDto, @CurrentUser() currentUser: CurrentUserType) {
        const requestId = this.logger.generateRequestId();
        const results: Array<{ cnpj: string; company_name: string; success: boolean; message: string }> = [];

        for (const client of dto.clients) {
            const result = await this.clientesService.registerClient({
                requestId,
                actorUserId: currentUser.id,
                cnpj: client.cnpj.replace(/\D/g, ''),
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
    async update(
        @Param('id') id: string,
        @Body() dto: UpdateClientDto,
        @CurrentUser() currentUser: CurrentUserType,
    ) {
        const updated = await this.clientesService.updateClient({
            clientId: id,
            actorUserId: currentUser.id,
            companyName: dto.company_name?.trim(),
            emails: dto.emails ? this.normalizeEmails(dto.emails) : undefined,
        });
        if (!updated) throw new NotFoundException('Cliente não encontrado.');
        return { success: true };
    }

    @Delete(':id')
    async delete(@Param('id') id: string, @CurrentUser() currentUser: CurrentUserType) {
        const requestId = this.logger.generateRequestId();
        const result = await this.clientesService.deleteClient({
            requestId,
            clientId: id,
            actorUserId: currentUser.id,
        });
        if (!result.deleted) throw new NotFoundException('Cliente não encontrado.');
        return { success: true, message: 'Cliente excluído com sucesso.', cleanupPending: result.cleanupPending };
    }

    private normalizeEmails(input: string | string[] | undefined | null): string[] {
        const list = Array.isArray(input) ? input : input ? [input] : [];
        return list.map((e) => e.trim().toLowerCase()).filter(Boolean);
    }
}
