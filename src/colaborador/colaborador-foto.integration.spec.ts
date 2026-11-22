import { ColaboradorLogoController } from './colaborador-logo.controller';
import { ColaboradorLogoService } from './colaborador-logo.service';
/** Run only against a disposable local DB: see docs/colaborador-foto.md. */
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { type INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import type { Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq, sql } from 'drizzle-orm';
import sharp from 'sharp';
import { DatabaseService } from '../database/database.service';
import { StorageService } from '../storage/storage.service';
import { StorageCleanupService } from '../storage/storage-cleanup.service';
import { AppLogger } from '../common/logger.service';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { RateLimitService } from '../common/rate-limit.service';
import {
  clientes,
  funcionariosRh,
  storageCleanupJobs,
  eventosAuditoria,
  user,
} from '../database/schema';
import { ClientesService } from '../clientes/clientes.service';
import { ColaboradorService } from './colaborador.service';
import {
  ColaboradorSessionService,
  type ColaboradorTokenPayload,
} from './colaborador-session.service';
import { ColaboradorAuthGuard } from './colaborador-auth.guard';
import { ColaboradorRequirePasswordChangedGuard } from './colaborador-require-password-changed.guard';
import { ColaboradorFotoService } from './colaborador-foto.service';
import { ColaboradorFotoController } from './colaborador-foto.controller';

const testUrl = process.env.COLABORADOR_FOTO_TEST_DATABASE_URL;
if (testUrl) {
  const url = new URL(testUrl);
  if (
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    !url.pathname.endsWith('_test')
  ) {
    throw new Error(
      'Foto integration tests require a disposable local database ending in _test.',
    );
  }
}

(testUrl ? describe : describe.skip)(
  'foto do colaborador (HTTP + PostgreSQL isolado)',
  () => {
    let app: INestApplication<Server>;
    let database: DatabaseService;
    let photos: ColaboradorFotoService;
    let cleanup: StorageCleanupService;
    let session: ColaboradorSessionService;
    let storage: StorageService;
    let base: string;
    let actor: ColaboradorTokenPayload;
    let png: Buffer;
    let uploadMock: jest.SpyInstance;
    const objects = new Map<string, Buffer>();
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as AppLogger;

    beforeAll(async () => {
      const config = new ConfigService({
        DATABASE_URL: testUrl,
        BETTER_AUTH_SECRET: 'isolated-photo-test-secret',
        NODE_ENV: 'test',
        R2_ACCOUNT_ID: 'test',
        R2_BUCKET_NAME: 'test',
        R2_ACCESS_KEY_ID: 'test',
        R2_SECRET_ACCESS_KEY: 'test',
      });
      database = new DatabaseService(config);
      await migrate(database.db, { migrationsFolder: './drizzle' });
      storage = new StorageService(config);
      uploadMock = jest
        .spyOn(storage, 'upload')
        .mockImplementation((key, bytes) => {
          objects.set(key, Buffer.from(bytes));
          return Promise.resolve();
        });
      jest.spyOn(storage, 'download').mockImplementation((key) => {
        const bytes = objects.get(key);
        if (!bytes) return Promise.reject(new Error('Not found'));
        return Promise.resolve(bytes);
      });
      jest.spyOn(storage, 'delete').mockImplementation((key) => {
        objects.delete(key);
        return Promise.resolve();
      });
      const module = await Test.createTestingModule({
        controllers: [ColaboradorFotoController, ColaboradorLogoController],
        providers: [
          ColaboradorFotoService,
          ColaboradorLogoService,
          ColaboradorService,
          ColaboradorSessionService,
          ColaboradorAuthGuard,
          ColaboradorRequirePasswordChangedGuard,
          StorageCleanupService,
          RateLimitService,
          { provide: ConfigService, useValue: config },
          { provide: DatabaseService, useValue: database },
          { provide: StorageService, useValue: storage },
          { provide: AppLogger, useValue: logger },
        ],
      }).compile();
      app = module.createNestApplication();
      app.use(cookieParser());
      app.useGlobalFilters(new HttpExceptionFilter(logger));
      await app.listen(0, '127.0.0.1');
      base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/colaborador/foto`;
      photos = app.get(ColaboradorFotoService);
      session = app.get(ColaboradorSessionService);
      cleanup = app.get(StorageCleanupService);
      png = await sharp({
        create: { width: 80, height: 100, channels: 3, background: 'blue' },
      })
        .png()
        .toBuffer();
    });

    beforeEach(async () => {
      await database.db.execute(
        sql`TRUNCATE clientes, storage_cleanup_jobs, eventos_auditoria, app_rate_limits CASCADE`,
      );
      objects.clear();
      jest.clearAllMocks();
      const [client] = await database.db
        .insert(clientes)
        .values({ cnpj: '12345678000190', razaoSocial: 'Empresa teste' })
        .returning();
      const [employee] = await database.db
        .insert(funcionariosRh)
        .values({
          clienteId: client.id,
          codigoFuncionario: '001',
          nomeCompleto: 'Ana Teste',
          primeiroAcesso: false,
        })
        .returning();
      actor = {
        funcionarioId: employee.id,
        clienteId: client.id,
        codigoFuncionario: '001',
        nomeCompleto: employee.nomeCompleto,
        cargo: null,
        cnpj: client.cnpj,
        razaoSocial: client.razaoSocial,
        primeiroAcesso: false,
        tokenVersion: 0,
        exp: 0,
      };
    });

    afterAll(async () => {
      if (app) await app.close();
      else if (database) await database.onModuleDestroy();
    });

    function cookie(payload = actor) {
      return `kontabb-colaborador-session=${session.createToken(payload)}`;
    }
    function file() {
      return { buffer: png, mimetype: 'image/png' } as Express.Multer.File;
    }
    async function uploadHttp(
      bytes: Buffer = png,
      type = 'image/png',
      auth = cookie(),
    ) {
      const form = new FormData();
      form.append(
        'file',
        new Blob([new Uint8Array(bytes)], { type }),
        'foto.png',
      );
      return fetch(base, {
        method: 'POST',
        headers: { Cookie: auth },
        body: form,
      });
    }
    async function currentKey() {
      const [row] = await database.db
        .select()
        .from(funcionariosRh)
        .where(eq(funcionariosRh.id, actor.funcionarioId));
      return row?.fotoKey;
    }

    it('envia, lê e remove a própria foto sem expor a key; audita o colaborador', async () => {
      expect((await photos.getFoto(actor)).fotoUrl).toBeNull();
      const uploaded = await uploadHttp();
      expect(uploaded.status).toBe(200);
      const body = (await uploaded.json()) as { fotoUrl: string };
      expect(body.fotoUrl).toMatch(
        /^\/api\/colaborador\/foto\/imagem\?v=[a-f0-9]{16}$/,
      );
      const image = await fetch(`${base}/imagem`, {
        headers: { Cookie: cookie() },
      });
      expect(image.status).toBe(200);
      expect(image.headers.get('content-type')).toContain('image/webp');
      expect(image.headers.get('cache-control')).toBe('private, no-store');
      expect(
        (await sharp(Buffer.from(await image.arrayBuffer())).metadata()).format,
      ).toBe('webp');
      expect(
        (await fetch(base, { method: 'DELETE', headers: { Cookie: cookie() } }))
          .status,
      ).toBe(200);
      expect(await currentKey()).toBeNull();
      expect(
        (await fetch(`${base}/imagem`, { headers: { Cookie: cookie() } }))
          .status,
      ).toBe(404);
      const events = await database.db.select().from(eventosAuditoria);
      expect(events).toHaveLength(2);
      expect(events[0].atorUserId).toBeNull();
      expect(events[0].dados).toEqual({
        atorTipo: 'COLABORADOR',
        funcionarioId: actor.funcionarioId,
      });
      await cleanup.processJobs();
      expect(objects.size).toBe(0);
    });

    it('nega sessão ausente, primeiro acesso e token revogado', async () => {
      expect((await uploadHttp(png, 'image/png', '')).status).toBe(401);
      expect(
        (
          await uploadHttp(
            png,
            'image/png',
            cookie({ ...actor, primeiroAcesso: true }),
          )
        ).status,
      ).toBe(401);
      expect(
        (
          await uploadHttp(
            png,
            'image/png',
            cookie({ ...actor, tokenVersion: 99 }),
          )
        ).status,
      ).toBe(401);
      await database.db
        .update(funcionariosRh)
        .set({ ativo: false })
        .where(eq(funcionariosRh.id, actor.funcionarioId));
      expect((await uploadHttp()).status).toBe(401);
      expect(uploadMock).not.toHaveBeenCalled();
    });

    it('isola funcionários e não aceita ID ou key fornecido pelo cliente', async () => {
      await photos.upload(actor, file());
      const [other] = await database.db
        .insert(funcionariosRh)
        .values({
          clienteId: actor.clienteId,
          codigoFuncionario: '002',
          nomeCompleto: 'Outro',
          primeiroAcesso: false,
        })
        .returning();
      expect(
        (await photos.getFoto({ ...actor, funcionarioId: other.id })).fotoUrl,
      ).toBeNull();
      expect(
        (
          await fetch(`${base}/imagem`, {
            headers: { Cookie: cookie({ ...actor, funcionarioId: other.id }) },
          })
        ).status,
      ).toBe(404);
      const form = new FormData();
      form.append(
        'file',
        new Blob([new Uint8Array(png)], { type: 'image/png' }),
        'foto.png',
      );
      form.append('funcionarioId', actor.funcionarioId);
      expect(
        (
          await fetch(base, {
            method: 'POST',
            headers: { Cookie: cookie() },
            body: form,
          })
        ).status,
      ).toBe(400);
      await expect(
        photos.getFoto({ ...actor, clienteId: other.id }),
      ).rejects.toMatchObject({ status: 401 });
    });

    it('rejeita MIME falso e arquivos grandes na rota multipart', async () => {
      expect((await uploadHttp(Buffer.from('<svg/>'))).status).toBe(400);
      expect((await uploadHttp(Buffer.alloc(2 * 1024 * 1024 + 1))).status).toBe(
        413,
      );
      expect(uploadMock).not.toHaveBeenCalled();
    });

    it('serializa uploads concorrentes e limpa somente fotos substituídas', async () => {
      const results = await Promise.all([
        photos.upload(actor, file()),
        photos.upload(actor, file()),
        photos.upload(actor, file()),
      ]);
      expect(new Set(results.map((result) => result.fotoUrl)).size).toBe(3);
      const active = await currentKey();
      expect(await database.db.select().from(storageCleanupJobs)).toHaveLength(
        2,
      );
      await cleanup.processJobs();
      expect([...objects.keys()]).toEqual([active]);
    });

    it('faz rollback e compensa o objeto se a auditoria falhar no banco', async () => {
      await photos.upload(actor, file());
      const old = await currentKey();
      await database.db.execute(
        sql`ALTER TABLE eventos_auditoria ADD CONSTRAINT foto_test_failure CHECK (acao <> 'FUNCIONARIO_FOTO_ATUALIZADA') NOT VALID`,
      );
      try {
        await expect(photos.upload(actor, file())).rejects.toMatchObject({
          status: 503,
        });
        expect(await currentKey()).toBe(old);
        expect([...objects.keys()]).toEqual([old]);
      } finally {
        await database.db.execute(
          sql`ALTER TABLE eventos_auditoria DROP CONSTRAINT foto_test_failure`,
        );
      }
    });

    it('mantém o job recuperável quando a exclusão no R2 falha', async () => {
      await photos.upload(actor, file());
      await photos.remove(actor);
      jest
        .spyOn(storage, 'delete')
        .mockRejectedValueOnce(new Error('R2 unavailable'));
      expect((await cleanup.processJobs()).failed).toBe(1);
      expect((await cleanup.processJobs()).completed).toBe(1);
      expect(objects.size).toBe(0);
    });

    it('serve somente a logo da própria empresa e mantém a key privada', async () => {
      const logoUrl = base.replace(/\/foto$/, '/logo/imagem');
      expect((await fetch(logoUrl)).status).toBe(401);
      expect(
        (await fetch(logoUrl, { headers: { Cookie: cookie() } })).status,
      ).toBe(404);
      expect(
        (await app.get(ColaboradorService).getPerfil(actor.funcionarioId))
          ?.logoUrl,
      ).toBeNull();
      objects.set('empresa/logo.png', png);
      await database.db
        .update(clientes)
        .set({ logoKey: 'empresa/logo.png' })
        .where(eq(clientes.id, actor.clienteId));
      const image = await fetch(logoUrl, { headers: { Cookie: cookie() } });
      expect(image.status).toBe(200);
      expect(image.headers.get('content-type')).toContain('image/png');
      expect(image.headers.get('cache-control')).toBe('private, no-store');
      expect(Buffer.from(await image.arrayBuffer())).toEqual(png);
      const perfil = await app
        .get(ColaboradorService)
        .getPerfil(actor.funcionarioId);
      expect(perfil?.logoUrl).toBe('/api/colaborador/logo/imagem');
      expect(perfil).not.toHaveProperty('logoKey');
      const [other] = await database.db
        .insert(clientes)
        .values({
          cnpj: '99887766000155',
          razaoSocial: 'Outra empresa',
          logoKey: 'empresa/logo.png',
        })
        .returning();
      await expect(
        app
          .get(ColaboradorLogoService)
          .getImagem({ ...actor, clienteId: other.id }),
      ).rejects.toMatchObject({ status: 401 });
    });

    it('retorna erro estável se a logo do R2 estiver ausente ou inválida', async () => {
      await database.db
        .update(clientes)
        .set({ logoKey: 'logo-indisponivel.png' })
        .where(eq(clientes.id, actor.clienteId));
      const logoUrl = base.replace(/\/foto$/, '/logo/imagem');
      const missing = await fetch(logoUrl, { headers: { Cookie: cookie() } });
      expect(missing.status).toBe(503);
      expect(await missing.json()).toMatchObject({
        message: 'Não foi possível carregar a logo.',
      });
      objects.set('logo-indisponivel.png', Buffer.from('<svg/>'));
      expect(
        (await fetch(logoUrl, { headers: { Cookie: cookie() } })).status,
      ).toBe(503);
      expect(
        (
          await fetch(logoUrl, {
            headers: { Cookie: cookie({ ...actor, primeiroAcesso: true }) },
          })
        ).status,
      ).toBe(401);
    });

    it('mantém a foto anterior e permite retry quando o upload no R2 falha', async () => {
      await photos.upload(actor, file());
      const old = await currentKey();
      uploadMock.mockRejectedValueOnce(new Error('R2 unavailable'));
      await expect(photos.upload(actor, file())).rejects.toMatchObject({
        status: 503,
      });
      expect(await currentKey()).toBe(old);
      expect([...objects.keys()]).toEqual([old]);
      await expect(photos.upload(actor, file())).resolves.toHaveProperty(
        'fotoUrl',
      );
    });

    it('limita alterações e mantém a foto após exceder a janela', async () => {
      for (let attempt = 0; attempt < 10; attempt++) {
        expect(
          (
            await fetch(base, {
              method: 'DELETE',
              headers: { Cookie: cookie() },
            })
          ).status,
        ).toBe(200);
      }
      expect((await uploadHttp()).status).toBe(429);
      expect(uploadMock).not.toHaveBeenCalled();
    });

    it.each([false, true])(
      'limpa fotos no cascade da empresa (upload concorrente: %s)',
      async (concurrentUpload) => {
        await photos.upload(actor, file());
        await database.db
          .insert(user)
          .values({
            id: 'test-operator',
            name: 'Operador teste',
            email: 'photo-test@example.test',
            role: 'ADMIN',
          })
          .onConflictDoNothing();
        const clients = new ClientesService(
          database,
          logger,
          storage,
          cleanup,
          {} as never,
          {} as never,
        );
        const deletion = clients.deleteClient({
          clientId: actor.clienteId,
          actorUserId: 'test-operator',
        });
        if (concurrentUpload)
          await Promise.allSettled([photos.upload(actor, file())]);
        const result = await deletion;
        await cleanup.processJobs();
        expect(result.deleted).toBe(true);
        expect(await currentKey()).toBeUndefined();
        expect(objects.size).toBe(0);
      },
    );
  },
);
