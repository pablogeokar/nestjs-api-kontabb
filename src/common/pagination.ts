import type { PaginatedResponse, PaginationParams } from './types';

export const DEFAULT_PAGE_SIZE = 15;
export const MAX_PAGE_SIZE = 100;

export function parsePaginationParams(query: {
    page?: string;
    pageSize?: string;
}): PaginationParams {
    const rawPage = parseInt(query.page || '1', 10);
    const rawPageSize = parseInt(query.pageSize || String(DEFAULT_PAGE_SIZE), 10);

    const page = Math.max(1, isNaN(rawPage) ? 1 : rawPage);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, isNaN(rawPageSize) ? DEFAULT_PAGE_SIZE : rawPageSize));

    return {
        page,
        pageSize,
        offset: (page - 1) * pageSize,
        limit: pageSize,
    };
}

export function buildPaginatedResponse<T>(
    data: T[],
    total: number,
    params: PaginationParams,
): PaginatedResponse<T> {
    const totalPages = Math.max(1, Math.ceil(total / params.pageSize));

    return {
        data,
        pagination: {
            page: params.page,
            pageSize: params.pageSize,
            total,
            totalPages,
            hasNext: params.page < totalPages,
            hasPrev: params.page > 1,
        },
    };
}
