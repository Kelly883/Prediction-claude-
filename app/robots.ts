import { MetadataRoute } from 'next';
import { getBaseUrl } from '@/lib/seo/metadata';

export default function robots(): MetadataRoute.Robots {
  const baseUrl = getBaseUrl();

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin/', '/api/', '/dashboard/', '/forgot-password', '/reset-password', '/payments/callback', '/superadmin/setup'],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
