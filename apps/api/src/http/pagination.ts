import { z } from 'zod';

export const MAX_PAGE_SIZE = 100;

/**
 * Shared pagination contract. Every list endpoint uses the same parameters and
 * the same `meta` envelope so clients can build one table component.
 */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(25),
});

export interface Pagination {
  readonly page: number;
  readonly pageSize: number;
  readonly skip: number;
  readonly take: number;
}

export interface PageMeta {
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
  readonly hasNext: boolean;
}

export function toPagination(input: z.infer<typeof paginationSchema>): Pagination {
  return {
    page: input.page,
    pageSize: input.pageSize,
    skip: (input.page - 1) * input.pageSize,
    take: input.pageSize,
  };
}

export function pageMeta(total: number, pagination: Pagination): PageMeta {
  const totalPages = Math.max(1, Math.ceil(total / pagination.pageSize));
  return {
    page: pagination.page,
    pageSize: pagination.pageSize,
    total,
    totalPages,
    hasNext: pagination.page < totalPages,
  };
}

/** JSON-safe representation of an integer minor-unit amount. */
export function money(value: bigint | null | undefined): string | null {
  return value === null || value === undefined ? null : value.toString();
}
