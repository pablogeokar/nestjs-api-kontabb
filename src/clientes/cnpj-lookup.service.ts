import { Injectable } from '@nestjs/common';
import { AppLogger } from '../common/logger.service';
import type { FonteConsultaCnpj } from './clientes.types';

export interface CnaeData {
  code: string;
  description: string;
}

export interface ClientAddressData {
  postal_code: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
  formatted: string;
}

export interface CnpjLookupResult {
  cnpj: string;
  company_name: string;
  address: ClientAddressData;
  primary_activity: CnaeData | null;
  secondary_activities: CnaeData[];
  /**
   * Indica se a empresa é optante pelo Simples Nacional.
   * `null` quando o provedor não informa esse dado de forma confiável.
   */
  simples_nacional: boolean | null;
  source: FonteConsultaCnpj;
}

export class CnpjLookupFailure extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'UNAVAILABLE') {
    super(code);
    this.name = 'CnpjLookupFailure';
  }
}

type Provider = {
  source: CnpjLookupResult['source'];
  url: (cnpj: string) => string;
};

const PROVIDERS: Provider[] = [
  {
    source: 'OPEN_CNPJ',
    url: (cnpj) => `https://api.opencnpj.org/${cnpj}`,
  },
  {
    source: 'RECEITA_WS',
    url: (cnpj) => `https://www.receitaws.com.br/v1/cnpj/${cnpj}`,
  },
];

const LOOKUP_TIMEOUT_MS = 8_000;

@Injectable()
export class CnpjLookupService {
  constructor(private readonly logger: AppLogger) {}

  async lookup(cnpj: string, context: { requestId?: string; userId: string }) {
    let notFound = false;

    for (const provider of PROVIDERS) {
      const startedAt = Date.now();
      try {
        const response = await fetch(provider.url(cnpj), {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
        });

        if (response.status === 404) {
          notFound = true;
          throw new CnpjLookupFailure('NOT_FOUND');
        }
        if (!response.ok) throw new Error(`HTTP_${response.status}`);

        const payload: unknown = await response.json();
        const result = normalizeCnpjPayload(provider.source, payload, cnpj);
        this.logger.info('cnpj_lookup_succeeded', {
          requestId: context.requestId,
          userId: context.userId,
          operation: 'cnpj_lookup',
          result: 'success',
          provider: provider.source,
          durationMs: Date.now() - startedAt,
        });
        return result;
      } catch (error) {
        if (error instanceof CnpjLookupFailure && error.code === 'NOT_FOUND') {
          notFound = true;
        }
        this.logger.warn('cnpj_lookup_provider_failed', {
          requestId: context.requestId,
          userId: context.userId,
          operation: 'cnpj_lookup',
          result: 'fallback',
          provider: provider.source,
          durationMs: Date.now() - startedAt,
        });
      }
    }

    throw new CnpjLookupFailure(notFound ? 'NOT_FOUND' : 'UNAVAILABLE');
  }
}

export function normalizeCnpjPayload(
  source: CnpjLookupResult['source'],
  payload: unknown,
  requestedCnpj: string,
): CnpjLookupResult {
  const record = asRecord(payload);
  if (!record) throw new Error('INVALID_PROVIDER_PAYLOAD');

  return source === 'OPEN_CNPJ'
    ? normalizeOpenCnpj(record, requestedCnpj)
    : normalizeReceitaWs(record, requestedCnpj);
}

