import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, gte, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service';
import { clientes, clientesPerfisFiscais } from '../../database/schema';
import {
  validarPerfilManual,
  type PerfilFiscalLinha,
  type PerfilManualInput,
} from './estabelecimento-perfil';

const SEM_FIM = '9999-12-31';

/** Histórico fiscal do estabelecimento (UF, IE, regime) e perfis MANUAL com datas legais. */
@Injectable()
export class EstabelecimentoPerfilService {
  constructor(private readonly database: DatabaseService) {}

  /** Linhas ATIVAS usadas pela apuração. */
  async listar(clienteId: string): Promise<PerfilFiscalLinha[]> {
    const rows = await this.database.db
      .select({
        vigenciaInicio: clientesPerfisFiscais.vigenciaInicio,
        vigenciaFim: clientesPerfisFiscais.vigenciaFim,
        uf: clientesPerfisFiscais.uf,
        inscricaoEstadual: clientesPerfisFiscais.inscricaoEstadual,
        regimeTributario: clientesPerfisFiscais.regimeTributario,
        origem: clientesPerfisFiscais.origem,
      })
      .from(clientesPerfisFiscais)
      .where(
        and(
          eq(clientesPerfisFiscais.clienteId, clienteId),
          eq(clientesPerfisFiscais.ativo, true),
        ),
      );
    return rows.map((r) => ({ ...r, vigenciaFim: r.vigenciaFim ?? null }));
  }

  /** Todas as linhas, inclusive inativas, para auditoria. */
  async listarAuditoria(clienteId: string) {
    await this.assertCliente(clienteId);
    return this.database.db
      .select()
      .from(clientesPerfisFiscais)
      .where(eq(clientesPerfisFiscais.clienteId, clienteId))
      .orderBy(asc(clientesPerfisFiscais.vigenciaInicio));
  }

  /**
   * Registra um perfil com DATAS LEGAIS. Nada é apagado:
   * - sobreposição com outro perfil MANUAL ativo é recusada;
   * - linhas automáticas que começam dentro do período ficam inativas
   *   (`substituido_por`) e voltam se este perfil for removido.
   * Fechamentos já selados não mudam; a competência afetada é devolvida para
   * decidir a retificação.
   */
  async registrarManual(
    clienteId: string,
    input: PerfilManualInput,
    userId: string,
  ) {
    const erros = validarPerfilManual(input);
    if (erros.length > 0) throw new BadRequestException(erros);
    const inicio = input.vigenciaInicio;
    const fim = input.vigenciaFim ?? null;
    const fimBusca = fim ?? SEM_FIM;

    return this.database.db.transaction(async (tx) => {
      await tx.execute(sqlLock(`perfil-fiscal:${clienteId}`));
      const [cliente] = await tx
        .select({ id: clientes.id })
        .from(clientes)
        .where(eq(clientes.id, clienteId))
        .limit(1);
      if (!cliente) throw new NotFoundException('Empresa não encontrada.');

      const sobrepostos = await tx
        .select({
          id: clientesPerfisFiscais.id,
          vigenciaInicio: clientesPerfisFiscais.vigenciaInicio,
          vigenciaFim: clientesPerfisFiscais.vigenciaFim,
        })
        .from(clientesPerfisFiscais)
        .where(
          and(
            eq(clientesPerfisFiscais.clienteId, clienteId),
            eq(clientesPerfisFiscais.ativo, true),
            eq(clientesPerfisFiscais.origem, 'MANUAL'),
            lte(clientesPerfisFiscais.vigenciaInicio, fimBusca),
            or(
              isNull(clientesPerfisFiscais.vigenciaFim),
              gte(clientesPerfisFiscais.vigenciaFim, inicio),
            ),
          ),
        );
      if (sobrepostos.length > 0) {
        throw new ConflictException(
          'Já existe perfil manual ativo neste período. Remova-o antes de ' +
            'registrar outro: ' +
            sobrepostos
              .map((p) => `${p.vigenciaInicio}..${p.vigenciaFim ?? 'aberto'}`)
              .join(', '),
        );
      }

      const id = randomUUID();
      const substituidos = await tx
        .update(clientesPerfisFiscais)
        .set({ ativo: false, substituidoPor: id })
        .where(
          and(
            eq(clientesPerfisFiscais.clienteId, clienteId),
            eq(clientesPerfisFiscais.ativo, true),
            ne(clientesPerfisFiscais.origem, 'MANUAL'),
            gte(clientesPerfisFiscais.vigenciaInicio, inicio),
            lte(clientesPerfisFiscais.vigenciaInicio, fimBusca),
          ),
        )
        .returning({ id: clientesPerfisFiscais.id });

      const [criado] = await tx
        .insert(clientesPerfisFiscais)
        .values({
          id,
          clienteId,
          vigenciaInicio: inicio,
          vigenciaFim: fim,
          uf: input.uf.trim().toUpperCase(),
          inscricaoEstadual: input.inscricaoEstadual ?? null,
          regimeTributario: input.regimeTributario ?? null,
          origem: 'MANUAL',
          fonte: input.fonte.trim(),
          justificativa: input.justificativa.trim(),
          criadoPor: userId,
        })
        .returning();
      return {
        perfil: criado,
        linhas_automaticas_substituidas: substituidos.length,
        competencias_afetadas: {
          de: inicio.slice(0, 7),
          ate: fim ? fim.slice(0, 7) : null,
        },
        aviso:
          'Fechamentos já selados não foram alterados. Reapure e, se houver ' +
          'diferença, gere nova versão do fechamento.',
      };
    });
  }

  /** Remove (desativa) um perfil MANUAL e restaura as linhas automáticas que ele substituiu. */
  async removerManual(clienteId: string, perfilId: string) {
    return this.database.db.transaction(async (tx) => {
      await tx.execute(sqlLock(`perfil-fiscal:${clienteId}`));
      const [perfil] = await tx
        .select()
        .from(clientesPerfisFiscais)
        .where(
          and(
            eq(clientesPerfisFiscais.id, perfilId),
            eq(clientesPerfisFiscais.clienteId, clienteId),
          ),
        )
        .limit(1);
      if (!perfil) throw new NotFoundException('Perfil não encontrado.');
      if (perfil.origem !== 'MANUAL') {
        throw new BadRequestException(
          'Só perfis informados manualmente podem ser removidos.',
        );
      }
      if (!perfil.ativo) throw new ConflictException('Perfil já removido.');
      await tx
        .update(clientesPerfisFiscais)
        .set({ ativo: false })
        .where(eq(clientesPerfisFiscais.id, perfilId));
      const restauradas = await tx
        .update(clientesPerfisFiscais)
        .set({ ativo: true, substituidoPor: null })
        .where(eq(clientesPerfisFiscais.substituidoPor, perfilId))
        .returning({ id: clientesPerfisFiscais.id });
      return {
        removido: perfilId,
        linhas_automaticas_restauradas: restauradas.length,
        competencias_afetadas: {
          de: perfil.vigenciaInicio.slice(0, 7),
          ate: perfil.vigenciaFim ? perfil.vigenciaFim.slice(0, 7) : null,
        },
      };
    });
  }

  private async assertCliente(clienteId: string) {
    const [c] = await this.database.db
      .select({ id: clientes.id })
      .from(clientes)
      .where(eq(clientes.id, clienteId))
      .limit(1);
    if (!c) throw new NotFoundException('Empresa não encontrada.');
  }
}

function sqlLock(chave: string) {
  return sql`select pg_advisory_xact_lock(hashtext(${chave}))`;
}
