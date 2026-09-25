'use client';

// The root decides where to send someone, once we know whether they are signed
// in. It renders nothing itself.
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/lib/auth';

export default function Index() {
  const { me, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(me ? '/register' : '/login');
  }, [me, loading, router]);

  return (
    <div className="centre">
      <p className="muted">Loading…</p>
    </div>
  );
}
