export function parseFiscalStartDate(value?: string) {
  return value ? new Date(value) : undefined;
}

export function parseFiscalEndDate(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    date.setUTCHours(23, 59, 59, 999);
  }
  return date;
}
