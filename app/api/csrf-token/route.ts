import { NextRequest, NextResponse } from 'next/server';
import { generateCsrfToken, setCsrfCookie } from '@/lib/csrf';

export const runtime = 'nodejs';

export async function GET() {
  const token = generateCsrfToken();
  const res = NextResponse.json({ csrfToken: token });
  setCsrfCookie(res, token);
  return res;
}
