import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { faviconURI } from '@/components/favicon';
import './globals.css';

const inter = Inter({ variable: '--font-inter', subsets: ['latin'], weight: ['400', '500', '600', '700', '800'] });

export const metadata: Metadata = {
  title: 'Shift Monitor',
  description: 'Live shift and break tracking for your team.',
  icons: { icon: faviconURI(false) },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
