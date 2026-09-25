'use client';

// The register: what the organisation owns, newest first.
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { outbox } from '@/lib/outbox';
import { STATUS_LABELS, type Asset, type Paged } from '@/lib/types';

export default function RegisterPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [queued, setQueued] = useState<Asset[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (q.trim()) params.set('q', q.trim());

      const page = await api.get<Paged<Asset>>(`/assets?${params}`);
      setAssets(page.items);
      setTotal(page.total);
      setError(null);
    } catch (e) {
      // Offline, or the API is down. Saying so beats showing an empty register,
      // which reads as "you own nothing".
      setError(
        e instanceof Error ? e.message : 'Could not load the register',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  // Anything still in the outbox is shown above the real rows, so a capture
  // made offline does not look like it vanished.
  const loadQueued = useCallback(async () => {
    const rows = await outbox.all();
    setQueued(
      rows.map((r) => ({
        id: r.id,
        code: 'Pending',
        kind: (r.payload.kind as Asset['kind']) ?? 'asset',
        name: String(r.payload.name ?? 'Untitled'),
        description: null,
        status: (r.payload.status as Asset['status']) ?? 'in_use',
        condition: 'good',
        serialNumber: null,
        locationId: null,
        categoryId: null,
        purchasePrice: null,
        replacementValue: null,
        quantity: 1,
        createdAt: new Date(r.createdAt).toISOString(),
        pending: true,
      })),
    );
  }, []);

  useEffect(() => {
    void loadQueued();
  }, [loadQueued]);

  // Debounced, so typing "laptop" is one request rather than six.
  useEffect(() => {
    const timer = setTimeout(() => void load(query), 250);
    return () => clearTimeout(timer);
  }, [query, load]);

  return (
    <>
      <h1>Register</h1>
      <p className="muted" style={{ marginBottom: 14 }}>
        {loading ? 'Loading…' : `${total} item${total === 1 ? '' : 's'}`}
        {queued.length > 0 ? ` · ${queued.length} waiting to sync` : ''}
      </p>

      <div className="field">
        <label htmlFor="q" className="muted" style={{ fontWeight: 400 }}>
          Search by name, code or serial number
        </label>
        <input
          id="q"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Dell laptop, TS-0001…"
        />
      </div>

      {error ? <div className="error">{error}</div> : null}

      <div className="assets">
        {queued.map((asset) => (
          <AssetRow key={asset.id} asset={asset} />
        ))}
        {assets.map((asset) => (
          <AssetRow key={asset.id} asset={asset} />
        ))}
      </div>

      {!loading && assets.length === 0 && queued.length === 0 && !error ? (
        <div className="empty">
          {query
            ? `Nothing matches “${query}”.`
            : 'Nothing captured yet. Use the Capture tab to add the first item.'}
        </div>
      ) : null}
    </>
  );
}

function AssetRow({ asset }: { asset: Asset }) {
  return (
    <article className={asset.pending ? 'asset pending' : 'asset'}>
      <span className="code">{asset.code}</span>
      <span className="name">{asset.name}</span>
      <span className="meta">
        {asset.kind === 'consumable' ? `Qty ${asset.quantity} · ` : ''}
        {asset.serialNumber ?? 'No serial number'}
      </span>
      <span className={`pill ${asset.pending ? 'queued' : asset.status}`}>
        {asset.pending ? 'Waiting' : STATUS_LABELS[asset.status]}
      </span>
    </article>
  );
}
