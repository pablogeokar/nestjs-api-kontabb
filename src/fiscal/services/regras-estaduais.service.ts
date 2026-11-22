import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { and, asc, desc, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';
import { CONVENIO_ICMS_142_2018 } from './st-verificacao';
import { DatabaseService } from '../../database/database.service';
import {
  fiscalCatalogosVersoes,
  fiscalRegrasVersoes,
} from '../../database/schema';
import { UFS_ICMS, type QueryIcmsRegrasDto } from '../dto/icms-regras.dto';
import type {
  AprovarFonteStDto,
  DifalParametrosDto,
  RemoverStEstadualDto,
  SalvarDifalEstadualDto,
  SalvarStEstadualDto,
  StRegraDto,
} from '../dto/regras-estaduais.dto';

export const CHAVE_DIFAL = 'DIFAL_ENTRADA_CONTRIBUINTE';
type TipoCatalogo = 'DIFAL' | 'ST_FCP';
type Banco = DatabaseService['db'];

function primeiroDia(query: QueryIcmsRegrasDto) {
  if (!UFS_ICMS.includes(query.uf))
    throw new BadRequestException('UF inválida para o cadastro de regras.');
  return `${query.competencia}-01`;
}
const texto = (valor: string | null | undefined) => valor?.trim() || null;
const cem = (valor: string) => Math.round(Number(valor) * 10000);

/** Mesmas condições que o cálculo exige para aceitar a regra de DIFAL. */
export function validarParametrosDifal(
  p: DifalParametrosDto,
  aprovar: boolean,
) {
  const interna = cem(p.aliquota_interna);
  if (interna <= 0 || interna >= 1_000_000)
    throw new BadRequestException('Informe a alíquota interna da UF.');
  if (p.aliquota_interestadual != null && p.aliquota_interestadual !== '') {
    if (cem(p.aliquota_interestadual) > interna)
      throw new BadRequestException(
        'A alíquota interestadual não pode ser maior que a interna.',
      );
  }
  if (p.fcp_na_base_por_dentro) {
    if (!p.base_por_dentro && !p.base_dupla)
      throw new BadRequestException(
        'O FCP na base por dentro exige base por dentro ou base dupla.',
      );
    if (!p.aliquota_fcp)
      throw new BadRequestException('Informe a alíquota de FCP.');
    if (interna + cem(p.aliquota_fcp) >= 1_000_000)
      throw new BadRequestException(
        'Alíquota interna somada ao FCP deve ser menor que 100%.',
      );
  }
  if (aprovar && !texto(p.fundamento))
    throw new BadRequestException('Informe o fundamento da regra.');
}

export function validarRegraSt(r: StRegraDto, aprovar: boolean) {
  if (aprovar && !texto(r.fundamento))
    throw new BadRequestException('Informe o fundamento da regra.');
}

@Injectable()
export class RegrasEstaduaisService {
  constructor(private readonly database: DatabaseService) {}

  // ─── DIFAL ────────────────────────────────────────────────────────────────
  async consultarDifal(query: QueryIcmsRegrasDto) {
    const competencia = primeiroDia(query);
    const catalogo = await this.catalogoVigente(
      this.database.db,
      'DIFAL',
      query.uf,
      competencia,
    );
    if (!catalogo) return { catalogo: null, regra: null };
    const [regra] = await this.database.db
      .select()
      .from(fiscalRegrasVersoes)
      .where(
        and(
          eq(fiscalRegrasVersoes.catalogoVersaoId, catalogo.id),
          eq(fiscalRegrasVersoes.chave, CHAVE_DIFAL),
          eq(fiscalRegrasVersoes.ativo, true),
        ),
      )
      .orderBy(desc(fiscalRegrasVersoes.revisao))
      .limit(1);
    return {
      catalogo: this.resumoCatalogo(catalogo),
      regra: this.resumoRegra(regra, catalogo),
    };
  }

  async salvarDifal(input: SalvarDifalEstadualDto, userId: string) {
    const competencia = primeiroDia(input);
    validarParametrosDifal(input.parametros, input.aprovar);
    return this.transacao('DIFAL', input, async (tx) => {
      const catalogo = await this.catalogoVigente(
        tx,
        'DIFAL',
        input.uf,
        competencia,
      );
      const anterior = catalogo
        ? await this.ultimaRevisao(tx, catalogo.id, CHAVE_DIFAL)
        : undefined;
      if ((anterior?.revisao ?? 0) !== input.expectedRevision)
        throw new ConflictException(
          'A regra foi alterada por outro usuário. Recarregue antes de salvar.',
        );
      const fonte = texto(input.fonte) ?? anterior?.fonte ?? catalogo?.fonte;
      if (!fonte) throw new BadRequestException('Informe a fonte normativa.');
      const fonteUrl =
        texto(input.fonteUrl) ??
        anterior?.fonteUrl ??
        catalogo?.fonteUrl ??
        null;
      if (input.aprovar && !fonteUrl)
        throw new BadRequestException(
          'Informe o link oficial da norma antes de aprovar.',
        );
      const salvo =
        catalogo ??
        (await this.criarCatalogo(tx, 'DIFAL', input, fonte, fonteUrl));
      const p = input.parametros;
      const dispensa = texto(p.dispensa_ativo_me_epp_fundamento);
      const conteudo: Record<string, unknown> = {
        ...anterior?.conteudo,
        aliquota_interna: p.aliquota_interna,
        aliquota_interestadual: texto(p.aliquota_interestadual),
        aliquota_fcp: texto(p.aliquota_fcp),
        percentual_reducao: texto(p.percentual_reducao),
        percentual_beneficio: texto(p.percentual_beneficio),
        base_por_dentro: p.base_por_dentro,
        base_dupla: p.base_dupla,
        fcp_na_base_por_dentro: p.fcp_na_base_por_dentro,
        fundamento: texto(p.fundamento),
      };
      if (dispensa) conteudo.dispensa_ativo_me_epp = { fundamento: dispensa };
      else delete conteudo.dispensa_ativo_me_epp;
      return this.gravarRevisao(tx, {
        catalogo: salvo,
        chave: CHAVE_DIFAL,
        revisao: await this.proximaRevisao(tx, salvo.id, CHAVE_DIFAL),
        conteudo,
        fonte,
        fonteUrl,
        aprovar: input.aprovar,
        userId,
      });
    });
  }

  // ─── ST ───────────────────────────────────────────────────────────────────
  async consultarSt(query: QueryIcmsRegrasDto) {
    const competencia = primeiroDia(query);
    const catalogo = await this.catalogoVigente(
      this.database.db,
      'ST_FCP',
      query.uf,
      competencia,
    );
    const fontes = await this.fontesSt(query.uf, competencia);
    if (!catalogo) return { catalogo: null, regras: [], fontes };
    const linhas = await this.database.db
      .select()
      .from(fiscalRegrasVersoes)
      .where(
        and(
          eq(fiscalRegrasVersoes.catalogoVersaoId, catalogo.id),
          eq(fiscalRegrasVersoes.ativo, true),
        ),
      )
      .orderBy(
        asc(fiscalRegrasVersoes.chave),
        desc(fiscalRegrasVersoes.revisao),
      );
    const ultimas = new Map<string, (typeof linhas)[number]>();
    for (const linha of linhas)
      if (!ultimas.has(linha.chave)) ultimas.set(linha.chave, linha);
    return {
      catalogo: this.resumoCatalogo(catalogo),
      fontes,
      regras: [...ultimas.values()].map((r) => this.resumoRegra(r, catalogo)),
    };
  }

  /** Situação das duas camadas de fonte que habilitam a ST na apuração. */
  private async fontesSt(uf: string, competencia: string) {
    const [nacional, estadual] = await Promise.all([
      this.catalogoVigente(this.database.db, 'ST_FCP', 'BR', competencia),
      this.catalogoVigente(this.database.db, 'ST_FCP', uf, competencia),
    ]);
    const resumo = (c: typeof nacional) =>
      c
        ? {
            fonte: c.fonte,
            fonteUrl: c.fonteUrl,
            verificada: c.escopoAprovado === true,
          }
        : null;
    return {
      nacional: resumo(nacional),
      estadual: resumo(estadual),
      padraoNacional: {
        fonte: CONVENIO_ICMS_142_2018.fonte,
        fonteUrl: CONVENIO_ICMS_142_2018.fonteUrl,
      },
    };
  }

  /** Marca (ou revoga) a verificação da fonte normativa de ST. */
  async aprovarFonteSt(input: AprovarFonteStDto, userId: string) {
    const competencia = primeiroDia(input);
    const nacional = input.nivel === 'NACIONAL';
    const uf = nacional ? 'BR' : input.uf;
    return this.transacao('ST_FCP', { ...input, uf }, async (tx) => {
      let catalogo = await this.catalogoVigente(tx, 'ST_FCP', uf, competencia);
      const fonte =
        texto(input.fonte) ??
        catalogo?.fonte ??
        (nacional ? CONVENIO_ICMS_142_2018.fonte : null);
      const fonteUrl =
        texto(input.fonteUrl) ??
        catalogo?.fonteUrl ??
        (nacional ? CONVENIO_ICMS_142_2018.fonteUrl : null);
      if (!catalogo) {
        if (!input.aprovar)
          throw new NotFoundException('Fonte não encontrada.');
        if (!fonte) throw new BadRequestException('Informe a fonte normativa.');
        if (nacional) {
          const [criado] = await tx
            .insert(fiscalCatalogosVersoes)
            .values({
              tipo: 'ST_FCP',
              uf,
              codigo: 'ST_FCP_BR_CONVENIO_142_2018',
              descricao: 'Convênio ICMS 142/2018 (arcabouço nacional da ST)',
              fonte,
              fonteUrl,
              vigenciaInicio: CONVENIO_ICMS_142_2018.vigenciaInicio,
              vigenciaFim: null,
              conteudo: {},
              escopoAprovado: false,
            })
            .returning();
          catalogo = criado;
        } else {
          catalogo = await this.criarCatalogo(
            tx,
            'ST_FCP',
            input,
            fonte,
            fonteUrl,
          );
        }
      }
      if (input.aprovar && (!fonte || !fonteUrl))
        throw new BadRequestException(
          'Informe o ato normativo e o link oficial antes de verificar a fonte.',
        );
      const hashConteudo = input.aprovar
        ? createHash('sha256')
            .update(
              JSON.stringify({
                tipo: catalogo.tipo,
                uf: catalogo.uf,
                codigo: catalogo.codigo,
                fonte,
                fonteUrl,
                vigenciaInicio: catalogo.vigenciaInicio,
                vigenciaFim: catalogo.vigenciaFim,
              }),
            )
            .digest('hex')
        : null;
      await tx
        .update(fiscalCatalogosVersoes)
        .set({
          fonte: fonte ?? catalogo.fonte,
          fonteUrl,
          escopoAprovado: input.aprovar,
          aprovadoPor: input.aprovar ? userId : null,
          hashConteudo,
          atualizadoEm: new Date(),
        })
        .where(eq(fiscalCatalogosVersoes.id, catalogo.id));
      return { nivel: input.nivel, uf, verificada: input.aprovar };
    });
  }

  async salvarSt(input: SalvarStEstadualDto, userId: string) {
    const competencia = primeiroDia(input);
    validarRegraSt(input.regra, input.aprovar);
    const cest = input.regra.cest;
    return this.transacao('ST_FCP', input, async (tx) => {
      const catalogo = await this.catalogoVigente(
        tx,
        'ST_FCP',
        input.uf,
        competencia,
      );
      const anterior = catalogo
        ? await this.ultimaRevisao(tx, catalogo.id, cest)
        : undefined;
      if ((anterior?.revisao ?? 0) !== input.expectedRevision)
        throw new ConflictException(
          'A regra deste CEST foi alterada por outro usuário. Recarregue antes de salvar.',
        );
      const fonte = texto(input.fonte) ?? anterior?.fonte ?? catalogo?.fonte;
      if (!fonte) throw new BadRequestException('Informe a fonte normativa.');
      const fonteUrl =
        texto(input.fonteUrl) ??
        anterior?.fonteUrl ??
        catalogo?.fonteUrl ??
        null;
      if (input.aprovar && !fonteUrl)
        throw new BadRequestException(
          'Informe o link oficial da norma antes de aprovar.',
        );
      const salvo =
        catalogo ??
        (await this.criarCatalogo(tx, 'ST_FCP', input, fonte, fonteUrl));
      const r = input.regra;
      return this.gravarRevisao(tx, {
        catalogo: salvo,
        chave: cest,
        revisao: await this.proximaRevisao(tx, salvo.id, cest),
        conteudo: {
          ...anterior?.conteudo,
          cest,
          ncm: texto(r.ncm),
          sujeito_ast: r.sujeito_ast,
          mva: r.sujeito_ast ? texto(r.mva) : null,
          aliquota_fcp: r.sujeito_ast ? texto(r.aliquota_fcp) : null,
          fundamento: texto(r.fundamento),
        },
        fonte,
        fonteUrl,
        aprovar: input.aprovar,
        userId,
      });
    });
  }

  async removerSt(input: RemoverStEstadualDto) {
    const competencia = primeiroDia(input);
    return this.transacao('ST_FCP', input, async (tx) => {
      const catalogo = await this.catalogoVigente(
        tx,
        'ST_FCP',
        input.uf,
        competencia,
      );
      if (!catalogo) throw new NotFoundException('Regra não encontrada.');
      const removidas = await tx
        .update(fiscalRegrasVersoes)
        .set({ ativo: false })
        .where(
          and(
            eq(fiscalRegrasVersoes.catalogoVersaoId, catalogo.id),
            eq(fiscalRegrasVersoes.chave, input.cest),
            eq(fiscalRegrasVersoes.ativo, true),
          ),
        )
        .returning({ id: fiscalRegrasVersoes.id });
      if (removidas.length === 0)
        throw new NotFoundException('Regra não encontrada.');
      return { cest: input.cest, removidas: removidas.length };
    });
  }

  // ─── Compartilhado ────────────────────────────────────────────────────────
  private async transacao<T>(
    tipo: TipoCatalogo,
    input: QueryIcmsRegrasDto,
    corpo: (tx: Banco) => Promise<T>,
  ): Promise<T> {
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`regra:${tipo}:${input.uf}`}))`,
      );
      return corpo(tx as unknown as Banco);
    });
  }

  private async catalogoVigente(
    db: Banco,
    tipo: TipoCatalogo,
    uf: string,
    competencia: string,
  ) {
    const [catalogo] = await db
      .select()
      .from(fiscalCatalogosVersoes)
      .where(
        and(
          eq(fiscalCatalogosVersoes.tipo, tipo),
          eq(fiscalCatalogosVersoes.uf, uf),
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
    return catalogo;
  }

  /** Numeração considera também revisões removidas (índice único por revisão). */
  private async proximaRevisao(db: Banco, catalogoId: string, chave: string) {
    const [linha] = await db
      .select({ revisao: fiscalRegrasVersoes.revisao })
      .from(fiscalRegrasVersoes)
      .where(
        and(
          eq(fiscalRegrasVersoes.catalogoVersaoId, catalogoId),
          eq(fiscalRegrasVersoes.chave, chave),
        ),
      )
      .orderBy(desc(fiscalRegrasVersoes.revisao))
      .limit(1);
    return (linha?.revisao ?? 0) + 1;
  }

  private async ultimaRevisao(db: Banco, catalogoId: string, chave: string) {
    const [linha] = await db
      .select()
      .from(fiscalRegrasVersoes)
      .where(
        and(
          eq(fiscalRegrasVersoes.catalogoVersaoId, catalogoId),
          eq(fiscalRegrasVersoes.chave, chave),
          eq(fiscalRegrasVersoes.ativo, true),
        ),
      )
      .orderBy(desc(fiscalRegrasVersoes.revisao))
      .limit(1);
    return linha;
  }

  /** Catálogo novo da UF: cobre o ano e termina antes de um posterior. */
  private async criarCatalogo(
    db: Banco,
    tipo: TipoCatalogo,
    input: QueryIcmsRegrasDto,
    fonte: string,
    fonteUrl: string | null,
  ) {
    const competencia = `${input.competencia}-01`;
    const ano = input.competencia.slice(0, 4);
    const [proximo] = await db
      .select({ inicio: fiscalCatalogosVersoes.vigenciaInicio })
      .from(fiscalCatalogosVersoes)
      .where(
        and(
          eq(fiscalCatalogosVersoes.tipo, tipo),
          eq(fiscalCatalogosVersoes.uf, input.uf),
          eq(fiscalCatalogosVersoes.ativo, true),
          gte(fiscalCatalogosVersoes.vigenciaInicio, competencia),
        ),
      )
      .orderBy(asc(fiscalCatalogosVersoes.vigenciaInicio))
      .limit(1);
    let fim = `${ano}-12-31`;
    if (proximo) {
      const dia = new Date(`${proximo.inicio}T00:00:00Z`);
      dia.setUTCDate(dia.getUTCDate() - 1);
      const anterior = dia.toISOString().slice(0, 10);
      if (anterior < fim) fim = anterior;
    }
    const [criado] = await db
      .insert(fiscalCatalogosVersoes)
      .values({
        tipo,
        uf: input.uf,
        codigo: `${tipo}_${input.uf}_${ano}`,
        descricao: `${tipo === 'DIFAL' ? 'DIFAL' : 'ST/FCP'} ${input.uf} ${ano}`,
        fonte,
        fonteUrl,
        vigenciaInicio: `${ano}-01-01`,
        vigenciaFim: fim,
        conteudo: {},
        escopoAprovado: false,
      })
      .returning();
    if (!criado)
      throw new BadRequestException('Não foi possível criar o catálogo.');
    return criado;
  }

  private async gravarRevisao(
    db: Banco,
    dados: {
      catalogo: typeof fiscalCatalogosVersoes.$inferSelect;
      chave: string;
      revisao: number;
      conteudo: Record<string, unknown>;
      fonte: string;
      fonteUrl: string | null;
      aprovar: boolean;
      userId: string;
    },
  ) {
    const agora = new Date();
    await db.insert(fiscalRegrasVersoes).values({
      catalogoVersaoId: dados.catalogo.id,
      chave: dados.chave,
      revisao: dados.revisao,
      conteudo: dados.conteudo,
      fonte: dados.fonte,
      fonteUrl: dados.fonteUrl,
      responsavelPor: dados.userId,
      vigenciaInicio: dados.catalogo.vigenciaInicio,
      vigenciaFim: dados.catalogo.vigenciaFim,
      // Aprovação por regra, sempre explícita: uma revisão nova nunca herda
      // a homologação do catálogo.
      escopoAprovado: dados.aprovar,
      aprovadoPor: dados.aprovar ? dados.userId : null,
      aprovadoEm: dados.aprovar ? agora : null,
    });
    return {
      catalogoId: dados.catalogo.id,
      chave: dados.chave,
      revisao: dados.revisao,
      aprovada: dados.aprovar,
    };
  }

  private resumoCatalogo(c: typeof fiscalCatalogosVersoes.$inferSelect) {
    return {
      id: c.id,
      uf: c.uf,
      vigenciaInicio: c.vigenciaInicio,
      vigenciaFim: c.vigenciaFim,
      fonte: c.fonte,
      fonteUrl: c.fonteUrl,
    };
  }

  private resumoRegra(
    r: typeof fiscalRegrasVersoes.$inferSelect | undefined,
    c: typeof fiscalCatalogosVersoes.$inferSelect,
  ) {
    if (!r) return null;
    return {
      id: r.id,
      chave: r.chave,
      revisao: r.revisao,
      fonte: r.fonte,
      fonteUrl: r.fonteUrl,
      aprovada: (r.escopoAprovado ?? c.escopoAprovado) === true,
      aprovadoEm: r.aprovadoEm,
      conteudo: r.conteudo,
    };
  }
}
