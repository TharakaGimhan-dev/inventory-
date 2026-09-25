'use client';

// The auth guard. Everything under (app) requires a signed-in user with a
// membership; anyone else is sent to the sign-in screen.
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Shell } from '@/components/Shell';
import { useAuth } from '@/lib/auth';

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { me, loading, error } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !me && !error) router.replace('/login');
  }, [me, loading, error, router]);

  if (loading) {
    return (
      <div className="shell">
        <div className="centre">
          <p className="muted">Loading…</p>
        </div>
      </div>
    );
  }

  // A signed-in user with no membership. Carried over from the Firebase app,
  // where the same case arrived as permission-denied rather than a 401.
  if (error) {
    return (
      <div className="shell">
        <div className="centre">
          <div style={{ textAlign: 'center', maxWidth: 340 }}>
            <h1>Account not linked</h1>
            <p className="muted">{error}</p>
            <p className="muted">
              Your account is not linked to an organisation. Ask your admin to
              add you.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!me) return null;

  return <Shell>{children}</Shell>;
}
