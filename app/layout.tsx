import type { Viewport, Metadata } from 'next';
import './globals.css';
import { display, body, mono } from './fonts';
import { buildMetadata } from '@/lib/seo/metadata';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export const metadata: Metadata = buildMetadata({
  title: 'PredictPro — Verified football predictions',
  description: 'Football prediction subscriptions with real booking codes, delivered before every matchday.',
  pathname: '/',
  alternates: {
    types: {
      'application/rss+xml': '/feed',
    },
  },
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <head>
        <link rel="manifest" href="/manifest.json" />
        <link rel="alternate" type="application/rss+xml" title="PredictPro Predictions Feed" href="/feed" />
        <meta name="theme-color" content="#16A34A" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="PredictPro" />
        <link rel="apple-touch-icon" href="/icon-192.svg" />
      </head>
      <body>
        {children}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', () => {
                  navigator.serviceWorker.register('/sw.js').catch(() => {});
                });
              }
            `,
          }}
        />
      </body>
    </html>
  );
}