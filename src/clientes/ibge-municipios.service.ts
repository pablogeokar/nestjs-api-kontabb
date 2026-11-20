import { Injectable } from '@nestjs/common';

const IBGE_URL = (uf: string) =>
  `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios`;
const TIMEOUT_MS = 6_000;

export function normalizarNomeMunicipio(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/\p{Mark}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/gu, ' ')
    .trim();
}

/**
 * Resolve o código IBGE (7 dígitos) a partir do nome do município e da UF,
 * usando a API oficial de localidades do IBGE. Os provedores de CNPJ só
 * informam o código interno da Receita, que não serve para a DeSTDA.
 */
@Injectable()
export class IbgeMunicipiosService {
  private readonly cache = new Map<string, Map<string, string>>();
  private readonly localidades = new Map<
    string,
    { municipio: string; uf: string }
  >();

  async resolverLocalidade(
    codigo: string,
  ): Promise<{ municipio: string; uf: string } | null> {
    if (!/^\d{7}$/u.test(codigo)) return null;
    const cached = this.localidades.get(codigo);
    if (cached) return cached;
    try {
      const response = await fetch(
        `https://servicodados.ibge.gov.br/api/v1/localidades/municipios/${codigo}?view=nivelado`,
        {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      );
      if (!response.ok) return null;
      const data: unknown = await response.json();
      if (
        typeof data !== 'object' ||
        data === null ||
        !('municipio-id' in data) ||
        String(data['municipio-id']) !== codigo ||
        !('municipio-nome' in data) ||
        typeof data['municipio-nome'] !== 'string' ||
        !data['municipio-nome'].trim() ||
        !('UF-sigla' in data) ||
        typeof data['UF-sigla'] !== 'string' ||
        !/^[A-Z]{2}$/u.test(data['UF-sigla'])
      ) {
        return null;
      }
      const localidade = {
        municipio: data['municipio-nome'].trim(),
        uf: data['UF-sigla'],
      };
      this.localidades.set(codigo, localidade);
      return localidade;
    } catch {
      return null;
    }
  }

  async resolverCodigo(municipio: string, uf: string): Promise<string | null> {
    const sigla = uf.trim().toUpperCase();
    if (!/^[A-Z]{2}$/u.test(sigla) || !municipio.trim()) return null;
    try {
      let indice = this.cache.get(sigla);
      if (!indice) {
        const response = await fetch(IBGE_URL(sigla), {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!response.ok) return null;
        const lista: unknown = await response.json();
        if (!Array.isArray(lista)) return null;
        indice = new Map();
        for (const item of lista as Array<{ id?: number; nome?: string }>) {
          if (typeof item.id === 'number' && typeof item.nome === 'string') {
            indice.set(normalizarNomeMunicipio(item.nome), String(item.id));
          }
        }
        if (indice.size > 0) this.cache.set(sigla, indice);
      }
      return indice.get(normalizarNomeMunicipio(municipio)) ?? null;
    } catch {
      return null;
    }
  }
}
