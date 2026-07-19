export type UserRole = 'ADMIN' | 'COLABORADOR' | 'CLIENTE';

export type ObligationType =
    | 'FGTS'
    | 'DARF'
    | 'DAS'
    | 'DAS-PARCSN'
    | 'DAS-PGFN'
    | 'INSS'
    | 'ISS'
    | 'ICMS'
    | 'PIS'
    | 'COFINS'
    | 'CSLL'
    | 'IRPJ'
    | 'DAE'
    | 'OUTROS';

export type ObligationStatus = 'PENDENTE' | 'VENCIDO' | 'PAGO';

export const OBLIGATION_TYPE_LABELS: Record<ObligationType, string> = {
    FGTS: 'FGTS',
    DARF: 'DARF',
    DAS: 'DAS - Simples Nacional',
    'DAS-PARCSN': 'DAS - Parcelamento SN',
    'DAS-PGFN': 'DAS - Parcelamento PGFN',
    INSS: 'INSS',
    ISS: 'ISS',
    ICMS: 'ICMS',
    PIS: 'PIS',
    COFINS: 'COFINS',
    CSLL: 'CSLL',
    IRPJ: 'IRPJ',
    DAE: 'DAE',
    OUTROS: 'Outros',
};

export interface CurrentUser {
    id: string;
    name: string;
    email: string;
    role: UserRole;
}

export interface PaginationParams {
    page: number;
    pageSize: number;
    offset: number;
    limit: number;
}

export interface PaginatedResponse<T> {
    data: T[];
    pagination: {
        page: number;
        pageSize: number;
        total: number;
        totalPages: number;
        hasNext: boolean;
        hasPrev: boolean;
    };
}
