import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq, sql } from 'drizzle-orm';
import postgres from 'postgres';
import {
  fiscalSimplesAnexos,
  fiscalSimplesFaixas,
  fiscalSimplesSublimites,
  fiscalSimplesTabelas,
} from '../schema';

export const SIMPLES_TABELA_VERSAO = 'LC_155_2016_VIGENTE';

type Anexo = 'ANEXO_I' | 'ANEXO_II' | 'ANEXO_III' | 'ANEXO_IV' | 'ANEXO_V';
type Tributo =
  'irpj' | 'csll' | 'cofins' | 'pis' | 'cpp' | 'ipi' | 'icms' | 'iss';
type Partilha = Record<Tributo, string>;

interface FaixaSeed {
  aliquota: string;
  deducao: string;
  partilha: Partilha;
}

interface AnexoSeed {
  anexo: Anexo;
  descricao: string;
  tipoAtividade: 'COMERCIO' | 'INDUSTRIA' | 'SERVICOS' | 'LOCACAO';
  permiteFatorR: boolean;
  recolheCppNoDas: boolean;
  faixas: FaixaSeed[];
}

const zero = '0.0000';
const p = (
  irpj: string,
  csll: string,
  cofins: string,
  pis: string,
  cpp: string,
  ipi: string,
  icms: string,
  iss: string,
): Partilha => ({ irpj, csll, cofins, pis, cpp, ipi, icms, iss });

