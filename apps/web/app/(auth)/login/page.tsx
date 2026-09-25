'use client';

// The sign-in screen. There is no sign-up link here: an admin creates the user
// and the membership, per spec 4.2. Self-signup exists at the API for the
// marketing site, which is a later phase.
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function LoginPage() {
  const router = useRouter();
  const { me, refresh } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (me) router.replace('/register');
  }, [me, router]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      await api.post('/auth/login', { email, password });
      await refresh();
      router.replace('/register');
    } catch (e) {
      // The API returns one message for an unknown account and a wrong
      // password alike, so the screen cannot be used to discover who has one.
      setError(
        e instanceof ApiError ? e.message : 'Could not sign in. Try again.',
      );
      setBusy(false);
    }
  }

  return (
    <div className="shell">
      <div className="centre">
        <form onSubmit={submit} style={{ width: '100%', maxWidth: 380 }}>
          <h1>TS Asset Register</h1>
          <p className="muted" style={{ marginBottom: 24 }}>
            Sign in to your organisation&rsquo;s inventory.
          </p>

          {error ? <div className="error">{error}</div> : null}

          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <button className="primary" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          <p className="muted" style={{ marginTop: 20, textAlign: 'center' }}>
            No account? Your organisation&rsquo;s admin creates it for you.
          </p>
        </form>
      </div>
    </div>
  );
}
