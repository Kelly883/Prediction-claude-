import type { MetadataRoute } from 'next';

function toAbsoluteUrl(input: string): string {
  if (!input.startsWith('http://') && !input.startsWith('https://')) {
    return `https://${input}`;
  }
  return input;
}

export function buildMetadata(base: {
  title: string;
  description: string;
  pathname?: string;
  image?: string;
  noIndex?: boolean;
}) {
  const rawBase = process.env.APP_URL || 'http://localhost:3000';
  const baseUrl = toAbsoluteUrl(rawBase);
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

export function getBaseUrl(): string {
  const raw = process.env.APP_URL || 'http://localhost:3000';
  return toAbsoluteUrl(raw);
}

