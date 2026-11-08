"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPaginationBounds = getPaginationBounds;
exports.buildPaginationMeta = buildPaginationMeta;
/**
 * Calculates SQL range bounds for Supabase (.range(from, to))
 * Enforces safe minimums and a max limit (100) to prevent denial of service.
 */
function getPaginationBounds(page = 1, limit = 25) {
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
function buildPaginationMeta(total, page, limit) {
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
