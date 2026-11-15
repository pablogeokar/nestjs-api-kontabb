import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service';
import { clientes, destdaConfiguracoes } from '../../database/schema';
import { resolverContadorDoCliente } from '../../cadastros/contadores/contador-resolver';
import type { AtualizarDestdaConfiguracaoDto } from './dto/destda.dto';
import { validarPerfil } from './destda-perfil';

@Injectable()
export class DestdaConfiguracaoService {
  constructor(private readonly database: DatabaseService) {}

  async obter(clienteId: string) {
    const rows = await this.database.db
      .select({
        clienteId: clientes.id,
        razaoSocial: clientes.razaoSocial,
        cnpj: clientes.cnpj,
        inscricaoEstadual: clientes.inscricaoEstadual,
        regimeTributario: clientes.regimeTributario,
        uf: clientes.uf,
        municipio: clientes.municipio,
        contadorId: clientes.contadorId,
        cadastroCodigoMunicipioIbge: clientes.codigoMunicipioIbge,
        cadastroNomeFantasia: clientes.nomeFantasia,
        cadastroInscricaoMunicipal: clientes.inscricaoMunicipal,
        cadastroResponsavelNome: clientes.responsavelNome,
        cadastroResponsavelCpf: clientes.responsavelCpf,
        cadastroResponsavelCodAssinante: clientes.responsavelCodAssinante,
        configuracaoId: destdaConfiguracoes.id,
        codigoMunicipioIbge: destdaConfiguracoes.codigoMunicipioIbge,
        nomeFantasia: destdaConfiguracoes.nomeFantasia,
        inscricaoMunicipal: destdaConfiguracoes.inscricaoMunicipal,
        suframa: destdaConfiguracoes.suframa,
        nire: destdaConfiguracoes.nire,
        telefone: destdaConfiguracoes.telefone,
        fax: destdaConfiguracoes.fax,
        responsavelNome: destdaConfiguracoes.responsavelNome,
        responsavelCpf: destdaConfiguracoes.responsavelCpf,
        responsavelCodAssinante: destdaConfiguracoes.responsavelCodAssinante,
        inscricoesSubstituto: destdaConfiguracoes.inscricoesSubstituto,
        perfil: destdaConfiguracoes.perfil,
      })
      .from(clientes)
      .leftJoin(
        destdaConfiguracoes,
        eq(destdaConfiguracoes.clienteId, clientes.id),
      )
      .where(eq(clientes.id, clienteId))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundException('Empresa não encontrada.');
    const resolucao = await resolverContadorDoCliente(
      this.database.db,
      row.contadorId,
    );
    return {
      cliente: {
        id: row.clienteId,
        razaoSocial: row.razaoSocial,
        cnpj: row.cnpj,
        inscricaoEstadual: row.inscricaoEstadual,
        regimeTributario: row.regimeTributario,
        uf: row.uf,
        municipio: row.municipio,
      },
      elegivel: row.regimeTributario === 'SIMPLES_NACIONAL',
      configurado: Boolean(row.configuracaoId),
      // Valores da DeSTDA têm precedência; sem eles, vale o cadastro do cliente.
      codigoMunicipioIbge:
        row.codigoMunicipioIbge ?? row.cadastroCodigoMunicipioIbge,
      nomeFantasia: row.nomeFantasia ?? row.cadastroNomeFantasia,
      inscricaoMunicipal:
        row.inscricaoMunicipal ?? row.cadastroInscricaoMunicipal,
      suframa: row.suframa,
      nire: row.nire,
      telefone: row.telefone,
      fax: row.fax,
      responsavelNome: row.responsavelNome ?? row.cadastroResponsavelNome,
      responsavelCpf: row.responsavelCpf ?? row.cadastroResponsavelCpf,
      responsavelCodAssinante:
        row.responsavelCodAssinante ??
        row.cadastroResponsavelCodAssinante ??
        '801',
      inscricoesSubstituto: row.inscricoesSubstituto ?? [],
      perfil: row.perfil ?? {},
      contabilista: resolucao
        ? {
            id: resolucao.contador.id,
            nome: resolucao.contador.nome,
            origem: resolucao.origem,
          }
        : null,
    };
  }

  async atualizar(input: {
    clienteId: string;
    actorUserId: string;
    data: AtualizarDestdaConfiguracaoDto;
  }) {
    const existente = await this.database.db
      .select({ id: clientes.id })
      .from(clientes)
      .where(eq(clientes.id, input.clienteId))
      .limit(1);
    if (!existente[0]) throw new NotFoundException('Empresa não encontrada.');

    const { data } = input;
    const errosPerfil = validarPerfil(data.perfil ?? {});
    if (errosPerfil.length > 0) {
      throw new BadRequestException({
        code: 'DESTDA_PERFIL_INVALIDO',
        message: errosPerfil.join(' '),
      });
    }
    const ufs = (data.inscricoesSubstituto ?? []).map((item) => item.uf);
    if (new Set(ufs).size !== ufs.length) {
      throw new BadRequestException(
        'Informe no máximo uma inscrição de substituto por UF.',
      );
    }

    const valores = {
      codigoMunicipioIbge: vazioParaNulo(data.codigoMunicipioIbge),
      nomeFantasia: vazioParaNulo(data.nomeFantasia),
      inscricaoMunicipal: vazioParaNulo(data.inscricaoMunicipal),
      suframa: vazioParaNulo(data.suframa),
      nire: vazioParaNulo(data.nire),
      telefone: vazioParaNulo(data.telefone),
      fax: vazioParaNulo(data.fax),
      responsavelNome: vazioParaNulo(data.responsavelNome),
      responsavelCpf: vazioParaNulo(data.responsavelCpf),
      responsavelCodAssinante: data.responsavelCodAssinante ?? null,
      inscricoesSubstituto: (data.inscricoesSubstituto ?? []).map((item) => ({
        uf: item.uf,
        ie: item.ie,
      })),
      perfil: data.perfil ?? {},
      atualizadoPor: input.actorUserId,
      atualizadoEm: new Date(),
    };
    await this.database.db
      .insert(destdaConfiguracoes)
      .values({ clienteId: input.clienteId, ...valores })
      .onConflictDoUpdate({
        target: destdaConfiguracoes.clienteId,
        set: valores,
      });
    return this.obter(input.clienteId);
  }
}

function vazioParaNulo(value: string | null | undefined): string | null {
  const texto = value?.trim();
  return texto ? texto : null;
}
