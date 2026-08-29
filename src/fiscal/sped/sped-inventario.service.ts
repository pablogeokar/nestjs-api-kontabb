import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service';
import {
  clientes,
  spedInventarioItens,
  spedInventarios,
  spedItens,
  spedParticipantes,
  spedUnidades,
} from '../../database/schema';
import type {
  AtualizarInventarioSpedDto,
  SpedInventarioItemDto,
} from './dto/sped-inventario.dto';
import { fromScaledInteger, toScaledInteger } from './sped-decimal';

type DatabaseExecutor =
  | DatabaseService['db']
  | Parameters<Parameters<DatabaseService['db']['transaction']>[0]>[0];

interface CatalogItemInput {
  source: SpedInventarioItemDto;
  unidadeCodigo: string;
  unidadeDescricao: string;
}

interface PersistedCatalogItem {
  id: string;
  codigo: string;
}

const BATCH_SIZE = 500;

@Injectable()
export class SpedInventarioService {
  constructor(private readonly database: DatabaseService) {}

  async obter(clienteId: string, dataInventario: string) {
    assertValidInventoryDate(dataInventario);
    await this.assertCliente(clienteId);

    const inventories = await this.database.db
      .select({
        id: spedInventarios.id,
        dataInventario: spedInventarios.dataInventario,
        motivo: spedInventarios.motivo,
        valorTotal: spedInventarios.valorTotal,
        status: spedInventarios.status,
        criadoEm: spedInventarios.criadoEm,
        atualizadoEm: spedInventarios.atualizadoEm,
      })
      .from(spedInventarios)
      .where(
        and(
          eq(spedInventarios.clienteId, clienteId),
          eq(spedInventarios.dataInventario, dataInventario),
        ),
      )
      .orderBy(asc(spedInventarios.motivo), asc(spedInventarios.id));

    if (inventories.length === 0) {
      return { dataInventario, inventarios: [] };
    }

    const itemRows = await this.database.db
      .select({
        id: spedInventarioItens.id,
        inventarioId: spedInventarioItens.inventarioId,
        codigoItem: spedItens.codigo,
        codigoExterno: spedItens.codigoExterno,
        descricao: spedItens.descricao,
        tipoItem: spedItens.tipoItem,
        ncm: spedItens.ncm,
        cest: spedItens.cest,
        unidadeCodigo: spedUnidades.codigo,
        unidadeDescricao: spedUnidades.descricao,
        quantidade: spedInventarioItens.quantidade,
        valorUnitario: spedInventarioItens.valorUnitario,
        valorItem: spedInventarioItens.valorItem,
        indicadorPropriedade: spedInventarioItens.indicadorPropriedade,
        participanteCodigo: spedParticipantes.codigo,
        participanteDocumento: spedParticipantes.documento,
        participanteNome: spedParticipantes.nome,
        textoComplementar: spedInventarioItens.textoComplementar,
        codigoConta: spedInventarioItens.codigoConta,
        valorItemIr: spedInventarioItens.valorItemIr,
      })
      .from(spedInventarioItens)
      .innerJoin(spedItens, eq(spedItens.id, spedInventarioItens.spedItemId))
      .innerJoin(spedUnidades, eq(spedUnidades.id, spedItens.unidadeId))
      .leftJoin(
        spedParticipantes,
        eq(spedParticipantes.id, spedInventarioItens.participanteId),
      )
      .where(
        inArray(
          spedInventarioItens.inventarioId,
          inventories.map((inventory) => inventory.id),
        ),
      )
      .orderBy(
        asc(spedInventarioItens.inventarioId),
        asc(spedItens.codigo),
        asc(spedInventarioItens.indicadorPropriedade),
      );

    const itemsByInventory = new Map<
      string,
      Array<(typeof itemRows)[number]>
    >();
    for (const row of itemRows) {
      const items = itemsByInventory.get(row.inventarioId) ?? [];
      items.push(row);
      itemsByInventory.set(row.inventarioId, items);
    }

    return {
      dataInventario,
      inventarios: inventories.map((inventory) => ({
        ...inventory,
        itens: (itemsByInventory.get(inventory.id) ?? []).map((item) => ({
          id: item.id,
          codigoItem: item.codigoItem,
          codigoExterno: item.codigoExterno,
          descricao: item.descricao,
          tipoItem: item.tipoItem,
          ncm: item.ncm,
          cest: item.cest,
          unidade: item.unidadeCodigo,
          descricaoUnidade: item.unidadeDescricao,
          quantidade: item.quantidade,
          valorUnitario: item.valorUnitario,
          valorItem: item.valorItem,
          indicadorPropriedade: item.indicadorPropriedade,
          participante: item.participanteDocumento
            ? {
                codigo: item.participanteCodigo,
                documento: item.participanteDocumento,
                nome: item.participanteNome,
              }
            : null,
          textoComplementar: item.textoComplementar,
          codigoConta: item.codigoConta,
          valorItemIr: item.valorItemIr,
        })),
      })),
    };
  }

