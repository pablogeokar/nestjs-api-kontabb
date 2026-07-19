import {
    BadRequestException,
    Controller,
    HttpCode,
    HttpStatus,
    Post,
    UploadedFiles,
    UseGuards,
    UseInterceptors,
    Body,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { DocumentosService } from '../documentos/documentos.service';
import { ClientesService } from '../clientes/clientes.service';
import { AuthGuard } from '../auth/auth.guard';
import { StaffOnly } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AppLogger } from '../common/logger.service';
import { hasValidFileSignature } from '../common/file-validation';
import { extractPdfText, extractDadosFiscais, type DadosFiscais } from '../common/pdf-extraction';
import type { CurrentUser as CurrentUserType } from '../common/types';

interface FileResult {
    fileName: string;
    success: boolean;
    message: string;
    cnpj?: string;
    period?: string;
    type?: string;
    valor?: string;
    parcela?: string;
}

function vencimentoToIso(v: string): string {
    const [dd, mm, yyyy] = v.split('/');
    return `${yyyy}-${mm}-${dd}`;
}

@Controller('admin/upload')
@UseGuards(AuthGuard)
@StaffOnly()
export class UploadController {
    constructor(
        private readonly documentosService: DocumentosService,
        private readonly clientesService: ClientesService,
        private readonly logger: AppLogger,
    ) { }

    @Post()
    @HttpCode(HttpStatus.OK)
    @UseInterceptors(FilesInterceptor('files', 20, { limits: { fileSize: 10 * 1024 * 1024 } }))
    async upload(
        @UploadedFiles() files: Express.Multer.File[],
        @Body() body: { cnpj?: string; period?: string; type?: string; due_date?: string },
        @CurrentUser() currentUser: CurrentUserType,
    ) {
        const requestId = this.logger.generateRequestId();

        if (!files || files.length === 0) {
            throw new BadRequestException('Nenhum arquivo enviado.');
        }

        const manualCnpj = body.cnpj?.trim().replace(/\D/g, '') || null;
        const manualPeriod = body.period?.trim() || null;
        const manualType = body.type?.trim() || null;
        const manualDueDate = body.due_date?.trim() || null;

        const results: FileResult[] = [];

        for (const file of files) {
            const result = await this.processFile(file, {
                requestId,
                actorUserId: currentUser.id,
                manualCnpj,
                manualPeriod,
                manualType,
                manualDueDate,
            });
            results.push(result);
        }

        const allSuccess = results.every((r) => r.success);
        const someSuccess = results.some((r) => r.success);

        return {
            success: allSuccess,
            partial: !allSuccess && someSuccess,
            total: results.length,
            processed: results.filter((r) => r.success).length,
            failed: results.filter((r) => !r.success).length,
            results,
        };
    }

    @Post('validate')
    @HttpCode(HttpStatus.OK)
    @UseInterceptors(FilesInterceptor('files', 20, { limits: { fileSize: 10 * 1024 * 1024 } }))
    async validate(
        @UploadedFiles() files: Express.Multer.File[],
        @CurrentUser() currentUser: CurrentUserType,
    ) {
        if (!files || files.length === 0) {
            throw new BadRequestException('Nenhum arquivo enviado.');
        }

        const results: Array<{ fileName: string; cnpj: string | null; registered: boolean }> = [];
        const cnpjSet = new Set<string>();

        for (const file of files) {
            if (file.mimetype !== 'application/pdf') {
                results.push({ fileName: file.originalname, cnpj: null, registered: false });
                continue;
            }
            try {
                const bytes = new Uint8Array(file.buffer);
                if (!hasValidFileSignature(bytes, file.mimetype)) {
                    results.push({ fileName: file.originalname, cnpj: null, registered: false });
                    continue;
                }
                const text = await extractPdfText(Buffer.from(file.buffer));
                const dados = extractDadosFiscais(text);
                const rawCnpj = dados.cnpj ? dados.cnpj.replace(/\D/g, '') : null;
                results.push({ fileName: file.originalname, cnpj: rawCnpj, registered: false });
                if (rawCnpj) cnpjSet.add(rawCnpj);
            } catch {
                results.push({ fileName: file.originalname, cnpj: null, registered: false });
            }
        }

        const cnpjArray = Array.from(cnpjSet);
        const registeredCnpjs = await this.clientesService.findRegisteredCnpjs(cnpjArray);

        for (const r of results) {
            if (r.cnpj) r.registered = registeredCnpjs.has(r.cnpj);
        }

        const unregistered = results
            .filter((r) => r.cnpj && !r.registered)
            .reduce<Array<{ cnpj: string; fileNames: string[] }>>((acc, r) => {
                const existing = acc.find((item) => item.cnpj === r.cnpj);
                if (existing) existing.fileNames.push(r.fileName);
                else acc.push({ cnpj: r.cnpj!, fileNames: [r.fileName] });
                return acc;
            }, []);

        const undetected = results.filter((r) => !r.cnpj).map((r) => r.fileName);

        return { needsRegistration: unregistered.length > 0, unregistered, undetected };
    }

