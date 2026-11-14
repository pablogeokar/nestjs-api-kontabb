/*
 * Seed do motor de regras de ICMS: Antecipação Parcial da BA, ano 2026.
 *
 * Cria UM rascunho (escopo_aprovado = false) com vigência 01/01/2026 a
 * 31/12/2026 e a regra ANTECIPACAO_PARCIAL revisão 1, com os enquadramentos de
 * scripts/data/antecipacao-parcial-ba-2026.enquadramentos.json. Nada é
 * homologado: os itens calculam como SIMULACAO até a revisão fiscal confirmar
 * cada linha e homologar em Cadastros → Fiscal → ICMS (competência 2026-01).
 *
 * Fundamentação e evidências: api/docs/antecipacao-parcial-ba-2026-fundamentacao.md
 *
 * Uso:
 *   node scripts/seed-antecipacao-parcial-ba-2026.cjs              # prévia, sem gravar
 *   node --env-file=.env scripts/seed-antecipacao-parcial-ba-2026.cjs --execute
 *
 * Idempotente: reexecutar com o mesmo conteúdo não grava nada. Aborta se já
 * houver catálogo homologado, regra diferente ou outra vigência sobreposta.
 */
const { createHash } = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');

const ANEXO_1_2026 =
  'https://mbusca.sefaz.ba.gov.br/ditri/normas_complementares/decretos/decreto_2012_13780_ricms_anexo_1_vigente_2026.pdf';
const FONTES = [
  {
    titulo: 'RICMS-BA (Dec. 13.780/12), Anexo 1 – redação vigente 2026',
    url: ANEXO_1_2026,
    sha256: 'd009df80b3897e04377adc82a1a7c0f1ddbec3547a1da1cb69fef54516663b8e',
  },
  {
    titulo: 'RICMS-BA (Dec. 13.780/12), texto com alterações a partir de 2021 (última: Dec. 24.829/26)',
    url: 'https://mbusca.sefaz.ba.gov.br/ditri/normas_complementares/decretos/decreto_2012_13780_ricms_texto_2021.pdf',
    sha256: '9cf243f7693e4d4f29050040a3261bcfac0afcc10400d589447b6278313bca82',
  },
  {
    titulo: 'Lei 7.014/96 (BA) com notas',
    url: 'https://mbusca.sefaz.ba.gov.br/DITRI/leis/leis_estaduais/legest_1996_7014_icmscomnotas.pdf',
    sha256: 'dfcf041095a7834484823c616f251b4612abad67d4c41f37438ad455c724f7a9',
  },
  {
    titulo: 'Convênio ICMS 142/18 (CONFAZ)',
    url: 'https://www.confaz.fazenda.gov.br/legislacao/convenios/2018/CV142_18',
    sha256: 'ae6540b124d1be3653d8ec46ce98be0de93c07d8cd457f1107d0cafe90f0d23a',
  },
  {
    titulo: 'Convênio ICMS 52/91 (CONFAZ)',
    url: 'https://www.confaz.fazenda.gov.br/legislacao/convenios/1991/CV052_91',
    sha256: null,
  },
  {
    titulo: 'Resolução do Senado Federal 22/1989',
    url: 'https://legis.senado.leg.br/norma/586152',
    sha256: null,
  },
  {
    titulo: 'Resolução do Senado Federal 13/2012',
    url: 'https://legis.senado.leg.br/norma/586999/publicacao/15839317',
    sha256: null,
  },
];
const CONSULTADO_EM = '2026-11-14';

const enquadramentos = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, 'data', 'antecipacao-parcial-ba-2026.enquadramentos.json'),
    'utf8',
  ),
);
const conteudo = {
  enquadramentos,
  fontes: FONTES,
  consultado_em: CONSULTADO_EM,
};
const catalogoConteudo = { status: 'RASCUNHO', competencia: '2026-01', ...conteudo };
const hash = createHash('sha256').update(JSON.stringify(catalogoConteudo)).digest('hex');
const FONTE = 'Lei 7.014/96 art.12-A; RICMS-BA art.321; Anexo 1/2026'; // <= 60

function resumo() {
  const porTratamento = {};
  for (const e of enquadramentos) {
    porTratamento[e.tratamento] = (porTratamento[e.tratamento] ?? 0) + 1;
  }
  return { total: enquadramentos.length, por_tratamento: porTratamento };
}

