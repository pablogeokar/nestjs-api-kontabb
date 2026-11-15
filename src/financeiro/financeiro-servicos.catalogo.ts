/** Catálogo único do escopo contratual. Nenhum serviço é incluído implicitamente. */
export const SERVICOS_CONTRATO = [
  {
    codigo: 'CONTABILIDADE_GERAL',
    nome: 'Contabilidade geral',
    escopo:
      'Escrituração contábil e elaboração das demonstrações contábeis relativas às informações fornecidas pela contratante.',
  },
  {
    codigo: 'DEPARTAMENTO_FISCAL',
    nome: 'Departamento Fiscal',
    escopo:
      'Escrituração fiscal, apuração de tributos e preparação das obrigações acessórias fiscais aplicáveis à contratante.',
  },
  {
    codigo: 'DEPARTAMENTO_PESSOAL',
    nome: 'Departamento de Pessoal',
    escopo:
      'Processamento da folha de pagamento, admissões, desligamentos e obrigações trabalhistas e previdenciárias aplicáveis.',
  },
  {
    codigo: 'ESOCIAL_DOMESTICO',
    nome: 'eSocial de empregado(a) doméstico(a)',
    escopo:
      'Cadastro, movimentações, folha de pagamento e guias no módulo do eSocial para empregado(a) doméstico(a), conforme dados enviados pela contratante.',
  },
  {
    codigo: 'ASSESSORIA',
    nome: 'Assessoria contábil e tributária',
    escopo:
      'Orientações técnicas sobre questões contábeis e tributárias relacionadas às atividades da contratante, dentro do escopo acordado.',
  },
  {
    codigo: 'OUTROS',
    nome: 'Outro serviço especificado',
    escopo: '',
  },
] as const;

export type CodigoServicoContrato =
  (typeof SERVICOS_CONTRATO)[number]['codigo'];
export const CODIGOS_SERVICO_CONTRATO = SERVICOS_CONTRATO.map(
  (servico) => servico.codigo,
);
