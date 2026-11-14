import { createHash } from 'node:crypto';
import postgres from 'postgres';
import { ENQUADRAMENTOS_ANTECIPACAO_BA_2026 } from './data/antecipacao-parcial-ba-2026.enquadramentos';

/**
 * Seed do motor de regras de ICMS da BA para 2026 (rascunho, nada homologado):
 * - ANTECIPACAO_PARCIAL: enquadramentos por NCM/CEST/regime/origem e redução de
 *   20% para ME/EPP (RICMS-BA, art. 274);
 * - DIFAL_ENTRADA_CONTRIBUINTE: alíquota interna, base dupla e dispensa sobre
 *   ativo para ME/EPP (RICMS-BA, art. 272, I, "a", 2).
 *
 * Vigência 01/01/2026 a 31/12/2026. Fundamentação e evidências em
 * docs/antecipacao-parcial-ba-2026-fundamentacao.md.
 *
 * Uso: pnpm db:seed:icms-ba            (grava)
 *      pnpm db:seed:icms-ba --preview  (só mostra o resumo)
 *
 * Idempotente. Aborta se houver catálogo homologado, revisão homologada a
 * alterar ou outra vigência de Antecipação Parcial BA sobreposta a 2026. Se o
 * conteúdo mudar e a última revisão não estiver aprovada, grava a revisão
 * seguinte.
 */
const ANEXO_1_2026 =
  'https://mbusca.sefaz.ba.gov.br/ditri/normas_complementares/decretos/decreto_2012_13780_ricms_anexo_1_vigente_2026.pdf';
