import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service';
import { clientesPerfisFiscais } from '../../database/schema';
import type { PerfilFiscalLinha } from './estabelecimento-perfil';

/** Carrega o histórico fiscal do estabelecimento (UF, IE, regime). */
@Injectable()
export class EstabelecimentoPerfilService {
  constructor(private readonly database: DatabaseService) {}

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
      .where(eq(clientesPerfisFiscais.clienteId, clienteId));
    return rows.map((r) => ({ ...r, vigenciaFim: r.vigenciaFim ?? null }));
  }
}
