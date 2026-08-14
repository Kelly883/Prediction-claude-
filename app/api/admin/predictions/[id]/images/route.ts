import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, errorResponse } from '@/lib/rbac';
import { uploadMedia } from '@/lib/media';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs'; // sharp requires the Node runtime

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin(req);
    const { id: postId } = await params;
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'file is required' }, { status: 400 });

    const asset = await uploadMedia(postId, file);
    await writeAudit({ actorId: admin.sub, action: 'prediction.image_upload', targetId: postId, metadata: { mediaId: asset.id } });
    return NextResponse.json(asset);
  } catch (err) {
    return errorResponse(err);
  }
}
