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
  ChaveEnquadramentoIcmsDto,
  EnquadramentoIcmsDto,
  HomologarIcmsRegrasDto,
  RemoverEnquadramentoIcmsDto,
  SalvarEnquadramentoIcmsDto,
  QueryIcmsRegrasDto,
  SalvarIcmsRegrasDto,
  UFS_ICMS,
} from '../dto/icms-regras.dto';

const CHAVE = 'ANTECIPACAO_PARCIAL';
const TIPO = 'DIFAL';

function competenciaDate(query: QueryIcmsRegrasDto) {
  if (!UFS_ICMS.includes(query.uf))
    throw new BadRequestException('UF inválida para o cadastro de regras.');
  return `${query.competencia}-01`;
}

export function validarEnquadramentosIcms(
  rows: EnquadramentoIcmsDto[],
  homologar = false,
  ufDestino = 'BA',
) {
  const keys = new Set<string>();
  for (const [index, row] of rows.entries()) {
    const aprovarLinha = homologar || row.confirmado_fiscalmente === true;
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
    if (!UFS_ICMS.includes(row.uf_origem) || row.uf_origem === ufDestino)
      throw new BadRequestException(
        `Linha ${index + 1}: origem deve ser interestadual.`,
      );
    if (row.tratamento === 'CONFERIR' && aprovarLinha)
      throw new BadRequestException(
        `Linha ${index + 1}: resolva a conferência fiscal antes de aprovar o enquadramento.`,
      );
    if (aprovarLinha && !row.fundamento?.trim())
      throw new BadRequestException(
        `Linha ${index + 1}: informe o fundamento normativo.`,
      );
    if (homologar && row.confirmado_fiscalmente !== true)
      throw new BadRequestException(
        `Linha ${index + 1}: confirme a revisão fiscal do enquadramento.`,
      );
    if (aprovarLinha && row.tratamento === 'ICMS_ST' && !row.cest)
      throw new BadRequestException(
        `Linha ${index + 1}: informe o CEST para o enquadramento de ICMS-ST.`,
      );
    if (aprovarLinha && row.ipi_na_base && !row.fundamento_ipi?.trim())
      throw new BadRequestException(
        `Linha ${index + 1}: fundamente a decisão sobre o IPI na base.`,
      );
    if (row.tratamento === 'APLICAVEL') {
      if (
        (aprovarLinha && !row.aliquota_interna) ||
        (aprovarLinha &&
          row.regime === 'SIMPLES_NACIONAL' &&
          !row.aliquota_interestadual)
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

function chaveEnquadramento(row: ChaveEnquadramentoIcmsDto) {
  return [
    row.ncm,
    row.cest ?? '',
    row.regime,
    row.uf_origem,
    row.origem_mercadoria,
  ].join('|');
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
            id: regra.id,
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
    validarEnquadramentosIcms(input.enquadramentos, false, input.uf);
    if (!input.fonte.trim())
      throw new BadRequestException('Informe a fonte normativa.');
    if (
      input.enquadramentos.some((row) => row.confirmado_fiscalmente) &&
      !input.fonteUrl?.trim()
    )
      throw new BadRequestException(
        'Informe a URL oficial da fonte antes de aprovar um enquadramento.',
      );
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`icms:${input.uf}`}))`,
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
      // A revisão vale para a vigência inteira do catálogo que contém a
      // competência (ex.: 01/01 a 31/12), não só para o mês aberto na tela.
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
      // A interface edita apenas os enquadramentos. Revisões feitas antes da
      // preservação do conteúdo podem ter perdido a redução e as fontes da
      // seed; recupera os parâmetros da revisão histórica mais recente.
      const [conteudoComParametros] =
        previous && !('reducao_me_epp' in previous.conteudo)
          ? await tx
              .select({ conteudo: fiscalRegrasVersoes.conteudo })
              .from(fiscalRegrasVersoes)
              .where(
                and(
                  eq(
                    fiscalRegrasVersoes.catalogoVersaoId,
                    previous.catalogoVersaoId,
                  ),
                  eq(fiscalRegrasVersoes.chave, CHAVE),
                  sql`jsonb_exists(${fiscalRegrasVersoes.conteudo}, 'reducao_me_epp')`,
                ),
              )
              .orderBy(desc(fiscalRegrasVersoes.revisao))
              .limit(1)
          : [];
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
        conteudo: {
          ...conteudoComParametros?.conteudo,
          ...previous?.conteudo,
          enquadramentos: input.enquadramentos,
        },
        fonte: input.fonte,
        fonteUrl: input.fonteUrl ?? null,
        responsavelPor: userId,
        vigenciaInicio: savedCatalogo.vigenciaInicio,
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
        vigenciaInicio: savedCatalogo.vigenciaInicio,
        vigenciaFim: savedCatalogo.vigenciaFim,
      };
    });
  }

  /** Insere ou altera um único enquadramento (nova revisão da regra). */
  async salvarEnquadramento(input: SalvarEnquadramentoIcmsDto, userId: string) {
    const row = input.enquadramento;
    validarEnquadramentosIcms([row], false, input.uf);
    return this.mutarEnquadramentos(
      input,
      userId,
      input.fonte,
      input.fonteUrl,
      (rows) => {
        const novaChave = chaveEnquadramento(row);
        const antiga = input.chaveAnterior
          ? chaveEnquadramento(input.chaveAnterior)
          : novaChave;
        const outros = rows.filter((r) => chaveEnquadramento(r) !== antiga);
        if (outros.some((r) => chaveEnquadramento(r) === novaChave))
          throw new BadRequestException(
            'Já existe um enquadramento com este NCM, CEST, regime e origem.',
          );
        const existe = outros.length !== rows.length;
        const next = existe
          ? rows.map((r) => (chaveEnquadramento(r) === antiga ? row : r))
          : [...rows, row];
        return {
          rows: next,
          exigeFonteUrl: row.confirmado_fiscalmente === true,
        };
      },
    );
  }
  async removerEnquadramento(
    input: RemoverEnquadramentoIcmsDto,
    userId: string,
  ) {
    return this.mutarEnquadramentos(
      input,
      userId,
      undefined,
      undefined,
      (rows) => {
        const alvo = chaveEnquadramento(input.chave);
        if (!rows.some((r) => chaveEnquadramento(r) === alvo))
          throw new NotFoundException('Enquadramento não encontrado.');
        return {
          rows: rows.filter((r) => chaveEnquadramento(r) !== alvo),
          exigeFonteUrl: false,
        };
      },
    );
  }
  private async mutarEnquadramentos(
    input: QueryIcmsRegrasDto & { expectedRevision: number },
    userId: string,
    fonteInformada: string | undefined,
    fonteUrlInformada: string | undefined,
    mutar: (rows: EnquadramentoIcmsDto[]) => {
      rows: EnquadramentoIcmsDto[];
      exigeFonteUrl: boolean;
    },
  ) {
    const competencia = competenciaDate(input);
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`icms:${input.uf}`}))`,
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
      const revisao = previous?.revisao ?? 0;
      if (revisao !== input.expectedRevision)
        throw new ConflictException(
          'As regras foram alteradas por outro usuário. Recarregue antes de salvar.',
        );
      const aprovadaAntes = Boolean(
        previous &&
        (previous.escopoAprovado ?? catalogo?.escopoAprovado ?? false),
      );
      const atuais = (
        Array.isArray(previous?.conteudo?.enquadramentos)
          ? previous.conteudo.enquadramentos
          : []
      ) as EnquadramentoIcmsDto[];
      // Uma revisão homologada em bloco vale para todas as linhas. Ao editar
      // uma só, a nova revisão deixa de ser homologada em bloco e cada linha
      // anterior mantém a aprovação em si (já validada na homologação).
      const base = aprovadaAntes
        ? atuais.map((r) => ({
            ...r,
            confirmado_fiscalmente: Boolean(r.fundamento?.trim()),
          }))
        : atuais;
      const { rows, exigeFonteUrl } = mutar(base);
      const fonte =
        fonteInformada?.trim() || previous?.fonte || catalogo?.fonte;
      if (!fonte) throw new BadRequestException('Informe a fonte normativa.');
      const fonteUrl =
        fonteUrlInformada?.trim() ||
        previous?.fonteUrl ||
        catalogo?.fonteUrl ||
        null;
      if (exigeFonteUrl && !fonteUrl)
        throw new BadRequestException(
          'Informe a URL oficial da fonte antes de aprovar o enquadramento.',
        );
      // Catálogo novo da UF: cobre o ano da competência, sem invadir a
      // vigência de um catálogo posterior. Uma regra por UF e período, e não
      // uma por CNPJ nem por mês.
      const vigenciaNova = await (async () => {
        if (catalogo)
          return { inicio: competencia, fim: null as string | null };
        const inicio = `${input.competencia.slice(0, 4)}-01-01`;
        const [proximo] = await tx
          .select({ inicio: fiscalCatalogosVersoes.vigenciaInicio })
          .from(fiscalCatalogosVersoes)
          .where(
            and(
              eq(fiscalCatalogosVersoes.tipo, TIPO),
              eq(fiscalCatalogosVersoes.uf, input.uf),
              eq(fiscalCatalogosVersoes.ativo, true),
              gte(fiscalCatalogosVersoes.vigenciaInicio, competencia),
            ),
          )
          .orderBy(fiscalCatalogosVersoes.vigenciaInicio)
          .limit(1);
        const fimAno = `${input.competencia.slice(0, 4)}-12-31`;
        if (!proximo) return { inicio, fim: fimAno };
        const dia = new Date(`${proximo.inicio}T00:00:00Z`);
        dia.setUTCDate(dia.getUTCDate() - 1);
        const anterior = dia.toISOString().slice(0, 10);
        return { inicio, fim: anterior < fimAno ? anterior : fimAno };
      })();
      // O resolvedor de regras prefere a revisão aprovada mais recente. Se a
      // anterior estava aprovada, a nova só passa a valer se também for
      // aprovada; isso ocorre quando todas as linhas estão confirmadas.
      const aprovarRevisao =
        aprovadaAntes &&
        rows.length > 0 &&
        rows.every(
          (r) =>
            r.confirmado_fiscalmente === true &&
            r.tratamento !== 'CONFERIR' &&
            Boolean(r.fundamento?.trim()),
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
              fonte,
              fonteUrl,
              vigenciaInicio: vigenciaNova.inicio,
              vigenciaFim: vigenciaNova.fim,
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
        conteudo: { ...previous?.conteudo, enquadramentos: rows },
        fonte,
        fonteUrl,
        responsavelPor: userId,
        escopoAprovado: aprovarRevisao,
        aprovadoPor: aprovarRevisao ? userId : null,
        aprovadoEm: aprovarRevisao ? new Date() : null,
        vigenciaInicio:
          previous?.vigenciaInicio ?? savedCatalogo.vigenciaInicio,
        vigenciaFim: previous?.vigenciaFim ?? savedCatalogo.vigenciaFim,
      });
      if (!savedCatalogo.escopoAprovado) {
        await tx
          .update(fiscalCatalogosVersoes)
          .set({
            fonte,
            fonteUrl,
            hashConteudo: null,
            conteudo: {
              status: 'RASCUNHO',
              competencia: input.competencia,
              enquadramentos: rows,
            },
            atualizadoEm: new Date(),
          })
          .where(eq(fiscalCatalogosVersoes.id, savedCatalogo.id));
      }
      return {
        catalogoId: savedCatalogo.id,
        revisao: revisao + 1,
        enquadramentos: rows,
      };
    });
  }
  async homologar(input: HomologarIcmsRegrasDto, userId: string) {
    const competencia = competenciaDate(input);
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`icms:${input.uf}`}))`,
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
      validarEnquadramentosIcms(rows as EnquadramentoIcmsDto[], true, input.uf);
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
