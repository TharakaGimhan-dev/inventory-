'use client';

// Unreachable.tsx is shown when the API cannot be reached. The seal cracks and
// radar rings search for a signal; it retries by itself every 15 seconds so a
// phone that walks back into coverage recovers without a tap.
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';

const RETRY_SECONDS = 15;

export function Unreachable() {
  const { refresh } = useAuth();
  const [left, setLeft] = useState(RETRY_SECONDS);
  const [trying, setTrying] = useState(false);

  async function retry() {
    setTrying(true);
    await refresh();
    setTrying(false);
    setLeft(RETRY_SECONDS);
  }

  useEffect(() => {
    if (trying) return;
    if (left <= 0) {
      void retry();
      return;
    }
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left, trying]);

  return (
    <div className="centre">
      <div className="unreach" role="status" aria-live="polite">
        <div className="unreach-art" aria-hidden="true">
          <span className="ring r1" />
          <span className="ring r2" />
          <span className="ring r3" />
          <svg viewBox="0 0 64 64" className="unreach-seal">
            <path
              fill="var(--accent)"
              d="M32 3l7.5 5.2 9-1.1 3.6 8.3 8.3 3.6-1.1 9L64 32l-5.2 7.5 1.1 9-8.3 3.6-3.6 8.3-9-1.1L32 61l-7.5-5.2-9 1.1-3.6-8.3-8.3-3.6 1.1-9L0 32l5.2-7.5-1.1-9 8.3-3.6 3.6-8.3 9 1.1z"
            />
            <path
              className="crack"
              d="M33 6l-5 14 8 7-9 9 7 8-4 13"
              fill="none"
              stroke="var(--paper)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <h1>Can&rsquo;t reach Wardseal right now</h1>
        <p className="muted">
          Your connection or the server is down. Nothing is lost: anything you
          captured is kept on this device and syncs once we are back.
        </p>

        <button className="primary" onClick={() => void retry()} disabled={trying}>
          {trying ? 'Trying…' : 'Try again'}
        </button>
        <p className="muted unreach-count">
          {trying ? 'Checking the connection…' : `Trying again in ${left}s`}
        </p>
      </div>
    </div>
  );
}
