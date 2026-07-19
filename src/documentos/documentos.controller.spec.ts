import {
    ForbiddenException,
    type INestApplication,
    NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'http';
import request from 'supertest';
import { DocumentosController } from './documentos.controller';
import { DocumentosService } from './documentos.service';
import { AppLogger } from '../common/logger.service';
import { RateLimitService } from '../common/rate-limit.service';
import type { CurrentUser } from '../common/types';
import { AuthGuard } from '../auth/auth.guard';

const USER: CurrentUser = {
    id: 'user-id',
    name: 'User',
    email: 'user@example.com',
    role: 'CLIENTE',
};

const STAFF: CurrentUser = {
    ...USER,
    id: 'staff-id',
    role: 'ADMIN',
};

describe('DocumentosController receipt URL', () => {
    const getAccessibleDocument = jest.fn();
    const getSignedUrl = jest.fn();
    const consume = jest.fn().mockResolvedValue(undefined);
    const controller = new DocumentosController(
        {
            getAccessibleDocument,
            getSignedUrl,
        } as unknown as DocumentosService,
        { generateRequestId: jest.fn() } as unknown as AppLogger,
        { consume } as unknown as RateLimitService,
    );

    beforeEach(() => {
        jest.clearAllMocks();
        consume.mockResolvedValue(undefined);
    });

    it('returns a short-lived signed URL for an authorized receipt', async () => {
        getAccessibleDocument.mockResolvedValue({
            document: { comprovanteKey: 'receipts/document/receipt.pdf' },
            authorized: true,
        });
        getSignedUrl.mockResolvedValue('https://signed.example/receipt');

        await expect(
            controller.getReceiptSignedUrl(
                '5e207394-50e4-41d9-90c2-34f4f5f8e462',
                USER,
            ),
        ).resolves.toEqual({ url: 'https://signed.example/receipt' });
        expect(getSignedUrl).toHaveBeenCalledWith(
            'receipts/document/receipt.pdf',
        );
    });

    it('allows staff to access an existing receipt', async () => {
        getAccessibleDocument.mockResolvedValue({
            document: { comprovanteKey: 'receipts/document/receipt.pdf' },
            authorized: true,
        });
        getSignedUrl.mockResolvedValue('https://signed.example/receipt');

        await expect(
            controller.getReceiptSignedUrl(
                '5e207394-50e4-41d9-90c2-34f4f5f8e462',
                STAFF,
            ),
        ).resolves.toEqual({ url: 'https://signed.example/receipt' });
        expect(getAccessibleDocument).toHaveBeenCalledWith(
            '5e207394-50e4-41d9-90c2-34f4f5f8e462',
            STAFF,
        );
    });

    it('returns 404 when the document does not exist', async () => {
        getAccessibleDocument.mockResolvedValue({
            document: null,
            authorized: false,
        });

        await expect(
            controller.getReceiptSignedUrl(
                '5e207394-50e4-41d9-90c2-34f4f5f8e462',
                USER,
            ),
        ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns 403 for another client document', async () => {
        getAccessibleDocument.mockResolvedValue({
            document: { comprovanteKey: 'receipt.pdf' },
            authorized: false,
        });

        await expect(
            controller.getReceiptSignedUrl(
                '5e207394-50e4-41d9-90c2-34f4f5f8e462',
                USER,
            ),
        ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('returns 404 when the document has no receipt', async () => {
        getAccessibleDocument.mockResolvedValue({
            document: { comprovanteKey: null },
            authorized: true,
        });

        await expect(
            controller.getReceiptSignedUrl(
                '5e207394-50e4-41d9-90c2-34f4f5f8e462',
                USER,
            ),
        ).rejects.toBeInstanceOf(NotFoundException);
    });
});

describe('DocumentosController receipt route validation', () => {
    let app: INestApplication;

    beforeAll(async () => {
        const module = await Test.createTestingModule({
            controllers: [DocumentosController],
            providers: [
                {
                    provide: DocumentosService,
                    useValue: {
                        getAccessibleDocument: jest.fn(),
                        getSignedUrl: jest.fn(),
                    },
                },
                {
                    provide: AppLogger,
                    useValue: { generateRequestId: jest.fn() },
                },
                {
                    provide: RateLimitService,
                    useValue: { consume: jest.fn() },
                },
            ],
        })
            .overrideGuard(AuthGuard)
            .useValue({
                canActivate: (context: {
                    switchToHttp(): {
                        getRequest(): { user?: CurrentUser };
                    };
                }) => {
                    context.switchToHttp().getRequest().user = USER;
                    return true;
                },
            })
            .compile();

        app = module.createNestApplication();
        await app.init();
    });

    afterAll(async () => {
        await app.close();
    });

    it('returns 400 for an invalid receipt document UUID', async () => {
        await request(app.getHttpServer() as Server)
            .get('/documentos/not-a-uuid/comprovante')
            .expect(400);
    });
});
