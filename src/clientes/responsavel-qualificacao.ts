/**
 * Responsável pela empresa, usado nos registros 0005 da DeSTDA. A Receita
 * publica apenas o nome dos sócios (o CPF vem mascarado), então o CPF
 * continua sendo informado manualmente.
 */
export interface ResponsavelEmpresa {
  name: string;
  /** Qualificação conforme a tabela 3.3.2 do leiaute da DeSTDA. */
  qualification_code: string;
  /** Qualificação como informada pelo provedor. */
  qualification_label: string;
}

export interface SocioProvedor {
  name: string;
  qualification: string;
  /** Sócio pessoa física? Pessoa jurídica não pode assinar. */
  isPerson: boolean;
}

function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Mark}/gu, '')
    .toLowerCase()
    .replace(/^\d+\s*-\s*/u, '')
    .trim();
}

/** Converte a qualificação da Receita para a tabela de assinantes da DeSTDA. */
export function mapQualificacaoParaCodAssinante(qualificacao: string): string {
  const texto = normalizar(qualificacao);
  if (texto.includes('procurador')) return '309';
  if (texto.includes('inventariante')) return '312';
  if (texto.includes('liquidante')) return '313';
  if (texto.includes('interventor')) return '315';
  if (texto.includes('conselh')) return '204';
  if (texto.includes('administrador') || texto.includes('gerente'))
    return '205';
  if (texto.includes('diretor') || texto.includes('presidente')) return '203';
  if (texto.includes('titular') || texto.includes('empresario')) return '801';
  return '999';
}

const PRIORIDADE = [
  'administrador',
  'diretor',
  'presidente',
  'titular',
  'empresario',
  'gerente',
  'socio',
];

/** Escolhe o sócio mais adequado para assinar como responsável. */
export function escolherResponsavel(
  socios: readonly SocioProvedor[],
): ResponsavelEmpresa | null {
  const pessoas = socios.filter((socio) => socio.isPerson && socio.name.trim());
  if (pessoas.length === 0) return null;
  const rank = (socio: SocioProvedor) => {
    const texto = normalizar(socio.qualification);
    const posicao = PRIORIDADE.findIndex((termo) => texto.includes(termo));
    return posicao === -1 ? PRIORIDADE.length : posicao;
  };
  const [escolhido] = [...pessoas].sort((a, b) => rank(a) - rank(b));
  return {
    name: escolhido.name.trim(),
    qualification_code: mapQualificacaoParaCodAssinante(
      escolhido.qualification,
    ),
    qualification_label: escolhido.qualification.trim(),
  };
}