export function isValidCnpj(value: string) {
  const cnpj = normalizeCnpj(value);
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(cnpj) || /^(.)\1{13}$/.test(cnpj)) {
    return false;
  }

  const calculateDigit = (base: string, weights: number[]) => {
    const sum = base
      .split('')
      .reduce(
        (total, character, index) =>
          total + (character.charCodeAt(0) - 48) * weights[index],
        0,
      );
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  const first = calculateDigit(
    cnpj.slice(0, 12),
    [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
  );
  const second = calculateDigit(
    `${cnpj.slice(0, 12)}${first}`,
    [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
  );
  return cnpj.endsWith(`${first}${second}`);
}

function normalizeOpenCnpj(
  payload: Record<string, unknown>,
  requestedCnpj: string,
): CnpjLookupResult {
  assertMatchingCnpj(payload.cnpj, requestedCnpj);
  const companyName = cleanText(payload.razao_social);
  if (!companyName) throw new CnpjLookupFailure('NOT_FOUND');

  const primaryCode = digits(cleanText(payload.cnae_principal));
  const cnaes = arrayRecords(payload.cnaes).map((item) => ({
    code: digits(cleanText(item.codigo)),
    description: cleanText(item.descricao),
    isPrimary: item.is_principal === true,
  }));
  const primary =
    cnaes.find((item) => item.isPrimary) ??
    cnaes.find((item) => item.code === primaryCode);
  const secondaryCodes = new Set(
    asArray(payload.cnaes_secundarios).map((item) => digits(cleanText(item))),
  );
  const secondary = cnaes
    .filter((item) => !item.isPrimary && item.code !== primaryCode)
    .map(({ code, description }) => ({ code, description }));

  for (const code of secondaryCodes) {
    if (code && !secondary.some((item) => item.code === code)) {
      secondary.push({ code, description: '' });
    }
  }

  const street = joinStreet(
    cleanText(payload.tipo_logradouro),
    cleanText(payload.logradouro),
  );
  const address = makeAddress({
    postal_code: digits(cleanText(payload.cep)),
    street,
    number: cleanText(payload.numero),
    complement: cleanText(payload.complemento),
    district: cleanText(payload.bairro),
    city: cleanText(payload.municipio),
    state: cleanText(payload.uf).toUpperCase(),
  });

  // "opcao_simples": "S" indica optante, "N" ou ausência indica não-optante
  const simplesNacional = extractSimplesNacionalOpenCnpj(payload);

  return {
    cnpj: normalizeCnpj(requestedCnpj),
    company_name: companyName,
    address,
    primary_activity: primary
      ? { code: primary.code, description: primary.description }
      : primaryCode
        ? { code: primaryCode, description: '' }
        : null,
    secondary_activities: deduplicateCnaes(secondary),
    simples_nacional: simplesNacional,
    source: 'OPEN_CNPJ',
  };
}

function normalizeReceitaWs(
  payload: Record<string, unknown>,
  requestedCnpj: string,
): CnpjLookupResult {
  if (cleanText(payload.status).toUpperCase() === 'ERROR') {
    throw new CnpjLookupFailure('NOT_FOUND');
  }
  assertMatchingCnpj(payload.cnpj, requestedCnpj);
  const companyName = cleanText(payload.nome);
  if (!companyName) throw new CnpjLookupFailure('NOT_FOUND');

  const primary = arrayRecords(payload.atividade_principal)
    .map(normalizeReceitaCnae)
    .find((item) => item.code);
  const secondary = arrayRecords(payload.atividades_secundarias)
    .map(normalizeReceitaCnae)
    .filter((item) => item.code);
  const address = makeAddress({
    postal_code: digits(cleanText(payload.cep)),
    street: cleanText(payload.logradouro),
    number: cleanText(payload.numero),
    complement: cleanText(payload.complemento),
    district: cleanText(payload.bairro),
    city: cleanText(payload.municipio),
    state: cleanText(payload.uf).toUpperCase(),
  });

  // "simples": { "optante": true } indica optante pelo Simples Nacional
  const simplesNacional = extractSimplesNacionalReceitaWs(payload);

  return {
    cnpj: normalizeCnpj(requestedCnpj),
    company_name: companyName,
    address,
    primary_activity: primary ?? null,
    secondary_activities: deduplicateCnaes(secondary),
    simples_nacional: simplesNacional,
    source: 'RECEITA_WS',
  };
}

function normalizeReceitaCnae(item: Record<string, unknown>): CnaeData {
  return {
    code: digits(cleanText(item.code)),
    description: cleanText(item.text),
  };
}

/**
 * Extrai a informação de opção pelo Simples Nacional do payload da Open CNPJ.
 * O campo "opcao_simples" tem valor "S" para optante ou "N" para não-optante.
 * Retorna `null` se o campo não estiver presente.
 */
function extractSimplesNacionalOpenCnpj(
  payload: Record<string, unknown>,
): boolean | null {
  const raw = cleanText(payload.opcao_simples).toUpperCase();
  if (raw === 'S') return true;
  if (raw === 'N') return false;
  return null;
}

/**
 * Extrai a informação de opção pelo Simples Nacional do payload da Receita WS.
 * O campo "simples" é um objeto com a propriedade "optante" (boolean).
 * Retorna `null` se o campo não estiver presente ou não for um objeto válido.
 */
function extractSimplesNacionalReceitaWs(
  payload: Record<string, unknown>,
): boolean | null {
  const simplesObj = asRecord(payload.simples);
  if (!simplesObj) return null;
  if (typeof simplesObj.optante === 'boolean') return simplesObj.optante;
  // Fallback: some responses use string "true"/"false"
  const raw = cleanText(simplesObj.optante).toLowerCase();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return null;
}

function makeAddress(
  address: Omit<ClientAddressData, 'formatted'>,
): ClientAddressData {
  const locality = [address.postal_code, address.city, address.state]
    .filter(Boolean)
    .join(' - ');
  const formatted = [
    [address.street, address.number].filter(Boolean).join(', '),
    address.complement,
    address.district,
    locality,
  ]
    .filter(Boolean)
    .join(' - ');
  return { ...address, formatted };
}

function joinStreet(type: string, street: string) {
  if (!type || !street) return [type, street].filter(Boolean).join(' ');
  return street.toUpperCase().startsWith(`${type.toUpperCase()} `)
    ? street
    : `${type} ${street}`;
}

function assertMatchingCnpj(value: unknown, requestedCnpj: string) {
  const returned = normalizeCnpj(cleanText(value));
  if (returned && returned !== normalizeCnpj(requestedCnpj)) {
    throw new Error('CNPJ_MISMATCH');
  }
}

function deduplicateCnaes(items: CnaeData[]) {
  const unique = new Map<string, CnaeData>();
  for (const item of items) {
    if (item.code && !unique.has(item.code)) unique.set(item.code, item);
  }
  return [...unique.values()];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function arrayRecords(value: unknown) {
  return asArray(value)
    .map(asRecord)
    .filter((item): item is Record<string, unknown> => item !== null);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function digits(value: string) {
  return value.replace(/\D/g, '');
}

function normalizeCnpj(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '');
}
