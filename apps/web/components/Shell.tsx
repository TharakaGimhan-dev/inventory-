'use client';

// Shell.tsx is the frame every signed-in page sits inside. On a phone it is a
// header and bottom tabs (capture happens one-handed, in a store room); from
// 900px up it is a left rail, because the register is read at a desk.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { Brand } from '@/components/Brand';

const ICONS: Record<string, React.ReactNode> = {
  register: (
    <>
      <rect x="4" y="3.5" width="16" height="17" rx="1.5" />
      <path d="M8 8.5h8M8 12h8M8 15.5h5" />
    </>
  ),
  capture: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8v8M8 12h8" />
    </>
  ),
  tools: (
    <>
      <path d="M12 15V4M7.5 8.5L12 4l4.5 4.5" />
      <path d="M4.5 14v4.5h15V14" />
    </>
  ),
  more: (
    <>
      <circle cx="6" cy="12" r="1.2" />
      <circle cx="12" cy="12" r="1.2" />
      <circle cx="18" cy="12" r="1.2" />
    </>
  ),
};

const TABS = [
  { href: '/register', label: 'Register', icon: 'register' },
  { href: '/capture', label: 'Capture', icon: 'capture' },
  { href: '/tools', label: 'Tools', icon: 'tools' },
  { href: '/more', label: 'More', icon: 'more' },
];

function NavLinks({ pathname }: { pathname: string }) {
  return (
    <>
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={pathname === tab.href ? 'page' : undefined}
        >
          <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
            {ICONS[tab.icon]}
          </svg>
          {tab.label}
        </Link>
      ))}
    </>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { me } = useAuth();

  const tenant = me?.tenants.find((t) => t.id === me.currentTenantId);

  return (
    <div className="app">
      <aside className="rail">
        <Brand tagline />
        <nav aria-label="Sections">
          <NavLinks pathname={pathname} />
        </nav>
        <div className="rail-foot">
          <b>{tenant?.name ?? 'Organisation'}</b>
          {me?.user.email}
          <br />
          Role: {me?.role}
        </div>
      </aside>

      <header className="header">
        <span className="org">{tenant?.name ?? 'Wardseal'}</span>
        <span className="role">{me?.role}</span>
      </header>

      <main className="content">{children}</main>

      <nav className="tabs" aria-label="Sections">
        <NavLinks pathname={pathname} />
      </nav>
    </div>
  );
}
