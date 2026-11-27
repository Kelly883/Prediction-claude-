import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getBaseUrl } from '@/lib/seo/metadata';

export const dynamic = 'force-dynamic';
export const revalidate = 3600;

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&apos;');
}

export async function GET() {
  const baseUrl = getBaseUrl();
  
  const posts = await prisma.predictionPost.findMany({
    where: { status: 'archived', outcome: { in: ['won', 'lost'] } },
    orderBy: { updatedAt: 'desc' },
    take: 50,
    include: { items: true },
  });

  const feedUrl = `${baseUrl}/feed.xml`;
  const siteUrl = baseUrl;

  const itemsXml = posts.map((post) => {
    const postUrl = `${baseUrl}/archive/${post.id}`;
    const pubDate = new Date(post.scheduledAt).toUTCString();
    const description = post.items
      ?.map((item) => `${item.match}: ${item.prediction}`)
      .join('; ') || 'Football prediction result';

    return `
    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${postUrl}</link>
      <guid isPermaLink="true">${postUrl}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${escapeXml(description)}</description>
      ${post.bookingCode ? `<category>${escapeXml(post.bookingCode)}</category>` : ''}
      <category>${escapeXml(post.outcome)}</category>
    </item>`;
  }).join('');

  const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>PredictPro — Football Predictions Archive</title>
    <link>${siteUrl}</link>
    <description>Verified football predictions with real booking codes. Transparent results archive.</description>
    <language>en</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${feedUrl}" rel="self" type="application/rss+xml" />
    <generator>PredictPro</generator>
    <ttl>60</ttl>
    ${itemsXml}
  </channel>
</rss>`;

  return new NextResponse(rssXml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}