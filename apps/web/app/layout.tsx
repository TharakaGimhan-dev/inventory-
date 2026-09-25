import type { Metadata, Viewport } from 'next';
import { AuthProvider } from '@/lib/auth';
import './globals.css';

export const metadata: Metadata = {
  title: 'TS Asset Register',
  description: 'Office asset inventory',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The app is a mobile capture tool; a pinch-zoom on a form field is a
  // misfire, but zoom itself stays available for anyone who needs it.
  viewportFit: 'cover',
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
