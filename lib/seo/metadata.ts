import type { MetadataRoute } from 'next';

export function buildMetadata(base: {
  title: string;
  description: string;
  pathname?: string;
  image?: string;
  noIndex?: boolean;
}) {
  const baseUrl = process.env.APP_URL || 'http://localhost:3000';
  const url = baseUrl + (base.pathname || '');
  const imageUrl = base.image || `${baseUrl}/og-default.png`;

  return {
    title: base.title,
    description: base.description,
    metadataBase: new URL(baseUrl),
    alternates: { canonical: url },
    robots: base.noIndex ? { index: false, follow: false } : { index: true, follow: true },
    openGraph: {
      title: base.title,
      description: base.description,
      url,
      siteName: 'PredictPro',
      images: [{ url: imageUrl, width: 1200, height: 630 }],
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: base.title,
      description: base.description,
      images: [imageUrl],
    },
  };
}
