'use client';

// Shell.tsx is the header and the bottom tabs - the mobile frame every
// signed-in page sits inside, per spec 8.1.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';

const TABS = [
  { href: '/register', label: 'Register', glyph: '▤' },
  { href: '/capture', label: 'Capture', glyph: '＋' },
  { href: '/more', label: 'More', glyph: '⋯' },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { me } = useAuth();

  const tenant = me?.tenants.find((t) => t.id === me.currentTenantId);

  return (
    <div className="shell">
      <header className="header">
        <span className="org">{tenant?.name ?? 'Asset Register'}</span>
        <span className="muted">{me?.role}</span>
      </header>

      <main className="content">{children}</main>

      <nav className="tabs" aria-label="Sections">
        {TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={pathname === tab.href ? 'page' : undefined}
          >
            <span className="glyph" aria-hidden="true">
              {tab.glyph}
            </span>
            {tab.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
