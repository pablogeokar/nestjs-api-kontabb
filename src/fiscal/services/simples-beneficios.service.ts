import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service';
import {
  eventosAuditoria,
  fiscalSimplesBeneficios,
} from '../../database/schema';
import { toScaledInteger } from '../sped/sped-decimal';
import { regrasBeneficioConflitam } from './simples-beneficios';
import type { SalvarSimplesBeneficioDto } from '../dto/simples-beneficio.dto';

@Injectable()
export class SimplesBeneficiosService {
  constructor(private readonly database: DatabaseService) {}
  async listar() {
    return this.database.db
      .select()
      .from(fiscalSimplesBeneficios)
      .where(eq(fiscalSimplesBeneficios.atual, true))
      .orderBy(
        asc(fiscalSimplesBeneficios.uf),
        asc(fiscalSimplesBeneficios.codigo),
      );
  }
  async salvar(input: SalvarSimplesBeneficioDto, actorUserId: string) {
    const percentual = toScaledInteger(input.percentualReducao, 4);
    if (
      percentual <= 0n ||
      percentual > 10000n ||
      (input.tipo === 'ISENCAO' && percentual !== 10000n)
    )
      throw new BadRequestException(
        'Percentual inválido. Isenção exige 100%; redução deve estar entre 0,01% e 100%.',
      );
    if (
      input.vigenciaFim < input.vigenciaInicio ||
      input.vigenciaInicio < '2018-01-01' ||
      toScaledInteger(input.receitaDe) > toScaledInteger(input.receitaAte)
    )
      throw new BadRequestException(
        'Confira a vigência e os limites da receita.',
      );
    const { versaoAnterior, ...dados } = input;
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended('simples-beneficios', 0))`,
      );
      const atuais = await tx
        .select()
        .from(fiscalSimplesBeneficios)
        .where(eq(fiscalSimplesBeneficios.atual, true));
      const anterior = atuais.find((item) => item.codigo === input.codigo);
      if ((anterior?.versao ?? 0) !== versaoAnterior)
        throw new ConflictException(
          'Este benefício foi alterado. Atualize a página antes de salvar.',
        );
      const nova = {
        ...dados,
        id: '',
        versao: versaoAnterior + 1,
        atual: true,
      };
      if (
        atuais.some(
          (item) =>
            item.codigo !== input.codigo &&
            regrasBeneficioConflitam(item, nova),
        )
      )
        throw new ConflictException(
          'Há outro benefício ativo para a mesma UF, atividade, vigência e faixa de receita. As reduções não são cumulativas.',
        );
      if (anterior)
        await tx
          .update(fiscalSimplesBeneficios)
          .set({ atual: false })
          .where(
            and(
              eq(fiscalSimplesBeneficios.id, anterior.id),
              eq(fiscalSimplesBeneficios.atual, true),
            ),
          );
      const [row] = await tx
        .insert(fiscalSimplesBeneficios)
        .values({ ...dados, versao: nova.versao })
        .returning();
      await tx.insert(eventosAuditoria).values({
        atorUserId: actorUserId,
        acao: 'SIMPLES_BENEFICIO_VERSIONADO',
        entidadeTipo: 'FISCAL_SIMPLES_BENEFICIO',
        entidadeId: row.id,
        dados: { anterior: anterior ?? null, atual: row },
      });
      return row;
    });
  }
}