  async atualizar(input: {
    clienteId: string;
    actorUserId: string;
    dataInventario: string;
    data: AtualizarInventarioSpedDto;
  }) {
    assertValidInventoryDate(input.dataInventario);
    assertInventoryPayload(input.data);
    await this.assertCliente(input.clienteId);

    const now = new Date();
    await this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`sped-inventario:${input.clienteId}`}, 0))`,
      );

      const participantIds = await this.resolveParticipants(
        tx,
        input.clienteId,
        input.data.itens,
      );
      const catalogInputs = groupCatalogInputs(input.data.itens);
      const unitIds = await this.persistUnits(
        tx,
        input.clienteId,
        catalogInputs,
        now,
      );
      const catalogItems = await this.persistCatalogItems(
        tx,
        input.clienteId,
        catalogInputs,
        unitIds,
        now,
      );

      const [inventory] = await tx
        .insert(spedInventarios)
        .values({
          clienteId: input.clienteId,
          dataInventario: input.dataInventario,
          motivo: input.data.motivo,
          valorTotal: input.data.valorTotal,
          status: input.data.status,
          atualizadoPor: input.actorUserId,
          atualizadoEm: now,
        })
        .onConflictDoUpdate({
          target: [
            spedInventarios.clienteId,
            spedInventarios.dataInventario,
            spedInventarios.motivo,
          ],
          set: {
            valorTotal: input.data.valorTotal,
            status: input.data.status,
            atualizadoPor: input.actorUserId,
            atualizadoEm: now,
          },
        })
        .returning({ id: spedInventarios.id });

      if (!inventory) {
        throw new ConflictException('Não foi possível persistir o inventário.');
      }

      await tx
        .delete(spedInventarioItens)
        .where(eq(spedInventarioItens.inventarioId, inventory.id));

      const rows = input.data.itens.map((item) => {
        const catalogItem = catalogItems.get(item.codigoExterno);
        if (!catalogItem) {
          throw new ConflictException(
            `O item ${item.codigoExterno} não foi persistido no catálogo SPED.`,
          );
        }
        const participantDocument = normalizeParticipantDocument(
          item.participanteDocumento,
        );
        return {
          inventarioId: inventory.id,
          spedItemId: catalogItem.id,
          unidade: normalizeInventoryUnitCode(item.unidade),
          quantidade: item.quantidade,
          valorUnitario: item.valorUnitario,
          valorItem: item.valorItem,
          indicadorPropriedade: item.indicadorPropriedade,
          participanteId: participantDocument
            ? (participantIds.get(participantDocument) ?? null)
            : null,
          textoComplementar: item.textoComplementar?.trim() || null,
          codigoConta: item.codigoConta?.trim() || null,
          valorItemIr: item.valorItemIr ?? null,
          atualizadoEm: now,
        };
      });

      for (const batch of batches(rows, BATCH_SIZE)) {
        await tx.insert(spedInventarioItens).values(batch);
      }
    });

    return this.obter(input.clienteId, input.dataInventario);
  }

  private async assertCliente(clienteId: string) {
    const rows = await this.database.db
      .select({ id: clientes.id })
      .from(clientes)
      .where(eq(clientes.id, clienteId))
      .limit(1);
    if (!rows[0]) throw new NotFoundException('Empresa não encontrada.');
  }

  private async resolveParticipants(
    db: DatabaseExecutor,
    clienteId: string,
    items: SpedInventarioItemDto[],
  ) {
    const documents = Array.from(
      new Set(
        items
          .map((item) =>
            normalizeParticipantDocument(item.participanteDocumento),
          )
          .filter((document): document is string => Boolean(document)),
      ),
    );
    if (documents.length === 0) return new Map<string, string>();

    const rows = await db
      .select({
        id: spedParticipantes.id,
        documento: spedParticipantes.documento,
      })
      .from(spedParticipantes)
      .where(
        and(
          eq(spedParticipantes.clienteId, clienteId),
          inArray(spedParticipantes.documento, documents),
        ),
      );
    const result = new Map(rows.map((row) => [row.documento, row.id]));
    const missing = documents.filter((document) => !result.has(document));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Cadastre primeiro no SPED ${missing.length === 1 ? 'o participante' : 'os participantes'} ${missing.join(', ')}.`,
      );
    }
    return result;
  }

  private async persistUnits(
    db: DatabaseExecutor,
    clienteId: string,
    items: Map<string, CatalogItemInput>,
    now: Date,
  ) {
    const units = new Map<string, string>();
    for (const item of items.values()) {
      const existingDescription = units.get(item.unidadeCodigo);
      if (
        existingDescription &&
        existingDescription !== item.unidadeDescricao
      ) {
        throw new BadRequestException(
          `A unidade ${item.unidadeCodigo} foi informada com descrições diferentes.`,
        );
      }
      units.set(item.unidadeCodigo, item.unidadeDescricao);
    }

    const result = new Map<string, string>();
    for (const batch of batches(Array.from(units.entries()), BATCH_SIZE)) {
      const persisted = await db
        .insert(spedUnidades)
        .values(
          batch.map(([codigo, descricao]) => ({
            clienteId,
            codigo,
            descricao,
            atualizadoEm: now,
          })),
        )
        .onConflictDoUpdate({
          target: [spedUnidades.clienteId, spedUnidades.codigo],
          set: {
            descricao: sql`excluded.descricao`,
            atualizadoEm: now,
          },
        })
        .returning({ id: spedUnidades.id, codigo: spedUnidades.codigo });
      for (const row of persisted) result.set(row.codigo, row.id);
    }
    return result;
  }

  private async persistCatalogItems(
    db: DatabaseExecutor,
    clienteId: string,
    items: Map<string, CatalogItemInput>,
    unitIds: Map<string, string>,
    now: Date,
  ) {
    const values = Array.from(items.entries()).map(([codigoExterno, item]) => {
      const unidadeId = unitIds.get(item.unidadeCodigo);
      if (!unidadeId) {
        throw new ConflictException(
          `A unidade ${item.unidadeCodigo} não foi persistida.`,
        );
      }
      return {
        clienteId,
        participanteOrigemId: null,
        codigo: stableInventoryItemCode(codigoExterno),
        codigoExterno,
        descricao: item.source.descricao.trim(),
        unidadeId,
        tipoItem: item.source.tipoItem,
        tipoItemInferido: false,
        ncm: item.source.ncm ?? null,
        codigoGenero: item.source.ncm?.slice(0, 2) ?? null,
        cest: item.source.cest ?? null,
        ativo: true,
        atualizadoEm: now,
      };
    });

    const result = new Map<string, PersistedCatalogItem>();
    for (const batch of batches(values, BATCH_SIZE)) {
      const externalCodes = batch.map((row) => row.codigoExterno);
      const existingByExternal = await db
        .select({
          codigo: spedItens.codigo,
          codigoExterno: spedItens.codigoExterno,
        })
        .from(spedItens)
        .where(
          and(
            eq(spedItens.clienteId, clienteId),
            isNull(spedItens.participanteOrigemId),
            inArray(spedItens.codigoExterno, externalCodes),
          ),
        );
      const knownExternalCodes = new Set(
        existingByExternal.map((row) => row.codigoExterno),
      );
      const newRows = batch.filter(
        (row) => !knownExternalCodes.has(row.codigoExterno),
      );
      if (newRows.length > 0) {
        const codeRows = await db
          .select({
            codigo: spedItens.codigo,
            codigoExterno: spedItens.codigoExterno,
          })
          .from(spedItens)
          .where(
            and(
              eq(spedItens.clienteId, clienteId),
              inArray(
                spedItens.codigo,
                newRows.map((row) => row.codigo),
              ),
            ),
          );
        if (codeRows.length > 0) {
          throw new ConflictException(
            'Foi detectada uma colisão de código no catálogo SPED; revise os códigos externos informados.',
          );
        }
      }

      const persisted = await db
        .insert(spedItens)
        .values(batch)
        .onConflictDoUpdate({
          target: [
            spedItens.clienteId,
            spedItens.participanteOrigemId,
            spedItens.codigoExterno,
          ],
          set: {
            descricao: sql`excluded.descricao`,
            unidadeId: sql`excluded.unidade_id`,
            tipoItem: sql`excluded.tipo_item`,
            tipoItemInferido: false,
            ncm: sql`excluded.ncm`,
            codigoGenero: sql`excluded.codigo_genero`,
            cest: sql`excluded.cest`,
            ativo: true,
            atualizadoEm: now,
          },
        })
        .returning({
          id: spedItens.id,
          codigo: spedItens.codigo,
          codigoExterno: spedItens.codigoExterno,
        });
      for (const row of persisted) {
        result.set(row.codigoExterno, { id: row.id, codigo: row.codigo });
      }
    }
    return result;
  }
}

