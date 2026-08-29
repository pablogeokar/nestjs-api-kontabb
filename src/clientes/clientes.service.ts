import { BadRequestException, Injectable } from '@nestjs/common';
import { asc, eq, ilike, inArray, like, or, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { clientes } from '../database/schema';
import { resultRows } from '../common/db-result';
import { AppLogger } from '../common/logger.service';
import { StorageService } from '../storage/storage.service';
import { StorageCleanupService } from '../storage/storage-cleanup.service';
import type { PaginationParams } from '../common/types';
import { AuthService } from '../auth/auth.service';
import type {
  FonteConsultaCnpj,
  RegimeTributario,
  TipoContribuinteIcms,
} from './clientes.types';

export interface StoredAddress {
  postalCode: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
}

export interface StoredCnae {
  code: string;
  description: string;
}

interface ExistingClientFiscalConfig {
  tipoPessoa: string;
  regimeTributario: string | null;
  tipoContribuinteIcms: string | null;
  optanteSimplesNacional?: boolean | null;
}

interface ClientFiscalUpdateInput {
  regimeTributario?: RegimeTributario | null;
  apuraIcms?: boolean;
  inscricaoEstadual?: string | null;
  tipoContribuinteIcms?: TipoContribuinteIcms | null;
}

interface ClientSimplesNacionalInput {
  optanteSimplesNacional?: boolean | null;
  simplesNacionalFonte?: FonteConsultaCnpj | null;
}

@Injectable()
export class ClientesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly logger: AppLogger,
    private readonly storage: StorageService,
    private readonly storageCleanup: StorageCleanupService,
    private readonly authService: AuthService,
  ) {}

  async listClients(input: { search: string; pagination: PaginationParams }) {
    const searchDocument = input.search
      .replace(/[^0-9A-Za-z]/g, '')
      .toUpperCase();
    const where = input.search
      ? or(
          ilike(clientes.razaoSocial, `%${input.search}%`),
          ilike(clientes.cnpj, `%${searchDocument}%`),
          ilike(clientes.cpf, `%${searchDocument}%`),
        )
      : undefined;

    const [countResult, rows] = await Promise.all([
      this.database.db
        .select({ count: sql<number>`count(*)` })
        .from(clientes)
        .where(where),
      this.database.db
        .select({
          id: clientes.id,
          tipoPessoa: clientes.tipoPessoa,
          cnpj: clientes.cnpj,
          cpf: clientes.cpf,
          companyName: clientes.razaoSocial,
          emails: clientes.emails,
          cep: clientes.cep,
          logradouro: clientes.logradouro,
          numero: clientes.numero,
          complemento: clientes.complemento,
          bairro: clientes.bairro,
          municipio: clientes.municipio,
          uf: clientes.uf,
          cnaePrincipalCodigo: clientes.cnaePrincipalCodigo,
          cnaePrincipalDescricao: clientes.cnaePrincipalDescricao,
          cnaesSecundarios: clientes.cnaesSecundarios,
          regimeTributario: clientes.regimeTributario,
          apuraIcms: clientes.apuraIcms,
          inscricaoEstadual: clientes.inscricaoEstadual,
          tipoContribuinteIcms: clientes.tipoContribuinteIcms,
          optanteSimplesNacional: clientes.optanteSimplesNacional,
          simplesNacionalFonte: clientes.simplesNacionalFonte,
          simplesNacionalConsultadoEm: clientes.simplesNacionalConsultadoEm,
          logoKey: clientes.logoKey,
          isFirstLogin: clientes.primeiroLogin,
          authUserId: clientes.userId,
          createdAt: clientes.criadoEm,
          certStatus: sql<string | null>`(
            SELECT cd.status FROM certificados_digitais cd
            WHERE cd.cliente_id = clientes.id
              AND cd.status IN ('ATIVO', 'PRESTES_A_EXPIRAR', 'EXPIRADO')
            ORDER BY cd.validade_fim DESC
            LIMIT 1
          )`.as('cert_status'),
          certValidadeFim: sql<string | null>`(
            SELECT cd.validade_fim::text FROM certificados_digitais cd
            WHERE cd.cliente_id = clientes.id
              AND cd.status IN ('ATIVO', 'PRESTES_A_EXPIRAR', 'EXPIRADO')
            ORDER BY cd.validade_fim DESC
            LIMIT 1
          )`.as('cert_validade_fim'),
        })
        .from(clientes)
        .where(where)
        .orderBy(asc(clientes.razaoSocial))
        .limit(input.pagination.limit)
        .offset(input.pagination.offset),
    ]);

    const data = await Promise.all(
      rows.map(async (client) => ({
        id: client.id,
        tipo_pessoa: client.tipoPessoa,
        cnpj: client.cnpj,
        cpf: client.cpf,
        company_name: client.companyName,
        emails: client.emails ?? [],
        address: this.mapAddress(client),
        primary_activity: client.cnaePrincipalCodigo
          ? {
              code: client.cnaePrincipalCodigo,
              description: client.cnaePrincipalDescricao ?? '',
            }
          : null,
        secondary_activities: this.normalizeStoredCnaes(
          client.cnaesSecundarios,
        ),
        regime_tributario: client.regimeTributario as RegimeTributario | null,
        apura_icms: client.apuraIcms,
        inscricao_estadual: client.inscricaoEstadual,
        tipo_contribuinte_icms:
          client.tipoContribuinteIcms as TipoContribuinteIcms | null,
        optante_simples_nacional: client.optanteSimplesNacional,
        simples_nacional_fonte:
          client.simplesNacionalFonte as FonteConsultaCnpj | null,
        simples_nacional_consultado_em:
          client.simplesNacionalConsultadoEm?.toISOString() ?? null,
        logo_url: client.logoKey
          ? await this.storage.getSignedUrl(client.logoKey)
          : null,
        is_first_login: client.isFirstLogin,
        auth_user_id: client.authUserId,
        created_at: client.createdAt.toISOString(),
        certificado: client.certStatus
          ? {
              status: client.certStatus as
                'ATIVO' | 'PRESTES_A_EXPIRAR' | 'EXPIRADO',
              validade_fim: client.certValidadeFim!,
            }
          : null,
      })),
    );

    return {
      total: Number(countResult[0]?.count ?? 0),
      data,
    };
  }

  async registerClient(input: {
    requestId?: string;
    actorUserId: string;
    tipoPessoa: 'PF' | 'PJ';
    companyName: string;
    cnpj: string;
    cpf: string;
    emails: string[];
    address?: StoredAddress;
    primaryActivity?: StoredCnae | null;
    secondaryActivities?: StoredCnae[];
    optanteSimplesNacional?: boolean | null;
    simplesNacionalFonte?: FonteConsultaCnpj | null;
  }) {
    const simplesNacional = this.normalizeSimplesNacionalRegistration(
      input.tipoPessoa,
      input,
    );
    const authIdentifier = input.tipoPessoa === 'PF' ? input.cpf : input.cnpj;
    const authEmail = `${authIdentifier}@kontabb.local`;
    const hashedPassword = await this.authService.hashPassword('123456');
    const authUserId = crypto.randomUUID();

    try {
      // Create auth user + account directly (matching better-auth structure)
      const emails = this.textArray(input.emails);
      const cnpjValue = input.tipoPessoa === 'PF' ? input.cpf : input.cnpj;
      const cpfValue = input.tipoPessoa === 'PF' ? input.cpf : null;
      const secondaryActivities = JSON.stringify(
        input.secondaryActivities ?? [],
      );
      const result = await this.database.db.execute(sql`
        WITH inserted_user AS (
          INSERT INTO "user" (id, name, email, email_verified, role, created_at, updated_at)
          VALUES (${authUserId}, ${input.companyName}, ${authEmail}, false, 'CLIENTE', now(), now())
          RETURNING id
        ),
        inserted_account AS (
          INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at)
          SELECT
            gen_random_uuid()::text,
            id,
            'credential',
            id,
            ${hashedPassword},
            now(),
            now()
          FROM inserted_user
          RETURNING user_id
        ),
        inserted_client AS (
          INSERT INTO clientes (
            tipo_pessoa, razao_social, cnpj, cpf, emails,
            cep, logradouro, numero, complemento, bairro, municipio, uf,
            cnae_principal_codigo, cnae_principal_descricao, cnaes_secundarios,
            regime_tributario, apura_icms, optante_simples_nacional,
            simples_nacional_fonte, simples_nacional_consultado_em,
            primeiro_login, user_id
          )
          SELECT
            ${input.tipoPessoa}, ${input.companyName}, ${cnpjValue}, ${cpfValue}, ${emails},
            ${this.nullableText(input.address?.postalCode)},
            ${this.nullableText(input.address?.street)},
            ${this.nullableText(input.address?.number)},
            ${this.nullableText(input.address?.complement)},
            ${this.nullableText(input.address?.district)},
            ${this.nullableText(input.address?.city)},
            ${this.nullableText(input.address?.state)},
            ${this.nullableText(input.primaryActivity?.code)},
            ${this.nullableText(input.primaryActivity?.description)},
            ${secondaryActivities}::jsonb,
            ${simplesNacional.regimeTributario}::text,
            ${simplesNacional.apuraIcms}::boolean,
            ${simplesNacional.optanteSimplesNacional}::boolean,
            ${simplesNacional.simplesNacionalFonte}::text,
            CASE WHEN ${simplesNacional.optanteSimplesNacional}::boolean IS NULL THEN NULL ELSE now() END,
            true, id
          FROM inserted_user
          RETURNING id
        ),
        audit_event AS (
          INSERT INTO eventos_auditoria (ator_user_id, acao, entidade_tipo, entidade_id, dados)
          SELECT ${input.actorUserId}, 'CLIENTE_CRIADO', 'CLIENTE', id::text,
            jsonb_build_object(
              'tipoPessoa', ${input.tipoPessoa}::text,
              'optanteSimplesNacional', ${simplesNacional.optanteSimplesNacional}::boolean,
              'simplesNacionalFonte', ${simplesNacional.simplesNacionalFonte}::text
            )
          FROM inserted_client
          RETURNING id
        )
        SELECT id::text AS client_id FROM inserted_client
      `);

      const clientId = resultRows<{ client_id: string }>(result)[0]?.client_id;
      if (!clientId) throw new Error('CLIENT_INSERT_FAILED');
      return { ok: true as const, clientId };
    } catch (error: any) {
      this.logger.error('client_creation_failed', error, {
        requestId: input.requestId,
        userId: input.actorUserId,
        operation: 'client_creation',
      });
      if (this.isUniqueViolation(error)) {
        return { ok: false as const, code: 'DUPLICATE' };
      }
      return { ok: false as const, code: 'DATABASE_FAILED' };
    }
  }

  async updateClient(input: {
    clientId: string;
    actorUserId: string;
    companyName?: string;
    emails?: string[];
    address?: StoredAddress;
    primaryActivity?: StoredCnae | null;
    secondaryActivities?: StoredCnae[];
    regimeTributario?: RegimeTributario | null;
    apuraIcms?: boolean;
    inscricaoEstadual?: string | null;
    tipoContribuinteIcms?: TipoContribuinteIcms | null;
    optanteSimplesNacional?: boolean | null;
    simplesNacionalFonte?: FonteConsultaCnpj | null;
  }) {
    const existingRows = await this.database.db
      .select({
        tipoPessoa: clientes.tipoPessoa,
        regimeTributario: clientes.regimeTributario,
        tipoContribuinteIcms: clientes.tipoContribuinteIcms,
        optanteSimplesNacional: clientes.optanteSimplesNacional,
      })
      .from(clientes)
      .where(eq(clientes.id, input.clientId))
      .limit(1);
    const existing = existingRows[0];
    if (!existing) return false;

    const simplesNacionalUpdate = this.normalizeSimplesNacionalUpdate(
      existing,
      input,
    );
    const fiscalUpdate = this.normalizeFiscalUpdate(
      existing,
      simplesNacionalUpdate.fiscalInput,
    );
    const emails = input.emails
      ? this.textArray(input.emails)
      : sql`NULL::text[]`;
    const hasAddress = input.address !== undefined;
    const hasPrimaryActivity = input.primaryActivity !== undefined;
    const hasSecondaryActivities = input.secondaryActivities !== undefined;
    const secondaryActivities = JSON.stringify(input.secondaryActivities ?? []);
    const result = await this.database.db.execute(sql`
      WITH updated_client AS (
        UPDATE clientes
        SET
          razao_social = COALESCE(${input.companyName ?? null}::text, razao_social),
          emails = COALESCE(${emails}, emails),
          cep = CASE WHEN ${hasAddress} THEN ${this.nullableText(input.address?.postalCode)} ELSE cep END,
          logradouro = CASE WHEN ${hasAddress} THEN ${this.nullableText(input.address?.street)} ELSE logradouro END,
          numero = CASE WHEN ${hasAddress} THEN ${this.nullableText(input.address?.number)} ELSE numero END,
          complemento = CASE WHEN ${hasAddress} THEN ${this.nullableText(input.address?.complement)} ELSE complemento END,
          bairro = CASE WHEN ${hasAddress} THEN ${this.nullableText(input.address?.district)} ELSE bairro END,
          municipio = CASE WHEN ${hasAddress} THEN ${this.nullableText(input.address?.city)} ELSE municipio END,
          uf = CASE WHEN ${hasAddress} THEN ${this.nullableText(input.address?.state)} ELSE uf END,
          cnae_principal_codigo = CASE WHEN ${hasPrimaryActivity} THEN ${this.nullableText(input.primaryActivity?.code)} ELSE cnae_principal_codigo END,
          cnae_principal_descricao = CASE WHEN ${hasPrimaryActivity} THEN ${this.nullableText(input.primaryActivity?.description)} ELSE cnae_principal_descricao END,
          cnaes_secundarios = CASE WHEN ${hasSecondaryActivities} THEN ${secondaryActivities}::jsonb ELSE cnaes_secundarios END,
          regime_tributario = CASE WHEN ${fiscalUpdate.writeRegimeTributario} THEN ${fiscalUpdate.regimeTributario}::text ELSE regime_tributario END,
          apura_icms = CASE WHEN ${fiscalUpdate.writeApuraIcms} THEN ${fiscalUpdate.apuraIcms}::boolean ELSE apura_icms END,
          inscricao_estadual = CASE WHEN ${fiscalUpdate.writeInscricaoEstadual} THEN ${fiscalUpdate.inscricaoEstadual}::text ELSE inscricao_estadual END,
          tipo_contribuinte_icms = CASE WHEN ${fiscalUpdate.writeTipoContribuinteIcms} THEN ${fiscalUpdate.tipoContribuinteIcms}::text ELSE tipo_contribuinte_icms END,
          optante_simples_nacional = CASE WHEN ${simplesNacionalUpdate.writeConsultation} THEN ${simplesNacionalUpdate.optanteSimplesNacional}::boolean ELSE optante_simples_nacional END,
          simples_nacional_fonte = CASE WHEN ${simplesNacionalUpdate.writeConsultation} THEN ${simplesNacionalUpdate.simplesNacionalFonte}::text ELSE simples_nacional_fonte END,
          simples_nacional_consultado_em = CASE
            WHEN ${simplesNacionalUpdate.writeConsultation} AND ${simplesNacionalUpdate.optanteSimplesNacional}::boolean IS NULL THEN NULL
            WHEN ${simplesNacionalUpdate.writeConsultation} THEN now()
            ELSE simples_nacional_consultado_em
          END
        WHERE id = ${input.clientId}::uuid
        RETURNING id
      ),
      audit_event AS (
        INSERT INTO eventos_auditoria (ator_user_id, acao, entidade_tipo, entidade_id, dados)
        SELECT ${input.actorUserId}, 'CLIENTE_ATUALIZADO', 'CLIENTE', id::text,
          CASE WHEN ${simplesNacionalUpdate.writeConsultation} THEN jsonb_build_object(
            'consultaSimplesAtualizada', true,
            'optanteSimplesNacional', ${simplesNacionalUpdate.optanteSimplesNacional}::boolean,
            'simplesNacionalFonte', ${simplesNacionalUpdate.simplesNacionalFonte}::text
          ) ELSE '{}'::jsonb END
        FROM updated_client
        RETURNING id
      )
      SELECT EXISTS (SELECT 1 FROM updated_client) AS updated
    `);
    return Boolean(resultRows<{ updated: boolean }>(result)[0]?.updated);
  }

  async deleteClient(input: {
    requestId?: string;
    clientId: string;
    actorUserId: string;
  }) {
    const result = await this.database.db.execute(sql`
      WITH target_client AS MATERIALIZED (
        SELECT id, user_id, razao_social FROM clientes WHERE id = ${input.clientId}::uuid FOR UPDATE
      ),
      target_files AS MATERIALIZED (
        SELECT d.id, d.arquivo_key, d.comprovante_key
        FROM guias d INNER JOIN target_client c ON c.id = d.cliente_id
      ),
      deleted_client AS (
        DELETE FROM clientes c USING target_client target WHERE c.id = target.id
        RETURNING c.id, c.user_id, c.razao_social
      ),
      deleted_user AS (
        DELETE FROM "user" u USING deleted_client client WHERE u.id = client.user_id RETURNING u.id
      ),
      candidate_keys AS (
        SELECT id, arquivo_key AS object_key FROM target_files
        UNION ALL
        SELECT id, comprovante_key FROM target_files WHERE comprovante_key IS NOT NULL
      ),
      cleanup_jobs AS (
        INSERT INTO storage_cleanup_jobs (object_key, entidade_tipo, entidade_id)
        SELECT keys.object_key, 'DOCUMENTO', keys.id::text FROM candidate_keys keys
        WHERE EXISTS (SELECT 1 FROM deleted_client)
        ON CONFLICT (object_key) DO NOTHING
        RETURNING id
      ),
      audit_event AS (
        INSERT INTO eventos_auditoria (ator_user_id, acao, entidade_tipo, entidade_id, dados)
        SELECT ${input.actorUserId}, 'CLIENTE_EXCLUIDO', 'CLIENTE', id::text,
          jsonb_build_object('razaoSocial', razao_social, 'authUserRemovido', user_id IS NOT NULL, 'motivo', 'EXCLUSAO_ADMINISTRATIVA')
        FROM deleted_client
        RETURNING id
      )
      SELECT
        EXISTS (SELECT 1 FROM deleted_client) AS deleted,
        COALESCE((SELECT array_agg(id::text) FROM cleanup_jobs), ARRAY[]::text[]) AS job_ids
    `);

    const row = resultRows<{ deleted: boolean; job_ids: string[] | null }>(
      result,
    )[0];
    if (!row?.deleted) return { deleted: false, cleanupPending: 0 };

    const cleanup = await this.storageCleanup.processJobs(row.job_ids ?? [], {
      requestId: input.requestId,
      userId: input.actorUserId,
      trigger: 'deletion',
    });
    return { deleted: true, cleanupPending: cleanup.failed };
  }

  async getClientForUser(userId: string) {
    const result = await this.database.db
      .select({
        id: clientes.id,
        companyName: clientes.razaoSocial,
        cnpj: clientes.cnpj,
        uf: clientes.uf,
        primeiroLogin: clientes.primeiroLogin,
        regimeTributario: clientes.regimeTributario,
        apuraIcms: clientes.apuraIcms,
        inscricaoEstadual: clientes.inscricaoEstadual,
        tipoContribuinteIcms: clientes.tipoContribuinteIcms,
        optanteSimplesNacional: clientes.optanteSimplesNacional,
        simplesNacionalFonte: clientes.simplesNacionalFonte,
        simplesNacionalConsultadoEm: clientes.simplesNacionalConsultadoEm,
      })
      .from(clientes)
      .where(eq(clientes.userId, userId))
      .limit(1);
    return result[0];
  }

  /**
   * Returns the first real email from the clientes.emails array for a given user.
   * Used by the password-reset flow to resolve a deliverable address
   * when the auth email is a non-routable @kontabb.local placeholder.
   */
  async getClientEmailByUserId(userId: string): Promise<string | null> {
    const result = await this.database.db
      .select({ emails: clientes.emails })
      .from(clientes)
      .where(eq(clientes.userId, userId))
      .limit(1);

    const emails = result[0]?.emails;
    return emails && emails.length > 0 ? emails[0] : null;
  }

  /**
   * Returns the primeiroLogin flag for a client user.
   * Used by auth endpoints to inform the frontend about first-login state.
   */
  async isFirstLogin(userId: string): Promise<boolean> {
    const result = await this.database.db
      .select({ primeiroLogin: clientes.primeiroLogin })
      .from(clientes)
      .where(eq(clientes.userId, userId))
      .limit(1);
    return result[0]?.primeiroLogin ?? false;
  }

  async getClientSummary(clientId: string) {
    const result = await this.database.db
      .select({
        id: clientes.id,
        tipoPessoa: clientes.tipoPessoa,
        cnpj: clientes.cnpj,
        cpf: clientes.cpf,
        razaoSocial: clientes.razaoSocial,
        cep: clientes.cep,
        logradouro: clientes.logradouro,
        numero: clientes.numero,
        complemento: clientes.complemento,
        bairro: clientes.bairro,
        municipio: clientes.municipio,
        uf: clientes.uf,
        cnaePrincipalCodigo: clientes.cnaePrincipalCodigo,
        cnaePrincipalDescricao: clientes.cnaePrincipalDescricao,
        cnaesSecundarios: clientes.cnaesSecundarios,
        regimeTributario: clientes.regimeTributario,
        apuraIcms: clientes.apuraIcms,
        inscricaoEstadual: clientes.inscricaoEstadual,
        tipoContribuinteIcms: clientes.tipoContribuinteIcms,
        optanteSimplesNacional: clientes.optanteSimplesNacional,
        simplesNacionalFonte: clientes.simplesNacionalFonte,
        simplesNacionalConsultadoEm: clientes.simplesNacionalConsultadoEm,
        logoKey: clientes.logoKey,
      })
      .from(clientes)
      .where(eq(clientes.id, clientId))
      .limit(1);
    const client = result[0];
    if (!client) return undefined;
    return {
      id: client.id,
      tipo_pessoa: client.tipoPessoa,
      cnpj: client.cnpj,
      cpf: client.cpf,
      company_name: client.razaoSocial,
      address: this.mapAddress(client),
      primary_activity: client.cnaePrincipalCodigo
        ? {
            code: client.cnaePrincipalCodigo,
            description: client.cnaePrincipalDescricao ?? '',
          }
        : null,
      secondary_activities: this.normalizeStoredCnaes(client.cnaesSecundarios),
      regime_tributario: client.regimeTributario as RegimeTributario | null,
      apura_icms: client.apuraIcms,
      inscricao_estadual: client.inscricaoEstadual,
      tipo_contribuinte_icms:
        client.tipoContribuinteIcms as TipoContribuinteIcms | null,
      optante_simples_nacional: client.optanteSimplesNacional,
      simples_nacional_fonte:
        client.simplesNacionalFonte as FonteConsultaCnpj | null,
      simples_nacional_consultado_em:
        client.simplesNacionalConsultadoEm?.toISOString() ?? null,
      logo_url: client.logoKey
        ? await this.storage.getSignedUrl(client.logoKey)
        : null,
    };
  }

  async findClientForUpload(identifier: string) {
    if (
      identifier.length !== 14 &&
      identifier.length !== 11 &&
      identifier.length !== 8
    ) {
      return undefined;
    }
    const where =
      identifier.length === 11
        ? eq(clientes.cpf, identifier)
        : identifier.length === 14
          ? eq(clientes.cnpj, identifier)
          : like(clientes.cnpj, `${identifier}%`);
    const result = await this.database.db
      .select({
        id: clientes.id,
        cnpj: clientes.cnpj,
        razaoSocial: clientes.razaoSocial,
        emails: clientes.emails,
        regimeTributario: clientes.regimeTributario,
        apuraIcms: clientes.apuraIcms,
      })
      .from(clientes)
      .where(where)
      .limit(1);
    return result[0];
  }

  async findRegisteredCnpjs(cnpjs: string[]) {
    const fullCnpjs = cnpjs.filter((c) => c.length === 14);
    const rootCnpjs = cnpjs.filter((c) => c.length === 8);
    const fullRows = (
      fullCnpjs.length
        ? await this.database.db
            .select({ cnpj: clientes.cnpj })
            .from(clientes)
            .where(inArray(clientes.cnpj, fullCnpjs))
        : []
    ) as Array<{ cnpj: string }>;
    const rootRows = await Promise.all(
      rootCnpjs.map(async (root) => {
        const result = await this.database.db
          .select({ cnpj: clientes.cnpj })
          .from(clientes)
          .where(like(clientes.cnpj, `${root}%`))
          .limit(1);
        return result[0] ? root : null;
      }),
    );
    return new Set([
      ...fullRows.map((r) => r.cnpj),
      ...rootRows.filter((r): r is string => Boolean(r)),
    ]);
  }

  async uploadLogo(input: {
    clientId: string;
    actorUserId: string;
    bytes: Buffer;
    mimeType: string;
    extension: string;
  }): Promise<{ ok: true; logoUrl: string } | { ok: false; code: string }> {
    // Check client exists and get current logo_key
    const existing = await this.database.db
      .select({
        id: clientes.id,
        logoKey: clientes.logoKey,
        cnpj: clientes.cnpj,
        cpf: clientes.cpf,
        tipoPessoa: clientes.tipoPessoa,
      })
      .from(clientes)
      .where(eq(clientes.id, input.clientId))
      .limit(1);
    if (!existing[0]) return { ok: false, code: 'NOT_FOUND' };

    const oldLogoKey = existing[0].logoKey;
    const cnpjCpf =
      existing[0].tipoPessoa === 'PF' && existing[0].cpf
        ? existing[0].cpf
        : existing[0].cnpj;
    const newKey = this.storage.logoObjectKey({
      cnpjCpf,
      extension: input.extension,
    });

    try {
      await this.storage.upload(newKey, input.bytes, input.mimeType);

      await this.database.db
        .update(clientes)
        .set({ logoKey: newKey })
        .where(eq(clientes.id, input.clientId));

      // Clean up old logo if key changed (e.g., different extension)
      if (oldLogoKey && oldLogoKey !== newKey) {
        try {
          await this.storage.delete(oldLogoKey);
        } catch {
          // non-critical, old file will be orphaned
        }
      }

      const logoUrl = await this.storage.getSignedUrl(newKey);
      return { ok: true, logoUrl };
    } catch (error) {
      this.logger.error('logo_upload_failed', error, {
        userId: input.actorUserId,
        entityType: 'CLIENTE',
        entityId: input.clientId,
        operation: 'logo_upload',
      });
      return { ok: false, code: 'STORAGE_FAILED' };
    }
  }

  async deleteLogo(input: {
    clientId: string;
    actorUserId: string;
  }): Promise<{ ok: true } | { ok: false; code: string }> {
    const existing = await this.database.db
      .select({ id: clientes.id, logoKey: clientes.logoKey })
      .from(clientes)
      .where(eq(clientes.id, input.clientId))
      .limit(1);
    if (!existing[0]) return { ok: false, code: 'NOT_FOUND' };
    if (!existing[0].logoKey) return { ok: true }; // no logo to delete

    const logoKey = existing[0].logoKey;

    await this.database.db
      .update(clientes)
      .set({ logoKey: null })
      .where(eq(clientes.id, input.clientId));

    try {
      await this.storage.delete(logoKey);
    } catch {
      // non-critical
    }

    return { ok: true };
  }

  async getLogoUrl(clientId: string): Promise<string | null> {
    const result = await this.database.db
      .select({ logoKey: clientes.logoKey })
      .from(clientes)
      .where(eq(clientes.id, clientId))
      .limit(1);
    const logoKey = result[0]?.logoKey;
    if (!logoKey) return null;
    return this.storage.getSignedUrl(logoKey);
  }

  private normalizeSimplesNacionalRegistration(
    tipoPessoa: 'PF' | 'PJ',
    input: ClientSimplesNacionalInput,
  ) {
    const optanteSimplesNacional = input.optanteSimplesNacional ?? null;
    const simplesNacionalFonte = input.simplesNacionalFonte ?? null;

    if (tipoPessoa === 'PF' && optanteSimplesNacional !== null) {
      throw new BadRequestException(
        'Pessoa Física não possui opção pelo Simples Nacional.',
      );
    }
    if (optanteSimplesNacional === null && simplesNacionalFonte !== null) {
      throw new BadRequestException(
        'A fonte só pode ser informada com um resultado da consulta do Simples Nacional.',
      );
    }
    if (optanteSimplesNacional !== null && simplesNacionalFonte === null) {
      throw new BadRequestException(
        'A fonte da consulta do Simples Nacional é obrigatória.',
      );
    }

    return {
      regimeTributario: optanteSimplesNacional
        ? ('SIMPLES_NACIONAL' as const)
        : null,
      apuraIcms: false,
      optanteSimplesNacional,
      simplesNacionalFonte,
    };
  }

  private normalizeSimplesNacionalUpdate(
    existing: ExistingClientFiscalConfig,
    input: ClientFiscalUpdateInput & ClientSimplesNacionalInput,
  ) {
    const writeConsultation = input.optanteSimplesNacional !== undefined;

    if (!writeConsultation && input.simplesNacionalFonte !== undefined) {
      throw new BadRequestException(
        'O resultado da consulta do Simples Nacional deve acompanhar a fonte.',
      );
    }
    if (!writeConsultation) {
      if (
        input.regimeTributario !== undefined &&
        existing.optanteSimplesNacional === true &&
        input.regimeTributario !== 'SIMPLES_NACIONAL'
      ) {
        throw new BadRequestException(
          'Consulte novamente o Simples Nacional antes de alterar este regime.',
        );
      }
      if (
        input.regimeTributario === 'SIMPLES_NACIONAL' &&
        existing.optanteSimplesNacional === false
      ) {
        throw new BadRequestException(
          'Consulte novamente o Simples Nacional antes de selecionar este regime.',
        );
      }
      return {
        writeConsultation: false,
        optanteSimplesNacional: null,
        simplesNacionalFonte: null,
        fiscalInput: input,
      };
    }

    const optanteSimplesNacional = input.optanteSimplesNacional ?? null;
    const simplesNacionalFonte = input.simplesNacionalFonte ?? null;
    if (existing.tipoPessoa === 'PF' && optanteSimplesNacional !== null) {
      throw new BadRequestException(
        'Pessoa Física não possui opção pelo Simples Nacional.',
      );
    }
    if (optanteSimplesNacional === null && simplesNacionalFonte !== null) {
      throw new BadRequestException(
        'A fonte só pode ser informada com um resultado da consulta do Simples Nacional.',
      );
    }
    if (optanteSimplesNacional !== null && simplesNacionalFonte === null) {
      throw new BadRequestException(
        'A fonte da consulta do Simples Nacional é obrigatória.',
      );
    }

    const fiscalInput: ClientFiscalUpdateInput = { ...input };
    if (optanteSimplesNacional === true) {
      fiscalInput.regimeTributario = 'SIMPLES_NACIONAL';
      fiscalInput.apuraIcms = false;
    } else if (optanteSimplesNacional === false) {
      const effectiveRegime =
        input.regimeTributario === undefined
          ? existing.regimeTributario
          : input.regimeTributario;
      if (effectiveRegime === 'SIMPLES_NACIONAL') {
        fiscalInput.regimeTributario = null;
        fiscalInput.apuraIcms = false;
      }
    }

    return {
      writeConsultation: true,
      optanteSimplesNacional,
      simplesNacionalFonte,
      fiscalInput,
    };
  }

  private normalizeFiscalUpdate(
    existing: ExistingClientFiscalConfig,
    input: ClientFiscalUpdateInput,
  ) {
    const writeRegimeTributario = input.regimeTributario !== undefined;
    const writeTipoContribuinteIcms = input.tipoContribuinteIcms !== undefined;
    const hasInscricaoEstadual = input.inscricaoEstadual !== undefined;
    const inscricaoEstadual =
      input.inscricaoEstadual?.trim().toUpperCase() || null;

    if (existing.tipoPessoa === 'PF') {
      if (input.regimeTributario != null) {
        throw new BadRequestException(
          'Pessoa Física não possui regime tributário.',
        );
      }
      if (
        input.apuraIcms === true ||
        input.tipoContribuinteIcms != null ||
        inscricaoEstadual
      ) {
        throw new BadRequestException(
          'Pessoa Física não possui configuração de regime tributário ou ICMS.',
        );
      }
      return {
        writeRegimeTributario,
        regimeTributario: null,
        writeApuraIcms: input.apuraIcms !== undefined,
        apuraIcms: false,
        writeInscricaoEstadual: hasInscricaoEstadual,
        inscricaoEstadual: null,
        writeTipoContribuinteIcms,
        tipoContribuinteIcms: null,
      };
    }

    const regimeTributario = (
      writeRegimeTributario ? input.regimeTributario : existing.regimeTributario
    ) as RegimeTributario | null;
    const lucroNormal =
      regimeTributario === 'LUCRO_PRESUMIDO' ||
      regimeTributario === 'LUCRO_REAL';
    const writeApuraIcms =
      input.apuraIcms !== undefined || writeRegimeTributario;
    const apuraIcms = lucroNormal
      ? true
      : regimeTributario === 'SIMPLES_NACIONAL'
        ? (input.apuraIcms ?? false)
        : false;

    const tipoContribuinteIcms = (
      writeTipoContribuinteIcms
        ? input.tipoContribuinteIcms
        : existing.tipoContribuinteIcms
    ) as TipoContribuinteIcms | null;
    const contribuinte = tipoContribuinteIcms === 'CONTRIBUINTE';

    return {
      writeRegimeTributario,
      regimeTributario: input.regimeTributario ?? null,
      writeApuraIcms,
      apuraIcms,
      writeInscricaoEstadual:
        hasInscricaoEstadual || (writeTipoContribuinteIcms && !contribuinte),
      inscricaoEstadual: contribuinte ? inscricaoEstadual : null,
      writeTipoContribuinteIcms,
      tipoContribuinteIcms: input.tipoContribuinteIcms ?? null,
    };
  }

  private textArray(values: string[]) {
    if (!values.length) return sql`ARRAY[]::text[]`;
    return sql`ARRAY[${sql.join(
      values.map((v) => sql`${v}`),
      sql`, `,
    )}]::text[]`;
  }

  private nullableText(value: string | undefined) {
    const normalized = value?.trim();
    return normalized ? normalized : null;
  }

  private mapAddress(client: {
    cep: string | null;
    logradouro: string | null;
    numero: string | null;
    complemento: string | null;
    bairro: string | null;
    municipio: string | null;
    uf: string | null;
  }) {
    const hasAddress = [
      client.cep,
      client.logradouro,
      client.numero,
      client.complemento,
      client.bairro,
      client.municipio,
      client.uf,
    ].some(Boolean);
    if (!hasAddress) return null;
    return {
      postal_code: client.cep ?? '',
      street: client.logradouro ?? '',
      number: client.numero ?? '',
      complement: client.complemento ?? '',
      district: client.bairro ?? '',
      city: client.municipio ?? '',
      state: client.uf ?? '',
    };
  }

  private normalizeStoredCnaes(value: unknown): StoredCnae[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const candidate = item as { code?: unknown; description?: unknown };
      if (
        typeof candidate.code !== 'string' ||
        !/^\d{7}$/.test(candidate.code)
      ) {
        return [];
      }
      return [
        {
          code: candidate.code,
          description:
            typeof candidate.description === 'string'
              ? candidate.description
              : '',
        },
      ];
    });
  }

  private isUniqueViolation(error: unknown) {
    const candidate = error as {
      code?: string;
      cause?: { code?: string };
    } | null;
    return candidate?.code === '23505' || candidate?.cause?.code === '23505';
  }
}
