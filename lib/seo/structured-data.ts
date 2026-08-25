export const ORG_JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'PredictPro',
  url: process.env.APP_URL || 'http://localhost:3000',
  description: 'Football prediction subscription platform',
};

export const WEBSITE_JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'PredictPro',
  url: process.env.APP_URL || 'http://localhost:3000',
  description: 'Football prediction subscriptions with real booking codes',
};

export function breadcrumbJsonLd(items: { name: string; href: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.href,
    })),
  };
}

export function articleJsonLd(params: {
  title: string;
  description: string;
  publishedAt: string;
  updatedAt?: string;
  authorName?: string;
  pathname: string;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: params.title,
    description: params.description,
    datePublished: params.publishedAt,
    dateModified: params.updatedAt || params.publishedAt,
    author: params.authorName ? { '@type': 'Person', name: params.authorName } : undefined,
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': `${process.env.APP_URL || 'http://localhost:3000'}${params.pathname}`,
    },
  };
}

export function faqJsonLd(items: { question: string; answer: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  };
}
