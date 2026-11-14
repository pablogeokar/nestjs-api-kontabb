import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { and, desc, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service';
import {
  fiscalCatalogosVersoes,
  fiscalRegrasVersoes,
} from '../../database/schema';
import {
  EnquadramentoIcmsDto,
  HomologarIcmsRegrasDto,
  QueryIcmsRegrasDto,
  SalvarIcmsRegrasDto,
  UFS_ICMS,
} from '../dto/icms-regras.dto';

const CHAVE = 'ANTECIPACAO_PARCIAL';
const TIPO = 'DIFAL';

function competenciaDate(query: QueryIcmsRegrasDto) {
  if (query.uf !== 'BA')
    throw new BadRequestException(
      'O cadastro de Antecipação Parcial está disponível para BA.',
    );
  return `${query.competencia}-01`;
}

export function validarEnquadramentosIcms(
  rows: EnquadramentoIcmsDto[],
  homologar = false,
) {
  const keys = new Set<string>();
  for (const [index, row] of rows.entries()) {
    const key = [
      row.ncm,
      row.cest ?? '',
      row.regime,
      row.uf_origem,
      row.origem_mercadoria,
    ].join('|');
    if (keys.has(key))
      throw new BadRequestException(
        `Linha ${index + 1}: enquadramento duplicado.`,
      );
    keys.add(key);
    if (!UFS_ICMS.includes(row.uf_origem) || row.uf_origem === 'BA')
      throw new BadRequestException(
        `Linha ${index + 1}: origem deve ser interestadual.`,
      );
    if (row.tratamento === 'CONFERIR' && homologar)
      throw new BadRequestException(
        `Linha ${index + 1}: resolva a conferência fiscal antes de homologar.`,
      );
    if (row.tratamento === 'CONFERIR' && !row.motivo?.trim())
      throw new BadRequestException(
        `Linha ${index + 1}: informe o motivo da conferência.`,
      );
    if (homologar && !row.fundamento?.trim())
      throw new BadRequestException(
        `Linha ${index + 1}: informe o fundamento normativo.`,
      );
    if (homologar && row.confirmado_fiscalmente !== true)
      throw new BadRequestException(
        `Linha ${index + 1}: confirme a revisão fiscal do enquadramento.`,
      );
    if (row.tratamento === 'APLICAVEL') {
      if (
        !row.aliquota_interna ||
        (row.regime === 'SIMPLES_NACIONAL' && !row.aliquota_interestadual)
      )
        throw new BadRequestException(
          `Linha ${index + 1}: informe a alíquota interna e, para o Simples Nacional, a interestadual.`,
        );
      for (const value of [
        row.aliquota_interna,
        row.aliquota_interestadual,
      ].filter((v): v is string => v !== undefined)) {
        if (!/^\d{1,3}(\.\d{1,4})?$/.test(value) || Number(value) > 100)
          throw new BadRequestException(
            `Linha ${index + 1}: alíquota inválida.`,
          );
      }
      if (
        row.aliquota_interestadual &&
        Number(row.aliquota_interna) < Number(row.aliquota_interestadual)
      )
        throw new BadRequestException(
          `Linha ${index + 1}: alíquota interna inferior à interestadual.`,
        );
    }
  }
}

@Injectable()
export class IcmsRegrasService {
  constructor(private readonly database: DatabaseService) {}

  async consultar(query: QueryIcmsRegrasDto) {
    const competencia = competenciaDate(query);
    const [catalogo] = await this.database.db
      .select()
      .from(fiscalCatalogosVersoes)
      .where(
        and(
          eq(fiscalCatalogosVersoes.tipo, TIPO),
          eq(fiscalCatalogosVersoes.uf, query.uf),
          eq(fiscalCatalogosVersoes.ativo, true),
          lte(fiscalCatalogosVersoes.vigenciaInicio, competencia),
          or(
            isNull(fiscalCatalogosVersoes.vigenciaFim),
            gte(fiscalCatalogosVersoes.vigenciaFim, competencia),
          ),
        ),
      )
      .orderBy(desc(fiscalCatalogosVersoes.vigenciaInicio))
      .limit(1);
    if (!catalogo) return { catalogo: null, regra: null };
    const [regra] = await this.database.db
      .select()
      .from(fiscalRegrasVersoes)
      .where(
        and(
          eq(fiscalRegrasVersoes.catalogoVersaoId, catalogo.id),
          eq(fiscalRegrasVersoes.chave, CHAVE),
          eq(fiscalRegrasVersoes.ativo, true),
          lte(fiscalRegrasVersoes.vigenciaInicio, competencia),
          or(
            isNull(fiscalRegrasVersoes.vigenciaFim),
            gte(fiscalRegrasVersoes.vigenciaFim, competencia),
          ),
        ),
      )
      .orderBy(
        desc(fiscalRegrasVersoes.vigenciaInicio),
        desc(fiscalRegrasVersoes.revisao),
      )
      .limit(1);
    return {
      catalogo: {
        id: catalogo.id,
        uf: catalogo.uf,
        competencia: query.competencia,
        vigenciaInicio: catalogo.vigenciaInicio,
        vigenciaFim: catalogo.vigenciaFim,
        // Aprovação efetiva da REGRA (por regra; herda o catálogo quando nula).
        // Mantém o nome do campo para a tela atual.
        escopoAprovado: regra
          ? (regra.escopoAprovado ?? catalogo.escopoAprovado)
          : catalogo.escopoAprovado,
        fonte: catalogo.fonte,
        fonteUrl: catalogo.fonteUrl,
      },
      regra: regra
        ? {
            revisao: regra.revisao,
            fonte: regra.fonte,
            fonteUrl: regra.fonteUrl,
            escopoAprovado: regra.escopoAprovado ?? catalogo.escopoAprovado,
            aprovadoPor: regra.aprovadoPor ?? catalogo.aprovadoPor ?? null,
            aprovadoEm: regra.aprovadoEm ?? null,
            enquadramentos: regra.conteudo.enquadramentos ?? [],
          }
        : null,
    };
  }

  async salvar(input: SalvarIcmsRegrasDto, userId: string) {
    const competencia = competenciaDate(input);
    validarEnquadramentosIcms(input.enquadramentos);
    if (!input.fonte.trim())
      throw new BadRequestException('Informe a fonte normativa.');
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`icms:${input.uf}:${input.competencia}`}))`,
      );
      const [catalogo] = await tx
        .select()
        .from(fiscalCatalogosVersoes)
        .where(
          and(
            eq(fiscalCatalogosVersoes.tipo, TIPO),
            eq(fiscalCatalogosVersoes.uf, input.uf),
            eq(fiscalCatalogosVersoes.ativo, true),
            lte(fiscalCatalogosVersoes.vigenciaInicio, competencia),
            or(
              isNull(fiscalCatalogosVersoes.vigenciaFim),
              gte(fiscalCatalogosVersoes.vigenciaFim, competencia),
            ),
          ),
        )
        .orderBy(desc(fiscalCatalogosVersoes.vigenciaInicio))
        .limit(1);
      if (catalogo?.escopoAprovado)
        throw new ConflictException(
          'Este catálogo já foi homologado. Abra uma nova vigência para alterá-lo.',
        );
      if (catalogo && catalogo.vigenciaInicio !== competencia)
        throw new ConflictException(
          'Há uma vigência iniciada em outra competência. Cadastre a revisão nessa vigência.',
        );
      const [previous] = catalogo
        ? await tx
            .select()
            .from(fiscalRegrasVersoes)
            .where(
              and(
                eq(fiscalRegrasVersoes.catalogoVersaoId, catalogo.id),
                eq(fiscalRegrasVersoes.chave, CHAVE),
                eq(fiscalRegrasVersoes.ativo, true),
              ),
            )
            .orderBy(desc(fiscalRegrasVersoes.revisao))
            .limit(1)
        : [];
      // Aprovação por regra: a revisão homologada é imutável. Nova alteração
      // exige nova vigência, mesmo que o catálogo em si não esteja aprovado.
      if (previous && (previous.escopoAprovado ?? catalogo?.escopoAprovado))
        throw new ConflictException(
          'Esta regra já foi homologada. Abra uma nova vigência para alterá-la.',
        );
      const revisao = previous?.revisao ?? 0;
      if (revisao !== input.expectedRevision)
        throw new ConflictException(
          'O rascunho foi alterado por outro usuário. Recarregue antes de salvar.',
        );
      const [savedCatalogo] = catalogo
        ? [catalogo]
        : await tx
            .insert(fiscalCatalogosVersoes)
            .values({
              tipo: TIPO,
              uf: input.uf,
              codigo: `ANTECIPACAO_PARCIAL_${input.uf}_${input.competencia.replace('-', '_')}`,
              descricao: `Antecipação Parcial ${input.uf} ${input.competencia}`,
              fonte: input.fonte,
              fonteUrl: input.fonteUrl ?? null,
              vigenciaInicio: competencia,
              vigenciaFim: `${input.competencia}-${new Date(Date.UTC(Number(input.competencia.slice(0, 4)), Number(input.competencia.slice(5, 7)), 0)).getUTCDate()}`,
              conteudo: {},
              escopoAprovado: false,
            })
            .returning();
      if (!savedCatalogo)
        throw new BadRequestException('Não foi possível criar o catálogo.');
      await tx.insert(fiscalRegrasVersoes).values({
        catalogoVersaoId: savedCatalogo.id,
        chave: CHAVE,
        revisao: revisao + 1,
        conteudo: { enquadramentos: input.enquadramentos },
        fonte: input.fonte,
        fonteUrl: input.fonteUrl ?? null,
        responsavelPor: userId,
        vigenciaInicio: competencia,
        vigenciaFim: savedCatalogo.vigenciaFim,
      });
      await tx
        .update(fiscalCatalogosVersoes)
        .set({
          fonte: input.fonte,
          fonteUrl: input.fonteUrl ?? null,
          hashConteudo: null,
          conteudo: {
            status: 'RASCUNHO',
            competencia: input.competencia,
            enquadramentos: input.enquadramentos,
          },
          atualizadoEm: new Date(),
        })
        .where(eq(fiscalCatalogosVersoes.id, savedCatalogo.id));
      return {
        catalogoId: savedCatalogo.id,
        revisao: revisao + 1,
        escopoAprovado: false,
      };
    });
  }

  async homologar(input: HomologarIcmsRegrasDto, userId: string) {
    const competencia = competenciaDate(input);
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`icms:${input.uf}:${input.competencia}`}))`,
      );
      const [catalogo] = await tx
        .select()
        .from(fiscalCatalogosVersoes)
        .where(
          and(
            eq(fiscalCatalogosVersoes.tipo, TIPO),
            eq(fiscalCatalogosVersoes.uf, input.uf),
            eq(fiscalCatalogosVersoes.vigenciaInicio, competencia),
            eq(fiscalCatalogosVersoes.ativo, true),
          ),
        )
        .limit(1);
      if (!catalogo) throw new NotFoundException('Catálogo não encontrado.');
      const [regra] = await tx
        .select()
        .from(fiscalRegrasVersoes)
        .where(
          and(
            eq(fiscalRegrasVersoes.catalogoVersaoId, catalogo.id),
            eq(fiscalRegrasVersoes.chave, CHAVE),
            eq(fiscalRegrasVersoes.ativo, true),
          ),
        )
        .orderBy(desc(fiscalRegrasVersoes.revisao))
        .limit(1);
      // Aprovação POR REGRA: a regra aprovada herda o catálogo apenas quando o
      // campo próprio é nulo (catálogos legados homologados em bloco).
      if (regra && (regra.escopoAprovado ?? catalogo.escopoAprovado))
        throw new ConflictException('Regra já homologada.');
      if (!regra || regra.revisao !== input.expectedRevision)
        throw new ConflictException(
          'A revisão mudou. Recarregue antes de homologar.',
        );
      const rows = regra.conteudo.enquadramentos;
      if (!Array.isArray(rows) || rows.length === 0)
        throw new BadRequestException('Não há enquadramentos para homologar.');
      validarEnquadramentosIcms(rows as EnquadramentoIcmsDto[], true);
      if (!regra.fonteUrl)
        throw new BadRequestException(
          'Informe a URL da fonte normativa antes de homologar.',
        );
      const conteudo = {
        status: 'HOMOLOGADO',
        competencia: input.competencia,
        enquadramentos: rows,
        revisao: regra.revisao,
      };
      // O hash sela o conteúdo e também os parâmetros de vigência e de fonte
      // da regra aprovada, não só os enquadramentos.
      const hashConteudo = createHash('sha256')
        .update(
          JSON.stringify({
            chave: regra.chave,
            uf: catalogo.uf,
            tipo: catalogo.tipo,
            vigenciaInicio: regra.vigenciaInicio,
            vigenciaFim: regra.vigenciaFim,
            fonte: regra.fonte,
            fonteUrl: regra.fonteUrl,
            conteudo,
          }),
        )
        .digest('hex');
      const agora = new Date();
      // Aprova SOMENTE a regra. `fiscal_catalogos_versoes.escopo_aprovado` não
      // muda: regras vizinhas do catálogo continuam sem aprovação própria.
      await tx
        .update(fiscalRegrasVersoes)
        .set({ escopoAprovado: true, aprovadoPor: userId, aprovadoEm: agora })
        .where(eq(fiscalRegrasVersoes.id, regra.id));
      await tx
        .update(fiscalCatalogosVersoes)
        .set({ conteudo, hashConteudo, atualizadoEm: agora })
        .where(eq(fiscalCatalogosVersoes.id, catalogo.id));
      return {
        catalogoId: catalogo.id,
        revisao: regra.revisao,
        escopoAprovado: true,
      };
    });
  }
}
