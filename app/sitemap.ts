import { MetadataRoute } from 'next';
import { prisma } from '@/lib/prisma';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.APP_URL || 'https://predictpro.com';

  const staticPages = [
    '',
    '/pricing',
    '/faq',
    '/login',
    '/register',
    '/forgot-password',
    '/reset-password',
    '/verify-email',
    '/terms',
    '/privacy',
  ].map((path) => ({
    url: `${baseUrl}${path}`,
    lastModified: new Date(),
    changeFrequency: 'weekly' as const,
    priority: path === '' ? 1 : 0.8,
  }));

  let dynamicPages: MetadataRoute.Sitemap = [];

  try {
    const posts = await prisma.predictionPost.findMany({
      where: { status: 'published' },
      select: { id: true, updatedAt: true },
    });

    dynamicPages = posts.map((post) => ({
      url: `${baseUrl}/dashboard/predictions/${post.id}`,
      lastModified: post.updatedAt,
      changeFrequency: 'daily' as const,
      priority: 0.6,
    }));
  } catch {
    // Database unavailable — return static pages only
  }

  return [...staticPages, ...dynamicPages];
}
