/*
 * Cadastra um rascunho normativo restrito à BA e à competência 10/2026.
 * A homologação fiscal permanece desligada: nenhuma simulação vira guia.
 * Execute com: node --env-file=.env scripts/cadastrar-antecipacao-ba-2026-10.cjs --execute
 */
const { createHash } = require('node:crypto');
const postgres = require('postgres');

const ANEXO_2026 =
  'https://mbusca.sefaz.ba.gov.br/DITRI/normas_complementares/decretos/decreto_2012_13780_ricms_anexo_1_vigente_2026.pdf';
const LEI_14629 =
  'https://mbusca.sefaz.ba.gov.br/DITRI/leis/leis_estaduais/legest_2023_14629.pdf';
const LEI_7014 =
  'https://mbusca.sefaz.ba.gov.br/DITRI/leis/leis_estaduais/legest_1996_7014_icmscomnotas.pdf';

const enquadramentos = [
  {
    ncm: '19053100', cest: '1705302', regime: 'SIMPLES_NACIONAL',
    uf_origem: 'SE', origem_mercadoria: '0', tratamento: 'APLICAVEL',
    aliquota_interna: '20.5', aliquota_interestadual: '12',
    fundamento: 'RICMS-BA Anexo 1/2026, item 11.11.2 revogado; Lei 7.014/96, art. 15, I; RICMS-BA, art. 321, VII, b.',
    revisao_fiscal: 'Confirmar descrição do produto e ausência de benefício específico antes de homologar.',
  },
  {
    ncm: '19053100', cest: '1705301', regime: 'SIMPLES_NACIONAL',
    uf_origem: 'SE', origem_mercadoria: '0', tratamento: 'CONFERIR',
    motivo: 'O mesmo CEST aparece nas descrições Maizena e Coquinho; conferir a classificação comercial e a alíquota antes de homologar.',
  },
  {
    ncm: '38089419', cest: null, regime: 'SIMPLES_NACIONAL',
    uf_origem: 'MG', origem_mercadoria: '5', tratamento: 'CONFERIR',
    motivo: 'Há IPI no XML e origem de mercadoria 5 com alíquota interestadual destacada de 7%; conferir base e alíquota aplicável.',
  },
  {
    ncm: '38089429', cest: null, regime: 'SIMPLES_NACIONAL',
    uf_origem: 'MG', origem_mercadoria: '5', tratamento: 'CONFERIR',
    motivo: 'Há IPI no XML e origem de mercadoria 5 com alíquota interestadual destacada de 7%; conferir base e alíquota aplicável.',
  },
  {
    ncm: '34012010', cest: '2003600', regime: 'SIMPLES_NACIONAL',
    uf_origem: 'MG', origem_mercadoria: '5', tratamento: 'CONFERIR',
    motivo: 'Há IPI no XML, origem 5 e CEST de higiene; conferir enquadramento de ST, base e alíquota aplicável.',
  },
  {
    ncm: '84248990', cest: '2109900', regime: 'SIMPLES_NACIONAL',
    uf_origem: 'MG', origem_mercadoria: '0', tratamento: 'CONFERIR',
    motivo: 'Conferir a descrição e o CEST 21.099.00 antes de afastar ST e definir alíquota interna.',
  },
];

const conteudo = { enquadramentos, fontes: [ANEXO_2026, LEI_14629, LEI_7014] };
const catalogoConteudo = { status: 'RASCUNHO', competencia: '2026-10', ...conteudo };
const hash = createHash('sha256').update(JSON.stringify(catalogoConteudo)).digest('hex');

async function main() {
  if (process.argv[2] !== '--execute') {
    process.stdout.write(JSON.stringify({ modo: 'preview', uf: 'BA', competencia: '2026-10',
      escopo_aprovado: false, enquadramentos }, null, 2) + '\n');
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não configurada.');
  const db = postgres(process.env.DATABASE_URL, { max: 1 });
  try {
    const result = await db.begin(async (sql) => {
      await sql`select pg_advisory_xact_lock(hashtext('antecipacao-ba-2026-10'))`;
      const existentes = await sql`
        select id, escopo_aprovado from fiscal_catalogos_versoes
        where tipo = 'DIFAL' and uf = 'BA' and vigencia_inicio = '2026-10-01'
      `;
      if (existentes[0]?.escopo_aprovado) {
        throw new Error('Já existe catálogo homologado para BA/10-2026; revisão manual necessária.');
      }
      const catalogo = existentes[0] ?? (await sql`
        insert into fiscal_catalogos_versoes
          (tipo, uf, codigo, descricao, fonte, fonte_url, hash_conteudo,
           conteudo, vigencia_inicio, vigencia_fim, escopo_aprovado)
        values
          ('DIFAL', 'BA', 'ANTECIPACAO_PARCIAL_BA_2026_10',
           'Rascunho de enquadramentos de Antecipação Parcial da BA para 10/2026',
           'RICMS-BA Anexo 1/2026', ${ANEXO_2026}, ${hash},
           ${sql.json(catalogoConteudo)},
           '2026-10-01', '2026-10-31', false)
        returning id, escopo_aprovado
      `)[0];

      const regras = await sql`
        select id, conteudo = ${sql.json(conteudo)}::jsonb as igual
        from fiscal_regras_versoes
        where catalogo_versao_id = ${catalogo.id}
          and chave = 'ANTECIPACAO_PARCIAL' and ativo = true
      `;
      if (regras.length > 1 || (regras.length === 1 && !regras[0].igual)) {
        throw new Error('Já existe regra diferente para esta competência; não sobrescrever a revisão.');
      }
      if (regras.length === 0) {
        await sql`
          insert into fiscal_regras_versoes
            (catalogo_versao_id, chave, revisao, conteudo, fonte, fonte_url,
             vigencia_inicio, vigencia_fim, ativo)
          values
            (${catalogo.id}, 'ANTECIPACAO_PARCIAL', 1, ${sql.json(conteudo)},
             'RICMS-BA arts. 274/321 e Anexo 1/2026', ${ANEXO_2026},
             '2026-10-01', '2026-10-31', true)
        `;
      }
      return { catalogo_id: catalogo.id, regra_criada: regras.length === 0,
        escopo_aprovado: false, enquadramentos: enquadramentos.length };
    });
    process.stdout.write(JSON.stringify(result) + '\n');
  } finally {
    await db.end({ timeout: 5 });
  }
}

main().catch((error) => {
  process.stderr.write(`Falha no cadastro: ${error.message}\n`);
  process.exitCode = 1;
});
