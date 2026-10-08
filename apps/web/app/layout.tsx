import type { Metadata, Viewport } from 'next';
import { AuthProvider } from '@/lib/auth';
import './globals.css';

export const metadata: Metadata = {
  title: 'Wardseal — tamper-evident inventory',
  description:
    'Every asset counted, coded and sealed into an audit trail nobody can edit.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The app is a mobile capture tool; a pinch-zoom on a form field is a
  // misfire, but zoom itself stays available for anyone who needs it.
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f1ebdf' },
    { media: '(prefers-color-scheme: dark)', color: '#16130f' },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
