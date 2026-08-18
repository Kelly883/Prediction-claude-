import { NextRequest, NextResponse } from 'next/server';

export function getRequestId(req: NextRequest): string {
  const header = req.headers.get('x-request-id');
  if (header && /^[a-f0-9\-]+$/i.test(header)) {
    return header;
  }
  return crypto.randomUUID();
}

export function withRequestId(req: NextRequest, res: NextResponse): NextResponse {
  const requestId = getRequestId(req);
  res.headers.set('x-request-id', requestId);
  return res;
}