export const SIMPLES_ANEXOS_SEED: AnexoSeed[] = [
  {
    anexo: 'ANEXO_I',
    descricao: 'Comércio — revenda de mercadorias',
    tipoAtividade: 'COMERCIO',
    permiteFatorR: false,
    recolheCppNoDas: true,
    faixas: [
      ...['0.0400', '0.0730'].map((aliquota, index) => ({
        aliquota,
        deducao: index === 0 ? '0.00' : '5940.00',
        partilha: p(
          '0.0550',
          '0.0350',
          '0.1274',
          '0.0276',
          '0.4150',
          zero,
          '0.3400',
          zero,
        ),
      })),
      ...['0.0950', '0.1070', '0.1430'].map((aliquota, index) => ({
        aliquota,
        deducao: ['13860.00', '22500.00', '87300.00'][index],
        partilha: p(
          '0.0550',
          '0.0350',
          '0.1274',
          '0.0276',
          '0.4200',
          zero,
          '0.3350',
          zero,
        ),
      })),
      {
        aliquota: '0.1900',
        deducao: '378000.00',
        partilha: p(
          '0.1350',
          '0.1000',
          '0.2827',
          '0.0613',
          '0.4210',
          zero,
          zero,
          zero,
        ),
      },
    ],
  },
  {
    anexo: 'ANEXO_II',
    descricao: 'Indústria',
    tipoAtividade: 'INDUSTRIA',
    permiteFatorR: false,
    recolheCppNoDas: true,
    faixas: [
      ...['0.0450', '0.0780', '0.1000', '0.1120', '0.1470'].map(
        (aliquota, index) => ({
          aliquota,
          deducao: ['0.00', '5940.00', '13860.00', '22500.00', '85500.00'][
            index
          ],
          partilha: p(
            '0.0550',
            '0.0350',
            '0.1151',
            '0.0249',
            '0.3750',
            '0.0750',
            '0.3200',
            zero,
          ),
        }),
      ),
      {
        aliquota: '0.3000',
        deducao: '540000.00',
        partilha: p(
          '0.0850',
          '0.0750',
          '0.2096',
          '0.0454',
          '0.2350',
          '0.3500',
          zero,
          zero,
        ),
      },
    ],
  },
  {
    anexo: 'ANEXO_III',
    descricao:
      'Serviços em geral e atividades com Fator R igual ou superior a 28%',
    tipoAtividade: 'SERVICOS',
    permiteFatorR: true,
    recolheCppNoDas: true,
    faixas: [
      ...['0.0600', '0.1120', '0.1350', '0.1600', '0.2100'].map(
        (aliquota, index) => ({
          aliquota,
          deducao: ['0.00', '9360.00', '17640.00', '35640.00', '125640.00'][
            index
          ],
          partilha: p(
            '0.0400',
            '0.0350',
            '0.1282',
            '0.0278',
            '0.4340',
            zero,
            zero,
            '0.3350',
          ),
        }),
      ),
      {
        aliquota: '0.3300',
        deducao: '648000.00',
        partilha: p(
          '0.3500',
          '0.1500',
          '0.1603',
          '0.0347',
          '0.3050',
          zero,
          zero,
          zero,
        ),
      },
    ],
  },
  {
    anexo: 'ANEXO_IV',
    descricao: 'Serviços sem CPP unificada no DAS',
    tipoAtividade: 'SERVICOS',
    permiteFatorR: false,
    recolheCppNoDas: false,
    faixas: [
      {
        aliquota: '0.0450',
        deducao: '0.00',
        partilha: p(
          '0.1880',
          '0.1520',
          '0.1767',
          '0.0383',
          zero,
          zero,
          zero,
          '0.4450',
        ),
      },
      {
        aliquota: '0.0900',
        deducao: '8100.00',
        partilha: p(
          '0.1980',
          '0.1520',
          '0.2055',
          '0.0445',
          zero,
          zero,
          zero,
          '0.4000',
        ),
      },
      {
        aliquota: '0.1020',
        deducao: '12420.00',
        partilha: p(
          '0.2080',
          '0.1520',
          '0.1973',
          '0.0427',
          zero,
          zero,
          zero,
          '0.4000',
        ),
      },
      {
        aliquota: '0.1400',
        deducao: '39780.00',
        partilha: p(
          '0.1780',
          '0.1920',
          '0.1890',
          '0.0410',
          zero,
          zero,
          zero,
          '0.4000',
        ),
      },
      {
        aliquota: '0.2200',
        deducao: '183780.00',
        partilha: p(
          '0.1880',
          '0.1920',
          '0.1808',
          '0.0392',
          zero,
          zero,
          zero,
          '0.4000',
        ),
      },
      {
        aliquota: '0.3300',
        deducao: '828000.00',
        partilha: p(
          '0.5350',
          '0.2150',
          '0.2055',
          '0.0445',
          zero,
          zero,
          zero,
          zero,
        ),
      },
    ],
  },
  {
    anexo: 'ANEXO_V',
    descricao: 'Serviços sujeitos ao Fator R inferior a 28%',
    tipoAtividade: 'SERVICOS',
    permiteFatorR: true,
    recolheCppNoDas: true,
    faixas: [
      {
        aliquota: '0.1550',
        deducao: '0.00',
        partilha: p(
          '0.2500',
          '0.1500',
          '0.1410',
          '0.0305',
          '0.2885',
          zero,
          zero,
          '0.1400',
        ),
      },
      {
        aliquota: '0.1800',
        deducao: '4500.00',
        partilha: p(
          '0.2300',
          '0.1500',
          '0.1410',
          '0.0305',
          '0.2785',
          zero,
          zero,
          '0.1700',
        ),
      },
      {
        aliquota: '0.1950',
        deducao: '9900.00',
        partilha: p(
          '0.2400',
          '0.1500',
          '0.1492',
          '0.0323',
          '0.2385',
          zero,
          zero,
          '0.1900',
        ),
      },
      {
        aliquota: '0.2050',
        deducao: '17100.00',
        partilha: p(
          '0.2100',
          '0.1500',
          '0.1574',
          '0.0341',
          '0.2385',
          zero,
          zero,
          '0.2100',
        ),
      },
      {
        aliquota: '0.2300',
        deducao: '62100.00',
        partilha: p(
          '0.2300',
          '0.1250',
          '0.1410',
          '0.0305',
          '0.2385',
          zero,
          zero,
          '0.2350',
        ),
      },
      {
        aliquota: '0.3050',
        deducao: '540000.00',
        partilha: p(
          '0.3500',
          '0.1550',
          '0.1644',
          '0.0356',
          '0.2950',
          zero,
          zero,
          zero,
        ),
      },
    ],
  },
];

const LIMITES = [
  ['0.00', '180000.00'],
  ['180000.01', '360000.00'],
  ['360000.01', '720000.00'],
  ['720000.01', '1800000.00'],
  ['1800000.01', '3600000.00'],
  ['3600000.01', '4800000.00'],
] as const;

const UFS = [
  'AC',
  'AL',
  'AP',
  'AM',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MT',
  'MS',
  'MG',
  'PA',
  'PB',
  'PR',
  'PE',
  'PI',
  'RJ',
  'RN',
  'RS',
  'RO',
  'RR',
  'SC',
  'SP',
  'SE',
  'TO',
] as const;

