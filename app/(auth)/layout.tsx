import { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo/metadata';

export const metadata: Metadata = buildMetadata({
  title: 'Authentication — PredictPro',
  description: 'Sign in or create an account to access PredictPro football predictions.',
  pathname: '/',
  noIndex: true,
});

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children;
}