const FONTES = [
  {
    titulo: 'RICMS-BA (Dec. 13.780/12), Anexo 1 – redação vigente 2026',
    url: ANEXO_1_2026,
    sha256: 'd009df80b3897e04377adc82a1a7c0f1ddbec3547a1da1cb69fef54516663b8e',
  },
  {
    titulo:
      'RICMS-BA (Dec. 13.780/12), texto com alterações a partir de 2021 (última: Dec. 24.829/26)',
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

const enquadramentos = ENQUADRAMENTOS_ANTECIPACAO_BA_2026;
const conteudo = {
  enquadramentos,
  // RICMS-BA, art. 274: redução de 20% do imposto apurado para ME/EPP que
  // recolhe no prazo regulamentar. O motor só aplica a optantes do Simples.
  reducao_me_epp: {
    percentual: '20',
    fundamento: 'RICMS-BA, art. 274',
    condicao: 'Recolhimento no prazo regulamentar',
  },
  fontes: FONTES,
  consultado_em: CONSULTADO_EM,
};

// DIFAL de entrada de contribuinte (uso/consumo 2556 e ativo 2551).
const conteudoDifal = {
  // Lei 7.014/96, art. 15, I, "a" (20,5%, Lei 14.629/23, efeitos 07/02/24).
  aliquota_interna: '20.5',
  // Interestadual do item (Res. SF 22/89 e 13/12), sem valor fixo na regra.
  aliquota_interestadual: null,
  // Adicional de FCP (Lei 7.014/96, art. 16-A) só vale para mercadorias
  // listadas; a regra geral não o aplica.
  aliquota_fcp: null,
  percentual_reducao: null,
  percentual_beneficio: null,
  // Lei 7.014/96, art. 17, XI, "b" e § 6º (Lei 14.415/21, efeitos 31/12/21):
  // base do destino com o imposto por dentro.
  base_por_dentro: false,
  base_dupla: true,
  fcp_na_base_por_dentro: false,
  // RICMS-BA, art. 272, I, "a", 2: dispensa na aquisição de ativo por ME/EPP.
  dispensa_ativo_me_epp: { fundamento: 'RICMS-BA, art. 272, I, "a", 2' },
  fundamentos: [
    'Lei 7.014/96, art. 4º, XV (fato gerador na entrada para uso, consumo ou ativo)',
    'Lei 7.014/96, art. 15, I, "a" (alíquota interna 20,5%)',
    'Lei 7.014/96, art. 17, XI, "b" e § 6º (base do destino e diferença de alíquotas)',
    'RICMS-BA, art. 305, § 4º, III, "a" (lançamento do diferencial de alíquotas)',
    'RICMS-BA, art. 321, VIII e § 1º (Simples Nacional, alíquotas de não optantes)',
    'RICMS-BA, art. 272, I, "a", 2 (dispensa sobre ativo para ME/EPP)',
  ],
  fontes: FONTES,
  consultado_em: CONSULTADO_EM,
};
const FONTE_DIFAL = 'Lei 7.014/96 arts.4,15,17; RICMS-BA arts.272,321'; // <= 60
const catalogoConteudo = {
  status: 'RASCUNHO',
  competencia: '2026-01',
  ...conteudo,
};
const hash = createHash('sha256')
  .update(JSON.stringify(catalogoConteudo))
  .digest('hex');
const FONTE = 'Lei 7.014/96 art.12-A; RICMS-BA art.321; Anexo 1/2026'; // <= 60

function resumo() {
  const porTratamento: Record<string, number> = {};
  for (const e of enquadramentos) {
    porTratamento[e.tratamento] = (porTratamento[e.tratamento] ?? 0) + 1;
  }
  return { total: enquadramentos.length, por_tratamento: porTratamento };
}

/**
 * Grava a regra se ainda não existe. Se a última revisão ativa tem o mesmo
 * conteúdo, não faz nada. Se difere e NÃO está aprovada, cria a revisão
 * seguinte (a anterior fica no histórico). Revisão aprovada nunca é alterada.
 */
async function upsertRegra(
  sql: postgres.TransactionSql,
  catalogoId: string,
  chave: string,
  conteudoRegra: Record<string, unknown>,
  fonte: string,
): Promise<{
  acao: 'criada' | 'nova_revisao' | 'inalterada';
  revisao: number;
}> {
  const [ultima] = await sql<
    { id: string; revisao: number; aprovada: boolean; igual: boolean }[]
  >`
    select id, revisao, coalesce(escopo_aprovado, false) as aprovada,
           conteudo = ${sql.json(conteudoRegra as postgres.JSONValue)}::jsonb as igual
      from fiscal_regras_versoes
     where catalogo_versao_id = ${catalogoId} and chave = ${chave} and ativo = true
     order by revisao desc
     limit 1
  `;
  if (ultima?.igual) return { acao: 'inalterada', revisao: ultima.revisao };
  if (ultima?.aprovada) {
    throw new Error(
      `A regra ${chave} revisão ${ultima.revisao} já foi homologada; abra nova vigência para alterá-la.`,
    );
  }
  const revisao = (ultima?.revisao ?? 0) + 1;
  await sql`
    insert into fiscal_regras_versoes
      (catalogo_versao_id, chave, revisao, conteudo, fonte, fonte_url,
       vigencia_inicio, vigencia_fim, ativo)
    values
      (${catalogoId}, ${chave}, ${revisao}, ${sql.json(conteudoRegra as postgres.JSONValue)},
       ${fonte}, ${ANEXO_1_2026}, '2026-01-01', '2026-12-31', true)
  `;
  return { acao: ultima ? 'nova_revisao' : 'criada', revisao };
}

export async function seedIcmsBa2026(
  databaseUrl: string,
  opcoes: { preview?: boolean } = {},
) {
  if (opcoes.preview) {
    process.stdout.write(
      JSON.stringify(
        {
          modo: 'preview',
          uf: 'BA',
          vigencia: '2026-01-01..2026-12-31',
          escopo_aprovado: false,
          hash_conteudo: hash,
          ...resumo(),
        },
        null,
        2,
      ) + '\n',
    );
    return null;
  }
  const db = postgres(databaseUrl, { max: 1 });
  try {
    const result = await db.begin(async (sql) => {
      await sql`select pg_advisory_xact_lock(hashtext('icms:BA'))`;
      const sobrepostos = await sql<
        { id: string; inicio: string; escopo_aprovado: boolean }[]
      >`
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
      const existentes = await sql<{ id: string; escopo_aprovado: boolean }[]>`
        select id, escopo_aprovado from fiscal_catalogos_versoes
         where tipo = 'DIFAL' and uf = 'BA' and vigencia_inicio = '2026-01-01'
      `;
      if (existentes[0]?.escopo_aprovado) {
        throw new Error(
          'Já existe catálogo homologado para BA/2026; revisão manual necessária.',
        );
      }
      const catalogo =
        existentes[0] ??
        (
          await sql<{ id: string; escopo_aprovado: boolean }[]>`
        insert into fiscal_catalogos_versoes
          (tipo, uf, codigo, descricao, fonte, fonte_url, hash_conteudo,
           conteudo, vigencia_inicio, vigencia_fim, escopo_aprovado)
        values
          ('DIFAL', 'BA', 'ANTECIPACAO_PARCIAL_BA_2026',
           'Rascunho de enquadramentos de Antecipação Parcial da BA para 2026',
           ${FONTE}, ${ANEXO_1_2026}, ${hash},
           ${sql.json(catalogoConteudo as unknown as postgres.JSONValue)},
           '2026-01-01', '2026-12-31', false)
        returning id, escopo_aprovado
      `
        )[0];
      const regraAntecipacao = await upsertRegra(
        sql,
        catalogo.id,
        'ANTECIPACAO_PARCIAL',
        conteudo,
        FONTE,
      );
      const regraDifal = await upsertRegra(
        sql,
        catalogo.id,
        'DIFAL_ENTRADA_CONTRIBUINTE',
        conteudoDifal,
        FONTE_DIFAL,
      );
      // Mantém o resumo do catálogo (rascunho) alinhado à revisão gravada.
      await sql`
        update fiscal_catalogos_versoes
           set conteudo = ${sql.json(catalogoConteudo as unknown as postgres.JSONValue)}, hash_conteudo = ${hash},
               atualizado_em = now()
         where id = ${catalogo.id} and escopo_aprovado = false
           and hash_conteudo is distinct from ${hash}
      `;
      return {
        catalogo_id: catalogo.id,
        antecipacao_parcial: regraAntecipacao,
        difal_entrada: regraDifal,
        escopo_aprovado: false,
        ...resumo(),
      };
    });
    return result;
  } finally {
    await db.end({ timeout: 5 });
  }
}

if (require.main === module) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL não configurada.');
  void seedIcmsBa2026(databaseUrl, {
    preview: process.argv.includes('--preview'),
  })
    .then((result) => {
      if (result)
        process.stdout.write(
          `Seed de regras ICMS BA 2026 concluído: ${JSON.stringify(result)}\n`,
        );
    })
    .catch((error: unknown) => {
      process.stderr.write(
        `Falha ao executar seed de regras ICMS BA 2026: ${error instanceof Error ? error.message : 'erro desconhecido'}\n`,
      );
      process.exitCode = 1;
    });
}
