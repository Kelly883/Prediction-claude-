import type { Viewport } from 'next';
import './globals.css';
import { display, body, mono } from './fonts';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export const metadata = {
  title: 'PredictPro — Verified football predictions',
  description: 'Football prediction subscriptions with real booking codes, delivered before every matchday.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
