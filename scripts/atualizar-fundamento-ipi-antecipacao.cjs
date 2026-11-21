/*
 * Reescreve o fundamento da decisão de IPI nas regras de Antecipação Parcial.
 *
 * Contexto: enquadramentos com `ipi_na_base` guardam textos que afirmam, sem
 * citar norma, que "o IPI na Bahia faz parte da base". Não há norma específica
 * nem parecer da SEFAZ-BA localizados sobre o tema. Este script troca esses
 * textos por um fundamento que descreve o critério adotado, a base legal usada
 * e a pendência, SEM mudar a decisão (INCLUIR/EXCLUIR), os valores nem as
 * confirmações fiscais já registradas.
 *
 * Grava uma NOVA revisão da regra (as revisões anteriores são imutáveis). Revisão
 * homologada não é alterada. Idempotente: sem texto a trocar, nada é gravado.
 *
 * Simulação (padrão): node --env-file=.env scripts/atualizar-fundamento-ipi-antecipacao.cjs
 * Gravar:             node --env-file=.env scripts/atualizar-fundamento-ipi-antecipacao.cjs --execute
 * Outra UF:           ... --uf=PE
 */
const postgres = require('postgres');

const TEXTOS_SEM_NORMA = new Set(
  [
    'O IPI Na Bahia faz parte da Base',
    'A Bahia considera o IPI na base de cálculo',
    'Base de IPI incluída pelo usuário',
  ].map((t) => t.toLowerCase()),
);

const FUNDAMENTO_INCLUIR =
  'Critério adotado: o IPI destacado integra a base, por ser parte do valor da operação constante ' +
  'no documento de aquisição (Lei 7.014/96, art. 23, III). Não há norma específica nem parecer da ' +
  'SEFAZ-BA localizados sobre IPI na antecipação parcial. A LC 87/96, art. 13, § 2º, indica exclusão ' +
  'em operação entre contribuintes para comercialização com fato gerador dos dois impostos. ' +
  'Pendente de confirmação por consulta à DITRI.';
const FUNDAMENTO_EXCLUIR =
  'Critério adotado: o IPI destacado não integra a base, conforme a LC 87/96, art. 13, § 2º ' +
  '(operação entre contribuintes, para comercialização, com fato gerador do ICMS e do IPI). Não há ' +
  'norma específica nem parecer da SEFAZ-BA localizados sobre IPI na antecipação parcial. ' +
  'Pendente de confirmação por consulta à DITRI.';
const LIMITE = 500;

function novoFundamento(decisao) {
  const texto = decisao === 'EXCLUIR' ? FUNDAMENTO_EXCLUIR : FUNDAMENTO_INCLUIR;
  if (texto.length > LIMITE)
    throw new Error(`Fundamento com ${texto.length} caracteres; limite ${LIMITE}.`);
  return texto;
}

async function main() {
  const executar = process.argv.includes('--execute');
  const uf = (process.argv.find((a) => a.startsWith('--uf=')) ?? '--uf=BA').slice(5);
  if (!/^[A-Z]{2}$/.test(uf)) throw new Error('UF inválida.');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não configurada.');
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  try {
    const resultado = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`icms:${uf}`}))`;
      const catalogos = await tx`
        select * from fiscal_catalogos_versoes
         where tipo = 'DIFAL' and uf = ${uf} and ativo = true`;
      const saida = [];
      for (const catalogo of catalogos) {
        const [atual] = await tx`
          select * from fiscal_regras_versoes
           where catalogo_versao_id = ${catalogo.id} and chave = 'ANTECIPACAO_PARCIAL' and ativo = true
           order by revisao desc limit 1`;
        if (!atual) continue;
        const rotulo = `${catalogo.codigo} (vigência ${catalogo.vigencia_inicio.toISOString?.().slice(0, 10) ?? catalogo.vigencia_inicio})`;
        if (atual.escopo_aprovado ?? catalogo.escopo_aprovado) {
          saida.push({ catalogo: rotulo, situacao: 'revisão homologada: não alterada', alterados: [] });
          continue;
        }
        const linhas = Array.isArray(atual.conteudo?.enquadramentos)
          ? atual.conteudo.enquadramentos
          : [];
        const alterados = [];
        const novas = linhas.map((linha) => {
          const decisao = linha.ipi_na_base;
          const texto = typeof linha.fundamento_ipi === 'string' ? linha.fundamento_ipi.trim() : '';
          if (
            (decisao !== 'INCLUIR' && decisao !== 'EXCLUIR') ||
            !TEXTOS_SEM_NORMA.has(texto.toLowerCase())
          )
            return linha;
          alterados.push(
            `${linha.ncm}/${linha.cest ?? '—'} ${linha.uf_origem} origem ${linha.origem_mercadoria} (${decisao})`,
          );
          return { ...linha, fundamento_ipi: novoFundamento(decisao) };
        });
        if (alterados.length === 0) {
          saida.push({ catalogo: rotulo, situacao: 'nada a alterar', alterados });
          continue;
        }
        if (!executar) {
          saida.push({ catalogo: rotulo, situacao: `simulação: nova revisão ${atual.revisao + 1}`, alterados });
          continue;
        }
        const [{ maxima }] = await tx`
          select max(revisao) as maxima from fiscal_regras_versoes
           where catalogo_versao_id = ${catalogo.id} and chave = 'ANTECIPACAO_PARCIAL'`;
        const revisao = Number(maxima) + 1;
        const conteudo = { ...atual.conteudo, enquadramentos: novas };
        await tx`
          insert into fiscal_regras_versoes
            (catalogo_versao_id, chave, revisao, conteudo, fonte, fonte_url,
             vigencia_inicio, vigencia_fim, escopo_aprovado)
          values
            (${catalogo.id}, 'ANTECIPACAO_PARCIAL', ${revisao}, ${tx.json(conteudo)},
             ${atual.fonte}, ${atual.fonte_url}, ${atual.vigencia_inicio}, ${atual.vigencia_fim}, false)`;
        // Resumo do catálogo (rascunho): mesmo comportamento do cadastro pela tela.
        if (!catalogo.escopo_aprovado) {
          const resumo = { ...catalogo.conteudo };
          if (Array.isArray(resumo.enquadramentos)) resumo.enquadramentos = novas;
          await tx`
            update fiscal_catalogos_versoes
               set conteudo = ${tx.json(resumo)}, hash_conteudo = null, atualizado_em = now()
             where id = ${catalogo.id}`;
        }
        saida.push({ catalogo: rotulo, situacao: `revisão ${revisao} gravada`, alterados });
      }
      return saida;
    });
    for (const r of resultado) {
      process.stdout.write(`${r.catalogo}: ${r.situacao}\n`);
      for (const a of r.alterados) process.stdout.write(`  - ${a}\n`);
    }
    if (!executar) process.stdout.write('\nSimulação. Use --execute para gravar.\n');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((erro) => {
  process.stderr.write(`Falha: ${erro instanceof Error ? erro.message : erro}\n`);
  process.exit(1);
});
