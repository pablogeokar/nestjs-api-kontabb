import { Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service';
import {
  clientes,
  spedConfiguracoes,
  spedContabilistas,
} from '../../database/schema';
import type { AtualizarSpedConfiguracaoDto } from './dto/sped-efd.dto';

@Injectable()
export class SpedConfiguracaoService {
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
        cep: clientes.cep,
        logradouro: clientes.logradouro,
        numero: clientes.numero,
        complemento: clientes.complemento,
        bairro: clientes.bairro,
        municipio: clientes.municipio,
        emails: clientes.emails,
        configuracaoId: spedConfiguracoes.id,
        obrigadoEfdIcmsIpi: spedConfiguracoes.obrigadoEfdIcmsIpi,
        perfilEfd: spedConfiguracoes.perfilEfd,
        indAtiv: spedConfiguracoes.indAtiv,
        classificacaoEstabelecimentoIndustrial:
          spedConfiguracoes.classificacaoEstabelecimentoIndustrial,
        codigoMunicipioIbge: spedConfiguracoes.codigoMunicipioIbge,
        nomeFantasia: spedConfiguracoes.nomeFantasia,
        inscricaoMunicipal: spedConfiguracoes.inscricaoMunicipal,
        suframa: spedConfiguracoes.suframa,
        telefone: spedConfiguracoes.telefone,
        fax: spedConfiguracoes.fax,
        inventarioObrigatorio: spedConfiguracoes.inventarioObrigatorio,
        blocoKComMovimento: spedConfiguracoes.blocoKComMovimento,
        tipoItemPadrao: spedConfiguracoes.tipoItemPadrao,
        indicadores1010: spedConfiguracoes.indicadores1010,
        contabilistaId: spedContabilistas.id,
        contabilistaNome: spedContabilistas.nome,
        contabilistaCpf: spedContabilistas.cpf,
        contabilistaCrc: spedContabilistas.crc,
        contabilistaCnpj: spedContabilistas.cnpj,
        contabilistaCep: spedContabilistas.cep,
        contabilistaLogradouro: spedContabilistas.logradouro,
        contabilistaNumero: spedContabilistas.numero,
        contabilistaComplemento: spedContabilistas.complemento,
        contabilistaBairro: spedContabilistas.bairro,
        contabilistaTelefone: spedContabilistas.telefone,
        contabilistaFax: spedContabilistas.fax,
        contabilistaEmail: spedContabilistas.email,
        contabilistaCodigoMunicipioIbge: spedContabilistas.codigoMunicipioIbge,
      })
      .from(clientes)
      .leftJoin(spedConfiguracoes, eq(spedConfiguracoes.clienteId, clientes.id))
      .leftJoin(spedContabilistas, eq(spedContabilistas.clienteId, clientes.id))
      .where(eq(clientes.id, clienteId))
      .limit(1);

    const row = rows[0];
    if (!row) throw new NotFoundException('Empresa não encontrada.');

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
      configurado: Boolean(row.configuracaoId && row.contabilistaId),
      obrigadoEfdIcmsIpi: row.obrigadoEfdIcmsIpi ?? false,
      perfilEfd: row.perfilEfd,
      indAtiv: row.indAtiv,
      classificacaoEstabelecimentoIndustrial:
        row.classificacaoEstabelecimentoIndustrial,
      codigoMunicipioIbge: row.codigoMunicipioIbge,
      nomeFantasia: row.nomeFantasia,
      inscricaoMunicipal: row.inscricaoMunicipal,
      suframa: row.suframa,
      telefone: row.telefone,
      fax: row.fax,
      inventarioObrigatorio: row.inventarioObrigatorio ?? false,
      blocoKComMovimento: row.blocoKComMovimento ?? false,
      tipoItemPadrao: row.tipoItemPadrao ?? '00',
      indicadores1010: row.indicadores1010 ?? {},
      contabilista: row.contabilistaId
        ? {
            nome: row.contabilistaNome,
            cpf: row.contabilistaCpf,
            crc: row.contabilistaCrc,
            cnpj: row.contabilistaCnpj,
            cep: row.contabilistaCep,
            logradouro: row.contabilistaLogradouro,
            numero: row.contabilistaNumero,
            complemento: row.contabilistaComplemento,
            bairro: row.contabilistaBairro,
            telefone: row.contabilistaTelefone,
            fax: row.contabilistaFax,
            email: row.contabilistaEmail,
            codigoMunicipioIbge: row.contabilistaCodigoMunicipioIbge,
          }
        : null,
      dadosCadastrais: {
        cep: row.cep,
        logradouro: row.logradouro,
        numero: row.numero,
        complemento: row.complemento,
        bairro: row.bairro,
        emails: row.emails,
      },
    };
  }

  async atualizar(input: {
    clienteId: string;
    actorUserId: string;
    data: AtualizarSpedConfiguracaoDto;
  }) {
    const existing = await this.database.db
      .select({ id: clientes.id })
      .from(clientes)
      .where(eq(clientes.id, input.clienteId))
      .limit(1);
    if (!existing[0]) throw new NotFoundException('Empresa não encontrada.');

    const now = new Date();
    const data = input.data;
    await this.database.db.transaction(async (tx) => {
      await tx
        .insert(spedConfiguracoes)
        .values({
          clienteId: input.clienteId,
          obrigadoEfdIcmsIpi: data.obrigadoEfdIcmsIpi,
          perfilEfd: data.perfilEfd,
          indAtiv: data.indAtiv,
          classificacaoEstabelecimentoIndustrial:
            data.classificacaoEstabelecimentoIndustrial ?? null,
          codigoMunicipioIbge: data.codigoMunicipioIbge,
          nomeFantasia: data.nomeFantasia ?? null,
          inscricaoMunicipal: data.inscricaoMunicipal ?? null,
          suframa: data.suframa ?? null,
          telefone: data.telefone ?? null,
          fax: data.fax ?? null,
          inventarioObrigatorio: data.inventarioObrigatorio,
          blocoKComMovimento: data.blocoKComMovimento,
          tipoItemPadrao: data.tipoItemPadrao,
          indicadores1010: this.normalizarIndicadores1010(data.indicadores1010),
          atualizadoPor: input.actorUserId,
          atualizadoEm: now,
        })
        .onConflictDoUpdate({
          target: spedConfiguracoes.clienteId,
          set: {
            obrigadoEfdIcmsIpi: data.obrigadoEfdIcmsIpi,
            perfilEfd: data.perfilEfd,
            indAtiv: data.indAtiv,
            classificacaoEstabelecimentoIndustrial:
              data.classificacaoEstabelecimentoIndustrial ?? null,
            codigoMunicipioIbge: data.codigoMunicipioIbge,
            nomeFantasia: data.nomeFantasia ?? null,
            inscricaoMunicipal: data.inscricaoMunicipal ?? null,
            suframa: data.suframa ?? null,
            telefone: data.telefone ?? null,
            fax: data.fax ?? null,
            inventarioObrigatorio: data.inventarioObrigatorio,
            blocoKComMovimento: data.blocoKComMovimento,
            tipoItemPadrao: data.tipoItemPadrao,
            indicadores1010: this.normalizarIndicadores1010(
              data.indicadores1010,
            ),
            atualizadoPor: input.actorUserId,
            atualizadoEm: now,
          },
        });

      const contabilista = data.contabilista;
      await tx
        .insert(spedContabilistas)
        .values({
          clienteId: input.clienteId,
          nome: contabilista.nome,
          cpf: contabilista.cpf ?? null,
          crc: contabilista.crc,
          cnpj: contabilista.cnpj ?? null,
          cep: contabilista.cep ?? null,
          logradouro: contabilista.logradouro ?? null,
          numero: contabilista.numero ?? null,
          complemento: contabilista.complemento ?? null,
          bairro: contabilista.bairro ?? null,
          telefone: contabilista.telefone ?? null,
          fax: contabilista.fax ?? null,
          email: contabilista.email ?? null,
          codigoMunicipioIbge: contabilista.codigoMunicipioIbge,
          atualizadoPor: input.actorUserId,
          atualizadoEm: now,
        })
        .onConflictDoUpdate({
          target: spedContabilistas.clienteId,
          set: {
            nome: contabilista.nome,
            cpf: contabilista.cpf ?? null,
            crc: contabilista.crc,
            cnpj: contabilista.cnpj ?? null,
            cep: contabilista.cep ?? null,
            logradouro: contabilista.logradouro ?? null,
            numero: contabilista.numero ?? null,
            complemento: contabilista.complemento ?? null,
            bairro: contabilista.bairro ?? null,
            telefone: contabilista.telefone ?? null,
            fax: contabilista.fax ?? null,
            email: contabilista.email ?? null,
            codigoMunicipioIbge: contabilista.codigoMunicipioIbge,
            atualizadoPor: input.actorUserId,
            atualizadoEm: now,
          },
        });
    });

    return this.obter(input.clienteId);
  }

  private normalizarIndicadores1010(
    value: Record<string, 'S' | 'N'> | undefined,
  ) {
    const allowed = [
      'IND_EXP',
      'IND_CCRF',
      'IND_COMB',
      'IND_USINA',
      'IND_VA',
      'IND_EE',
      'IND_CART',
      'IND_FORM',
      'IND_AER',
      'IND_GIAF1',
      'IND_GIAF3',
      'IND_GIAF4',
      'IND_REST_RESSARC_COMPL_ICMS',
    ];
    return Object.fromEntries(
      allowed.map((key) => [key, value?.[key] === 'S' ? 'S' : 'N']),
    ) as Record<string, 'S' | 'N'>;
  }
}
