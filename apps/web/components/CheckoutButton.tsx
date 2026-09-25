'use client';

// CheckoutButton.tsx hands the browser off to the payment provider.
//
// The API returns the form fields rather than a redirect, so the app decides
// how to render it. They are posted as a real form: the provider expects a POST
// and the browser has to leave this origin for it.
import { useState } from 'react';
import { ApiError, api } from '@/lib/api';

type CheckoutSession = { action: string; fields: Record<string, string> };

export function CheckoutButton({
  planCode,
  planName,
}: {
  planCode: string;
  planName: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);

    try {
      const session = await api.post<CheckoutSession>('/billing/subscribe', {
        planCode,
      });

      // Built and submitted rather than rendered, so the fields are never
      // sitting in the page where something could alter them before submit.
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = session.action;

      for (const [name, value] of Object.entries(session.fields)) {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = name;
        input.value = value;
        form.appendChild(input);
      }

      document.body.appendChild(form);
      form.submit();
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : 'Could not start the payment. Please try again.',
      );
      setBusy(false);
    }
  }

  return (
    <>
      {error ? <div className="error">{error}</div> : null}
      <button className="primary" onClick={start} disabled={busy}>
        {busy ? 'Opening payment…' : `Upgrade to ${planName}`}
      </button>
    </>
  );
}