    private async processFile(
        file: Express.Multer.File,
        ctx: { requestId: string; actorUserId: string; manualCnpj: string | null; manualPeriod: string | null; manualType: string | null; manualDueDate: string | null },
    ): Promise<FileResult> {
        if (file.mimetype !== 'application/pdf') {
            return { fileName: file.originalname, success: false, message: 'Apenas arquivos PDF são aceitos.' };
        }
        if (file.size > 10 * 1024 * 1024) {
            return { fileName: file.originalname, success: false, message: 'Arquivo muito grande (máx 10MB).' };
        }

        const bytes = new Uint8Array(file.buffer);
        if (!hasValidFileSignature(bytes, file.mimetype)) {
            return { fileName: file.originalname, success: false, message: 'Conteúdo do arquivo não corresponde a um PDF válido.' };
        }

        let dados: DadosFiscais | null = null;
        try {
            const text = await extractPdfText(Buffer.from(file.buffer));
            dados = extractDadosFiscais(text);
        } catch {
            // extraction failed, continue with manual data
        }

        const cnpjRaw = ctx.manualCnpj || (dados?.cnpj ? dados.cnpj.replace(/\D/g, '') : null) || null;
        const tipo = ctx.manualType || (dados?.tipo && dados.tipo !== 'DESCONHECIDO' ? dados.tipo : null) || 'OUTROS';
        const periodo = ctx.manualPeriod || dados?.periodo || null;
        const vencimento = ctx.manualDueDate || (dados?.vencimento ? vencimentoToIso(dados.vencimento) : null) || null;

        if (!cnpjRaw) {
            return { fileName: file.originalname, success: false, message: 'Não foi possível identificar o CNPJ. Preencha manualmente.' };
        }

        const client = await this.clientesService.findClientForUpload(cnpjRaw);
        if (!client) {
            return { fileName: file.originalname, success: false, message: `Cliente com CNPJ ${cnpjRaw} não encontrado.`, cnpj: cnpjRaw };
        }

        const now = new Date();
        const finalPeriod = periodo || `${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()}`;

        const existing = await this.documentosService.findDuplicateDocument({ clientId: client.id, type: tipo, period: finalPeriod });
        if (existing) {
            return {
                fileName: file.originalname,
                success: false,
                message: `Documento duplicado: já existe um ${tipo} para o período ${finalPeriod} deste cliente (enviado como "${existing.arquivoNome}").`,
                cnpj: client.cnpj, period: finalPeriod, type: tipo,
            };
        }

        const valorNumerico = dados?.valor ? dados.valor.replace(/\./g, '').replace(',', '.') : null;
        const parcela = dados?.parcelamento ? `${dados.parcelamento.parcela ?? '?'}/${dados.parcelamento.totalParcelas ?? '?'}` : null;

        const upload = await this.documentosService.uploadDocument({
            requestId: ctx.requestId,
            actorUserId: ctx.actorUserId,
            client: { id: client.id, cnpj: client.cnpj, razaoSocial: client.razaoSocial, emails: client.emails },
            bytes: Buffer.from(file.buffer),
            fileName: file.originalname,
            tipo,
            periodo: finalPeriod,
            vencimento,
            valorNumerico,
            valorLabel: dados?.valor ?? null,
            parcelaLabel: parcela,
        });

        if (!upload.ok) {
            const message = upload.code === 'DUPLICATE'
                ? `Documento duplicado: já existe um ${tipo} para o período ${finalPeriod}.`
                : upload.code === 'STORAGE_FAILED'
                    ? 'Falha ao armazenar o documento. Tente novamente.'
                    : 'Falha ao registrar o documento. Tente novamente.';
            return { fileName: file.originalname, success: false, message, cnpj: client.cnpj };
        }

        return {
            fileName: file.originalname,
            success: true,
            message: 'Documento processado com sucesso.',
            cnpj: client.cnpj,
            period: finalPeriod,
            type: tipo,
            valor: dados?.valor ?? undefined,
            parcela: parcela ?? undefined,
        };
    }
}