export async function seedSimplesNacional(
  databaseUrl: string,
  ano = new Date().getFullYear(),
) {
  const client = postgres(databaseUrl, { max: 1 });
  const database = drizzle(client);
  try {
    await database.transaction(async (tx) => {
      const [tabela] = await tx
        .insert(fiscalSimplesTabelas)
        .values({
          versao: SIMPLES_TABELA_VERSAO,
          descricao:
            'Tabelas do Simples Nacional vigentes a partir de 2018 (LC 123/2006, redação da LC 155/2016)',
          vigenciaInicio: '2018-01-01',
          ativo: true,
        })
        .onConflictDoUpdate({
          target: fiscalSimplesTabelas.versao,
          set: {
            descricao: sql`excluded.descricao`,
            vigenciaInicio: sql`excluded.vigencia_inicio`,
            ativo: true,
          },
        })
        .returning({ id: fiscalSimplesTabelas.id });

      for (const anexoSeed of SIMPLES_ANEXOS_SEED) {
        const [anexo] = await tx
          .insert(fiscalSimplesAnexos)
          .values({
            tabelaId: tabela.id,
            anexo: anexoSeed.anexo,
            descricao: anexoSeed.descricao,
            tipoAtividade: anexoSeed.tipoAtividade,
            permiteFatorR: anexoSeed.permiteFatorR,
            recolheCppNoDas: anexoSeed.recolheCppNoDas,
          })
          .onConflictDoUpdate({
            target: [fiscalSimplesAnexos.tabelaId, fiscalSimplesAnexos.anexo],
            set: {
              descricao: anexoSeed.descricao,
              tipoAtividade: anexoSeed.tipoAtividade,
              permiteFatorR: anexoSeed.permiteFatorR,
              recolheCppNoDas: anexoSeed.recolheCppNoDas,
            },
          })
          .returning({ id: fiscalSimplesAnexos.id });

        for (const [index, faixa] of anexoSeed.faixas.entries()) {
          const [rbt12De, rbt12Ate] = LIMITES[index];
          await tx
            .insert(fiscalSimplesFaixas)
            .values({
              anexoId: anexo.id,
              faixa: index + 1,
              rbt12De,
              rbt12Ate,
              aliquotaNominal: faixa.aliquota,
              parcelaDeduzir: faixa.deducao,
              percentualIrpj: faixa.partilha.irpj,
              percentualCsll: faixa.partilha.csll,
              percentualCofins: faixa.partilha.cofins,
              percentualPis: faixa.partilha.pis,
              percentualCpp: faixa.partilha.cpp,
              percentualIpi: faixa.partilha.ipi,
              percentualIcms: faixa.partilha.icms,
              percentualIss: faixa.partilha.iss,
            })
            .onConflictDoUpdate({
              target: [fiscalSimplesFaixas.anexoId, fiscalSimplesFaixas.faixa],
              set: {
                rbt12De,
                rbt12Ate,
                aliquotaNominal: faixa.aliquota,
                parcelaDeduzir: faixa.deducao,
                percentualIrpj: faixa.partilha.irpj,
                percentualCsll: faixa.partilha.csll,
                percentualCofins: faixa.partilha.cofins,
                percentualPis: faixa.partilha.pis,
                percentualCpp: faixa.partilha.cpp,
                percentualIpi: faixa.partilha.ipi,
                percentualIcms: faixa.partilha.icms,
                percentualIss: faixa.partilha.iss,
              },
            });
        }
      }

      for (const uf of UFS) {
        const existente = await tx
          .select({ id: fiscalSimplesSublimites.id })
          .from(fiscalSimplesSublimites)
          .where(
            and(
              eq(fiscalSimplesSublimites.uf, uf),
              eq(fiscalSimplesSublimites.anoVigencia, ano),
            ),
          )
          .limit(1);
        if (existente.length) {
          await tx
            .update(fiscalSimplesSublimites)
            .set({ valorSublimite: '3600000.00', ativo: true })
            .where(eq(fiscalSimplesSublimites.id, existente[0].id));
        } else {
          await tx.insert(fiscalSimplesSublimites).values({
            uf,
            anoVigencia: ano,
            valorSublimite: '3600000.00',
            ativo: true,
          });
        }
      }
    });
  } finally {
    await client.end({ timeout: 5 });
  }
}

if (require.main === module) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL não configurada.');
  void seedSimplesNacional(databaseUrl)
    .then(() =>
      process.stdout.write(
        'Seed do Simples Nacional concluído: 5 anexos, 30 faixas e 27 UFs.\n',
      ),
    )
    .catch((error: unknown) => {
      process.stderr.write(
        `Falha ao executar seed do Simples Nacional: ${error instanceof Error ? error.message : 'erro desconhecido'}\n`,
      );
      process.exitCode = 1;
    });
}
