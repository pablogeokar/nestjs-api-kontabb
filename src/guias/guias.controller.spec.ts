import {
    ForbiddenException,
    type INestApplication,
    NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'http';
import request from 'supertest';
import { GuiasController } from './guias.controller';
import { GuiasService } from './guias.service';
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

describe('GuiasController receipt URL', () => {
    const getAccessibleGuia = jest.fn();
    const getSignedUrl = jest.fn();
    const consume = jest.fn().mockResolvedValue(undefined);
    const controller = new GuiasController(
        {
            getAccessibleGuia,
            getSignedUrl,
        } as unknown as GuiasService,
        { generateRequestId: jest.fn() } as unknown as AppLogger,
        { consume } as unknown as RateLimitService,
    );

    beforeEach(() => {
        jest.clearAllMocks();
        consume.mockResolvedValue(undefined);
    });

    it('returns a short-lived signed URL for an authorized receipt', async () => {
        getAccessibleGuia.mockResolvedValue({
            guia: { comprovanteKey: 'receipts/guia/receipt.pdf' },
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
            'receipts/guia/receipt.pdf',
        );
    });

    it('allows staff to access an existing receipt', async () => {
        getAccessibleGuia.mockResolvedValue({
            guia: { comprovanteKey: 'receipts/guia/receipt.pdf' },
            authorized: true,
        });
        getSignedUrl.mockResolvedValue('https://signed.example/receipt');

        await expect(
            controller.getReceiptSignedUrl(
                '5e207394-50e4-41d9-90c2-34f4f5f8e462',
                STAFF,
            ),
        ).resolves.toEqual({ url: 'https://signed.example/receipt' });
        expect(getAccessibleGuia).toHaveBeenCalledWith(
            '5e207394-50e4-41d9-90c2-34f4f5f8e462',
            STAFF,
        );
    });

    it('returns 404 when the guia does not exist', async () => {
        getAccessibleGuia.mockResolvedValue({
            guia: null,
            authorized: false,
        });

        await expect(
            controller.getReceiptSignedUrl(
                '5e207394-50e4-41d9-90c2-34f4f5f8e462',
                USER,
            ),
        ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns 403 for another client guia', async () => {
        getAccessibleGuia.mockResolvedValue({
            guia: { comprovanteKey: 'receipt.pdf' },
            authorized: false,
        });

        await expect(
            controller.getReceiptSignedUrl(
                '5e207394-50e4-41d9-90c2-34f4f5f8e462',
                USER,
            ),
        ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('returns 404 when the guia has no receipt', async () => {
        getAccessibleGuia.mockResolvedValue({
            guia: { comprovanteKey: null },
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

describe('GuiasController receipt route validation', () => {
    let app: INestApplication;

    beforeAll(async () => {
        const module = await Test.createTestingModule({
            controllers: [GuiasController],
            providers: [
                {
                    provide: GuiasService,
                    useValue: {
                        getAccessibleGuia: jest.fn(),
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

    it('returns 400 for an invalid receipt guia UUID', async () => {
        await request(app.getHttpServer() as Server)
            .get('/guias/not-a-uuid/comprovante')
            .expect(400);
    });
});