export function assertInventoryPayload(data: AtualizarInventarioSpedDto) {
  if (data.status === 'FECHADO' && data.itens.length === 0) {
    throw new BadRequestException(
      'Um inventário fechado precisa possuir ao menos um item.',
    );
  }

  const uniqueInventoryItems = new Set<string>();
  const catalogDefinitions = new Map<string, string>();
  const unitDescriptions = new Map<string, string>();
  let itemsTotal = 0n;

  for (const item of data.itens) {
    const externalCode = item.codigoExterno.trim();
    const unitCode = normalizeInventoryUnitCode(item.unidade);
    const unitDescription = item.descricaoUnidade?.trim() || unitCode;
    if (!unitCode) {
      throw new BadRequestException(
        `A unidade do item ${externalCode} não possui um código SPED válido.`,
      );
    }

    const duplicateKey = `${externalCode}\u0000${item.indicadorPropriedade}`;
    if (uniqueInventoryItems.has(duplicateKey)) {
      throw new BadRequestException(
        `O item ${externalCode} está duplicado para o indicador de propriedade ${item.indicadorPropriedade}.`,
      );
    }
    uniqueInventoryItems.add(duplicateKey);

    const participantDocument = normalizeParticipantDocument(
      item.participanteDocumento,
    );
    if (item.indicadorPropriedade === '0' && participantDocument) {
      throw new BadRequestException(
        `O item próprio ${externalCode} não deve informar participante.`,
      );
    }
    if (item.indicadorPropriedade !== '0' && !participantDocument) {
      throw new BadRequestException(
        `O item ${externalCode} exige participante para o indicador de propriedade ${item.indicadorPropriedade}.`,
      );
    }

    const quantity = toScaledInteger(item.quantidade, 4);
    const unitValue = toScaledInteger(item.valorUnitario, 10);
    const declaredItemValue = toScaledInteger(item.valorItem, 2);
    if (quantity < 0n || unitValue < 0n || declaredItemValue < 0n) {
      throw new BadRequestException(
        `O item ${externalCode} possui quantidade ou valor negativo.`,
      );
    }
    const calculatedItemValue = calculateInventoryItemValue(
      item.quantidade,
      item.valorUnitario,
    );
    if (calculatedItemValue !== declaredItemValue) {
      throw new BadRequestException(
        `O valor do item ${externalCode} deve ser ${fromScaledInteger(calculatedItemValue)} (quantidade × valor unitário).`,
      );
    }
    itemsTotal += declaredItemValue;

    const catalogDefinition = JSON.stringify({
      descricao: item.descricao.trim(),
      unitCode,
      unitDescription,
      tipoItem: item.tipoItem,
      ncm: item.ncm ?? null,
      cest: item.cest ?? null,
    });
    const previousDefinition = catalogDefinitions.get(externalCode);
    if (previousDefinition && previousDefinition !== catalogDefinition) {
      throw new BadRequestException(
        `O item ${externalCode} foi informado com dados de catálogo divergentes.`,
      );
    }
    catalogDefinitions.set(externalCode, catalogDefinition);

    const previousUnitDescription = unitDescriptions.get(unitCode);
    if (
      previousUnitDescription &&
      previousUnitDescription !== unitDescription
    ) {
      throw new BadRequestException(
        `A unidade ${unitCode} foi informada com descrições diferentes.`,
      );
    }
    unitDescriptions.set(unitCode, unitDescription);
  }

  const declaredTotal = toScaledInteger(data.valorTotal, 2);
  if (declaredTotal < 0n || itemsTotal !== declaredTotal) {
    throw new BadRequestException(
      `O valor total do inventário deve ser exatamente ${fromScaledInteger(itemsTotal)}.`,
    );
  }
}

