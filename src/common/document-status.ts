import type { ObligationStatus } from './types';

export function getBahiaDate(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Bahia',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(now);
    const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${value.year}-${value.month}-${value.day}`;
}

export function deriveDocumentStatus(
    persistedStatus: string,
    dueDate: string | null,
    today = getBahiaDate(),
): ObligationStatus {
    if (persistedStatus === 'PAGO') return 'PAGO';
    return dueDate && dueDate < today ? 'VENCIDO' : 'PENDENTE';
}
