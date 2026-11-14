import { Injectable } from '@nestjs/common';
import { AppLogger } from '../common/logger.service';
import { DESTDA_UF_POR_CODIGO_IBGE } from '../fiscal/destda/destda-leiaute';

export const FONTES_CONSULTA_CEP = [
  'VIA_CEP',
  'BRASIL_API',
  'OPEN_CEP',
] as const;
export type FonteConsultaCep = (typeof FONTES_CONSULTA_CEP)[number];

export interface CepLookupResult {
  /** CEP com 8 dígitos. */
  postal_code: string;
  street: string;
  district: string;
  city: string;
  state: string;
  /** Código IBGE do município (7 dígitos); `null` quando nenhum provedor informou um código coerente com a UF. */
  ibge_code: string | null;
  source: FonteConsultaCep;
}

export class CepLookupFailure extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'UNAVAILABLE') {
    super(code);
    this.name = 'CepLookupFailure';
  }
}

type Provider = {
  source: FonteConsultaCep;
  url: (cep: string) => string;
};

/**
 * Ordem de consulta. Os três provedores têm contratos diferentes:
 *  - ViaCEP: 200 com `{ "erro": true }` quando o CEP não existe; 400 se o
 *    formato é inválido; campos em português (`logradouro`, `localidade`,
 *    `uf`, `ibge`).
 *  - BrasilAPI v2: 404 quando não encontra; campos em inglês (`street`,
 *    `city`, `state`, `neighborhood`) e o IBGE em `ibge.city`, que pode faltar
 *    quando a base de origem é os Correios.
 *  - OpenCEP: 404 quando não encontra; mesmo formato do ViaCEP.
 */
const PROVIDERS: Provider[] = [
  { source: 'VIA_CEP', url: (cep) => `https://viacep.com.br/ws/${cep}/json/` },
  {
    source: 'BRASIL_API',
    url: (cep) => `https://brasilapi.com.br/api/cep/v2/${cep}`,
  },
  { source: 'OPEN_CEP', url: (cep) => `https://opencep.com/v1/${cep}` },
];

const LOOKUP_TIMEOUT_MS = 6_000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;

@Injectable()
export class CepLookupService {
  private readonly cache = new Map<
    string,
    { expiresAt: number; value: CepLookupResult }
  >();

  constructor(private readonly logger: AppLogger) {}

  async lookup(
    rawCep: string,
    context: { requestId?: string; userId?: string } = {},
  ): Promise<CepLookupResult> {
    const cep = rawCep.replace(/\D/g, '');
    if (!/^\d{8}$/u.test(cep)) throw new CepLookupFailure('NOT_FOUND');

    const cached = this.cache.get(cep);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    let result = null as CepLookupResult | null;
    let notFound = 0;
    let failed = 0;

    for (const provider of PROVIDERS) {
      const startedAt = Date.now();
      try {
        const response = await fetch(provider.url(cep), {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
        });
        if (response.status === 404 || response.status === 400) {
          notFound += 1;
          continue;
        }
        if (!response.ok) throw new Error(`HTTP_${response.status}`);
        const normalized = normalizeCepPayload(
          provider.source,
          (await response.json()) as unknown,
          cep,
        );
        if (!normalized) {
          notFound += 1;
          continue;
        }
        this.logger.info('cep_lookup_provider_succeeded', {
          requestId: context.requestId,
          userId: context.userId,
          operation: 'cep_lookup',
          provider: provider.source,
          durationMs: Date.now() - startedAt,
        });
        if (!result) {
          result = normalized;
        } else if (
          !result.ibge_code &&
          normalized.ibge_code &&
          normalized.state === result.state
        ) {
          // Um provedor anterior respondeu sem IBGE: completa só o código.
          result = { ...result, ibge_code: normalized.ibge_code };
        }
        if (result.ibge_code) break;
      } catch {
        failed += 1;
        this.logger.warn('cep_lookup_provider_failed', {
          requestId: context.requestId,
          userId: context.userId,
          operation: 'cep_lookup',
          provider: provider.source,
          durationMs: Date.now() - startedAt,
        });
      }
    }

    if (!result) {
      throw new CepLookupFailure(
        notFound > 0 && failed === 0 ? 'NOT_FOUND' : 'UNAVAILABLE',
      );
    }
    this.remember(cep, result);
    return result;
  }

  private remember(cep: string, value: CepLookupResult) {
    if (this.cache.size >= CACHE_MAX_ENTRIES) {
      const oldest: string | undefined = this.cache.keys().next().value as
        string | undefined;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(cep, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  }
}

/** Normaliza o payload de um provedor; `null` quando o CEP não existe. */
export function normalizeCepPayload(
  source: FonteConsultaCep,
  payload: unknown,
  requestedCep: string,
): CepLookupResult | null {
  if (payload === null || typeof payload !== 'object') {
    throw new Error('INVALID_PROVIDER_PAYLOAD');
  }
  const record = payload as Record<string, unknown>;
  if (source !== 'BRASIL_API' && isTruthyFlag(record.erro ?? record.error)) {
    return null;
  }

  const portuguese = source !== 'BRASIL_API';
  const city = text(portuguese ? record.localidade : record.city);
  const state = text(portuguese ? record.uf : record.state).toUpperCase();
  if (!city || !/^[A-Z]{2}$/u.test(state)) return null;

  const returnedCep = text(record.cep).replace(/\D/g, '');
  if (returnedCep && returnedCep !== requestedCep) {
    throw new Error('CEP_MISMATCH');
  }

  const rawIbge = portuguese
    ? text(record.ibge)
    : text(asRecord(record.ibge)?.city);
  return {
    postal_code: requestedCep,
    street: text(portuguese ? record.logradouro : record.street),
    district: text(portuguese ? record.bairro : record.neighborhood),
    city,
    state,
    ibge_code: coherentIbge(rawIbge, state),
    source,
  };
}

/** Só aceita 7 dígitos cujo prefixo corresponda à UF informada. */
export function coherentIbge(value: string, state: string): string | null {
  const digits = value.replace(/\D/g, '');
  if (!/^\d{7}$/u.test(digits)) return null;
  return DESTDA_UF_POR_CODIGO_IBGE[digits.slice(0, 2)] === state
    ? digits
    : null;
}

function isTruthyFlag(value: unknown): boolean {
  return value === true || value === 'true';
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ') : '';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
