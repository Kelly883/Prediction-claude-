import type { Metadata } from 'next';

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
  alternates?: { languages?: Record<string, string>; canonical?: string; types?: Record<string, string> };
}) {
  const rawBase = process.env.APP_URL || 'http://localhost:3000';
  const baseUrl = toAbsoluteUrl(rawBase);
  const pathname = base.pathname || '';
  const url = baseUrl + pathname;
  const imageUrl = base.image || `${baseUrl}/og-default.svg`;

  const alternates: Metadata['alternates'] = {
    canonical: base.alternates?.canonical || url,
  };

  if (base.alternates?.languages) {
    alternates.languages = base.alternates.languages;
  } else {
    alternates.languages = {
      en: url,
      'x-default': url,
    };
  }

  if (base.alternates?.types) {
    alternates.types = base.alternates.types;
  }

  return {
    title: base.title,
    description: base.description,
    metadataBase: new URL(baseUrl),
    alternates,
    robots: base.noIndex ? { index: false, follow: false } : { index: true, follow: true },
    openGraph: {
      title: base.title,
      description: base.description,
      url,
      siteName: 'PredictPro',
      images: [{ url: imageUrl, width: 1200, height: 630 }],
      type: 'website',
      locale: 'en_US',
      alternateLocale: [],
    },
    twitter: {
      card: 'summary_large_image',
      title: base.title,
      description: base.description,
      images: [imageUrl],
    },
  } satisfies Metadata;
}

export function getBaseUrl(): string {
  const raw = process.env.APP_URL || 'http://localhost:3000';
  return toAbsoluteUrl(raw);
}