async function main() {
  if (process.argv[2] !== '--execute') {
    process.stdout.write(
      JSON.stringify(
        { modo: 'preview', uf: 'BA', vigencia: '2026-01-01..2026-12-31',
          escopo_aprovado: false, hash_conteudo: hash, ...resumo() },
        null,
        2,
      ) + '\n',
    );
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não configurada.');
  const postgres = require('postgres');
  const db = postgres(process.env.DATABASE_URL, { max: 1 });
  try {
    const result = await db.begin(async (sql) => {
      await sql`select pg_advisory_xact_lock(hashtext('antecipacao-ba-2026'))`;
      const sobrepostos = await sql`
        select c.id, c.vigencia_inicio::text as inicio, c.escopo_aprovado
          from fiscal_catalogos_versoes c
         where c.tipo = 'DIFAL' and c.uf = 'BA' and c.ativo = true
           and c.vigencia_inicio <= '2026-12-31'
           and (c.vigencia_fim is null or c.vigencia_fim >= '2026-01-01')
           and exists (select 1 from fiscal_regras_versoes r
                        where r.catalogo_versao_id = c.id
                          and r.chave = 'ANTECIPACAO_PARCIAL' and r.ativo = true)
      `;
      const outros = sobrepostos.filter((c) => c.inicio !== '2026-01-01');
      if (outros.length > 0) {
        throw new Error(
          'Há outra vigência de Antecipação Parcial BA sobreposta a 2026 ' +
            `(${outros.map((c) => c.id).join(', ')}). Revise antes de semear.`,
        );
      }
      const existentes = await sql`
        select id, escopo_aprovado from fiscal_catalogos_versoes
         where tipo = 'DIFAL' and uf = 'BA' and vigencia_inicio = '2026-01-01'
      `;
      if (existentes[0]?.escopo_aprovado) {
        throw new Error('Já existe catálogo homologado para BA/2026; revisão manual necessária.');
      }
      const catalogo = existentes[0] ?? (await sql`
        insert into fiscal_catalogos_versoes
          (tipo, uf, codigo, descricao, fonte, fonte_url, hash_conteudo,
           conteudo, vigencia_inicio, vigencia_fim, escopo_aprovado)
        values
          ('DIFAL', 'BA', 'ANTECIPACAO_PARCIAL_BA_2026',
           'Rascunho de enquadramentos de Antecipação Parcial da BA para 2026',
           ${FONTE}, ${ANEXO_1_2026}, ${hash},
           ${sql.json(catalogoConteudo)},
           '2026-01-01', '2026-12-31', false)
        returning id, escopo_aprovado
      `)[0];
      const regras = await sql`
        select id, revisao, coalesce(escopo_aprovado, false) as aprovada,
               conteudo = ${sql.json(conteudo)}::jsonb as igual
          from fiscal_regras_versoes
         where catalogo_versao_id = ${catalogo.id}
           and chave = 'ANTECIPACAO_PARCIAL' and ativo = true
      `;
      if (regras.length > 1 || (regras.length === 1 && !regras[0].igual)) {
        throw new Error(
          'Já existe regra diferente nesta vigência; não sobrescrever a revisão. ' +
            'Edite pela tela ou desative a regra existente.',
        );
      }
      if (regras.length === 0) {
        await sql`
          insert into fiscal_regras_versoes
            (catalogo_versao_id, chave, revisao, conteudo, fonte, fonte_url,
             vigencia_inicio, vigencia_fim, ativo)
          values
            (${catalogo.id}, 'ANTECIPACAO_PARCIAL', 1, ${sql.json(conteudo)},
             ${FONTE}, ${ANEXO_1_2026}, '2026-01-01', '2026-12-31', true)
        `;
      }
      return {
        catalogo_id: catalogo.id,
        regra_criada: regras.length === 0,
        escopo_aprovado: false,
        ...resumo(),
      };
    });
    process.stdout.write(JSON.stringify(result) + '\n');
  } finally {
    await db.end({ timeout: 5 });
  }
}

main().catch((error) => {
  process.stderr.write(`Falha no seed: ${error.message}\n`);
  process.exitCode = 1;
});
