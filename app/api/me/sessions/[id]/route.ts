import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser, errorResponse } from '@/lib/rbac';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req);
    const { id: sessionId } = await params;

    const session = await prisma.userSession.findUnique({ where: { id: sessionId } });
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    if (session.userId !== user.sub) {
      return NextResponse.json({ error: 'Not authorized to revoke this session' }, { status: 403 });
    }

    await prisma.userSession.delete({ where: { id: sessionId } });

    await writeAudit({
      actorId: user.sub,
      action: 'auth.session_revoked',
      targetId: sessionId,
      metadata: { userId: user.sub },
    });

    return NextResponse.json({ success: true, message: 'Session revoked' });
  } catch (err) {
    return errorResponse(err);
  }
}
