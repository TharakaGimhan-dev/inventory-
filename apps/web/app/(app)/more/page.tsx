'use client';

// The third tab: who you are signed in as, and the way out.
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { canAdmin, useAuth } from '@/lib/auth';
import { outbox } from '@/lib/outbox';
import { UsageBar } from '@/components/UsageBar';
import type { Location, Subscription } from '@/lib/types';

export default function MorePage() {
  const { me, logout, refresh } = useAuth();
  const router = useRouter();
  const [locations, setLocations] = useState<Location[]>([]);
  const [newLocation, setNewLocation] = useState('');
  const [queued, setQueued] = useState(0);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.get<Location[]>('/locations').then(setLocations).catch(() => undefined);
    void outbox.all().then((rows) => setQueued(rows.length));
    void api
      .get<Subscription>('/billing/subscription')
      .then(setSubscription)
      .catch(() => undefined);
  }, []);

  async function addLocation(event: React.FormEvent) {
    event.preventDefault();
    if (!newLocation.trim()) return;

    try {
      const created = await api.post<Location>('/locations', {
        name: newLocation.trim(),
      });
      setLocations([...locations, created]);
      setNewLocation('');
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add that location');
    }
  }

  async function switchTenant(tenantId: string) {
    await api.post('/auth/switch-tenant', { tenantId });
    await refresh();
    router.replace('/register');
  }

  return (
    <>
      <h1>More</h1>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Signed in</h2>
        <p className="muted" style={{ marginBottom: 0 }}>
          {me?.user.email}
          <br />
          Role: {me?.role}
          {queued > 0 ? (
            <>
              <br />
              {queued} capture{queued === 1 ? '' : 's'} waiting to sync
            </>
          ) : null}
        </p>
      </div>

      {subscription ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              marginBottom: 10,
            }}
          >
            <h2 style={{ margin: 0 }}>
              {subscription.plan?.name ?? 'No plan'}
            </h2>
            <Link href="/billing">Plans</Link>
          </div>
          {subscription.metrics.map((metric) => (
            <UsageBar key={metric.metric} metric={metric} />
          ))}
        </div>
      ) : null}

      {(me?.tenants.length ?? 0) > 1 ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2>Organisations</h2>
          {me?.tenants.map((t) => (
            <button
              key={t.id}
              className="ghost"
              style={{ width: '100%', marginBottom: 8, textAlign: 'left' }}
              disabled={t.id === me.currentTenantId}
              onClick={() => void switchTenant(t.id)}
            >
              {t.name} — {t.role}
              {t.id === me.currentTenantId ? ' (current)' : ''}
            </button>
          ))}
        </div>
      ) : null}

      {canAdmin(me?.role) ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2>Locations</h2>
          {error ? <div className="error">{error}</div> : null}

          {locations.length === 0 ? (
            <p className="muted">
              No locations yet. Add the rooms and stores you keep equipment in.
            </p>
          ) : (
            <ul style={{ paddingLeft: 18, margin: '0 0 12px' }}>
              {locations.map((l) => (
                <li key={l.id}>{l.name}</li>
              ))}
            </ul>
          )}

          <form onSubmit={addLocation} style={{ display: 'flex', gap: 8 }}>
            <input
              aria-label="New location name"
              value={newLocation}
              onChange={(e) => setNewLocation(e.target.value)}
              placeholder="Floor 2 store"
            />
            <button className="ghost" type="submit">
              Add
            </button>
          </form>
        </div>
      ) : null}

      <button
        className="ghost"
        style={{ width: '100%' }}
        onClick={async () => {
          await logout();
          router.replace('/login');
        }}
      >
        Sign out
      </button>
    </>
  );
}
