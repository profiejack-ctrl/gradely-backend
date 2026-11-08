export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: PaginationMeta;
}

/**
 * Calculates SQL range bounds for Supabase (.range(from, to))
 * Enforces safe minimums and a max limit (100) to prevent denial of service.
 */
export function getPaginationBounds(page: any = 1, limit: any = 25): {
  from: number;
  to: number;
  safePage: number;
  safeLimit: number;
} {
  const parsedPage = Number(page);
  const parsedLimit = Number(limit);

  const safePage = Number.isFinite(parsedPage) && parsedPage >= 1 ? Math.floor(parsedPage) : 1;
  const safeLimit = Number.isFinite(parsedLimit) && parsedLimit >= 1
    ? Math.min(100, Math.floor(parsedLimit))
    : 25;

  const from = (safePage - 1) * safeLimit;
  const to = from + safeLimit - 1;

  return { from, to, safePage, safeLimit };
}

/**
 * Builds standardized metadata for paginated responses
 */
export function buildPaginationMeta(total: number, page: number, limit: number): PaginationMeta {
  const totalPages = Math.ceil(total / limit) || 1;
  return {
    page,
    limit,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}
