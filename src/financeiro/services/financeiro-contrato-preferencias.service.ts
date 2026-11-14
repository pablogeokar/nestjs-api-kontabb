import { Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service';
import { financeiroContratoPreferencias } from '../../database/schema';
import type { ContratoPreferenciasDto } from '../dto/contrato-preferencias.dto';

const DEFAULTS = {
  localAssinatura: '',
  diaVencimento: 10,
  diaFechamento: 25,
  avisoPrevioDias: 30,
  gera13o: false,
  mes13o: 12,
};

@Injectable()
export class FinanceiroContratoPreferenciasService {
  constructor(private readonly database: DatabaseService) {}

  async get(usuarioId: string) {
    const [row] = await this.database.db
      .select()
      .from(financeiroContratoPreferencias)
      .where(eq(financeiroContratoPreferencias.usuarioId, usuarioId))
      .limit(1);
    return row
      ? {
          localAssinatura: row.localAssinatura,
          diaVencimento: row.diaVencimento,
          diaFechamento: row.diaFechamento,
          avisoPrevioDias: row.avisoPrevioDias,
          gera13o: row.gera13o,
          mes13o: row.mes13o,
        }
      : DEFAULTS;
  }

  async put(usuarioId: string, dto: ContratoPreferenciasDto) {
    const values = {
      localAssinatura: dto.localAssinatura.trim(),
      diaVencimento: dto.diaVencimento,
      diaFechamento: dto.diaFechamento,
      avisoPrevioDias: dto.avisoPrevioDias,
      gera13o: dto.gera13o,
      mes13o: dto.mes13o,
    };
    await this.database.db
      .insert(financeiroContratoPreferencias)
      .values({ usuarioId, ...values })
      .onConflictDoUpdate({
        target: financeiroContratoPreferencias.usuarioId,
        set: { ...values, atualizadoEm: sql`NOW()` },
      });
    return values;
  }
}
