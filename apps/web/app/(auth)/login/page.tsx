'use client';

// The sign-in screen. There is no sign-up link here: an admin creates the user
// and the membership, per spec 4.2. Self-signup exists at the API for the
// marketing site, which is a later phase.
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Brand } from '@/components/Brand';

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
    <div className="auth">
      <aside className="auth-side">
        <Brand />
        <div>
          <h2>Know what you own, and prove it.</h2>
          <p>
            Every item gets a code that is never reused, and every change is
            written to a record that nobody — not even an admin — can edit.
          </p>
        </div>
        <ul>
          <li>Capture on a phone, even with no signal. It syncs when you reconnect.</li>
          <li>Print QR labels and stick them on the equipment.</li>
          <li>Export your data any time, on any plan.</li>
        </ul>
      </aside>

      <div className="auth-main">
        <form onSubmit={submit} className="auth-form">
          <div className="brand-wrap">
            <Brand tagline />
          </div>
          <h1>Sign in</h1>
          <p className="muted" style={{ marginBottom: 24 }}>
            Use the email your organisation&rsquo;s admin registered for you.
          </p>

          {error ? <div className="error" role="alert">{error}</div> : null}

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

          <p className="muted" style={{ marginTop: 20 }}>
            No account? Your organisation&rsquo;s admin creates it for you.
          </p>
        </form>
      </div>
    </div>
  );
}