export function calculateInventoryItemValue(
  quantity: string,
  unitValue: string,
) {
  const product = toScaledInteger(quantity, 4) * toScaledInteger(unitValue, 10);
  const divisor = 10n ** 12n;
  return (product + divisor / 2n) / divisor;
}

export function normalizeInventoryUnitCode(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^0-9A-Za-z]/g, '')
    .toUpperCase()
    .slice(0, 6);
}

export function stableInventoryItemCode(externalCode: string) {
  const identity = `PROPRIO|${externalCode.trim()}`;
  const digest = createHash('sha256')
    .update(identity, 'utf8')
    .digest('hex')
    .toUpperCase();
  return `I${digest.slice(0, 15)}`;
}

function groupCatalogInputs(items: SpedInventarioItemDto[]) {
  const result = new Map<string, CatalogItemInput>();
  for (const item of items) {
    const unitCode = normalizeInventoryUnitCode(item.unidade);
    if (!result.has(item.codigoExterno)) {
      result.set(item.codigoExterno, {
        source: item,
        unidadeCodigo: unitCode,
        unidadeDescricao: item.descricaoUnidade?.trim() || unitCode,
      });
    }
  }
  return result;
}

function normalizeParticipantDocument(value: string | null | undefined) {
  const normalized = value
    ?.trim()
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '');
  return normalized || null;
}

function assertValidInventoryDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException(
      'A data do inventário deve estar no formato YYYY-MM-DD.',
    );
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new BadRequestException('A data do inventário é inválida.');
  }
}

function batches<T>(values: T[], batchSize: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += batchSize) {
    result.push(values.slice(index, index + batchSize));
  }
  return result;
}
