import { MetadataRoute } from 'next';
import { getPublishedTipCount } from '@/lib/stats';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.APP_URL || 'http://localhost:3000';

  const publicPages = [
    { url: `${baseUrl}/`, priority: 1.0, changeFrequency: 'daily' as const },
    { url: `${baseUrl}/football-predictions`, priority: 0.9, changeFrequency: 'weekly' as const },
    { url: `${baseUrl}/pricing`, priority: 0.9, changeFrequency: 'weekly' as const },
    { url: `${baseUrl}/faq`, priority: 0.8, changeFrequency: 'weekly' as const },
    { url: `${baseUrl}/privacy`, priority: 0.3, changeFrequency: 'monthly' as const },
    { url: `${baseUrl}/terms`, priority: 0.3, changeFrequency: 'monthly' as const },
    { url: `${baseUrl}/archive`, priority: 0.7, changeFrequency: 'daily' as const },
  ];

  const tipCount = await getPublishedTipCount();
  if (tipCount > 0) {
    publicPages.push(
      { url: `${baseUrl}/predictions/today`, priority: 0.8, changeFrequency: 'daily' as const },
      { url: `${baseUrl}/predictions/tomorrow`, priority: 0.8, changeFrequency: 'daily' as const },
    );
  }

  const leagues = [
    'premier-league',
    'champions-league',
    'la-liga',
    'serie-a',
    'bundesliga',
  ];
  for (const league of leagues) {
    publicPages.push({
      url: `${baseUrl}/leagues/${league}`,
      priority: 0.7,
      changeFrequency: 'weekly' as const,
    });
  }

  return publicPages;
}
