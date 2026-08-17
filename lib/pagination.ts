import { NextRequest, NextResponse } from 'next/server';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export function parsePagination(req: NextRequest) {
  const page = Math.max(1, parseInt(req.nextUrl.searchParams.get('page') || '1', 10) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(req.nextUrl.searchParams.get('pageSize') || String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE));
  const cursor = req.nextUrl.searchParams.get('cursor') || undefined;
  return { page, pageSize, cursor, offset: (page - 1) * pageSize };
}

export function paginate<T>(items: T[], page: number, pageSize: number) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  const paginatedItems = items.slice(start, start + pageSize);
  return {
    items: paginatedItems,
    page,
    pageSize,
    total,
    totalPages,
  };
}

export function withPaginationHeaders(res: NextResponse, page: number, pageSize: number, total: number) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  res.headers.set('X-Page', String(page));
  res.headers.set('X-Page-Size', String(pageSize));
  res.headers.set('X-Total', String(total));
  res.headers.set('X-Total-Pages', String(totalPages));
  return res;
}
