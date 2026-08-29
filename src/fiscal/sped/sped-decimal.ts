const DECIMAL_PATTERN = /^-?\d+(?:\.\d+)?$/;

export function toScaledInteger(
  value: string | null | undefined,
  scale = 2,
): bigint {
  if (value == null || value === '') return 0n;
  const normalized = value.trim().replace(',', '.');
  if (!DECIMAL_PATTERN.test(normalized)) {
    throw new TypeError(`Valor decimal fiscal inválido: ${value}`);
  }
  const negative = normalized.startsWith('-');
  const absolute = negative ? normalized.slice(1) : normalized;
  const [integer, fraction = ''] = absolute.split('.');
  const paddedFraction = `${fraction}${'0'.repeat(scale)}`.slice(0, scale);
  const extra = fraction.slice(scale);
  let result = BigInt(integer) * 10n ** BigInt(scale) + BigInt(paddedFraction);
  if (extra && Number(extra[0]) >= 5) result += 1n;
  return negative ? -result : result;
}

export function fromScaledInteger(value: bigint, scale = 2): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const divisor = 10n ** BigInt(scale);
  const integer = absolute / divisor;
  const fraction = (absolute % divisor).toString().padStart(scale, '0');
  return `${negative ? '-' : ''}${integer}.${fraction}`;
}

export function sumFiscalValues(
  values: Array<string | null | undefined>,
): string {
  return fromScaledInteger(
    values.reduce((sum, value) => sum + toScaledInteger(value), 0n),
  );
}

export function positive(value: bigint): bigint {
  return value > 0n ? value : 0n;
}

export function maximum(first: bigint, second: bigint): bigint {
  return first > second ? first : second;
}

export function differenceWithinTolerance(
  first: string,
  second: string,
  tolerance = '0.02',
) {
  const difference = toScaledInteger(first) - toScaledInteger(second);
  const absolute = difference < 0n ? -difference : difference;
  return absolute <= toScaledInteger(tolerance);
}
