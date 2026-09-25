'use client';

// The capture form. Built for someone standing in a store room with a phone in
// one hand, so: few fields visible, the ones that repeat stay filled, and a
// capture made with no signal is queued rather than lost.
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { canAdmin, canWrite, useAuth } from '@/lib/auth';
import { flushOutbox, outbox } from '@/lib/outbox';
import type { Asset, Category, Location } from '@/lib/types';

// Kept between captures. Someone logging a room of chairs sets the location
// once, not twenty times. Name and serial number are deliberately not sticky -
// they are what makes each row different.
type Sticky = { locationId: string; categoryId: string; status: string };

const EMPTY = {
  kind: 'asset' as 'asset' | 'consumable',
  name: '',
  serialNumber: '',
  quantity: '1',
  purchasePrice: '',
  replacementValue: '',
};

export default function CapturePage() {
  const { me } = useAuth();
  const [form, setForm] = useState(EMPTY);
  const [sticky, setSticky] = useState<Sticky>({
    locationId: '',
    categoryId: '',
    status: 'in_use',
  });

  const [locations, setLocations] = useState<Location[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [lastCreated, setLastCreated] = useState<Asset | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [online, setOnline] = useState(true);

  const writable = canWrite(me?.role);

  const countQueued = useCallback(async () => {
    setPendingCount((await outbox.all()).length);
  }, []);

  // Sends whatever is queued. Each entry carries the idempotency key it was
  // written with, so running this twice cannot create the asset twice.
  const flush = useCallback(async () => {
    const result = await flushOutbox((payload, key) =>
      api.post<Asset>('/assets', payload, key),
    );

    if (result.sent.length > 0) {
      setToast(
        `${result.sent.length} queued capture${result.sent.length === 1 ? '' : 's'} synced`,
      );
    }
    if (result.failed > 0) {
      setError(
        `${result.failed} queued capture${result.failed === 1 ? ' was' : 's were'} rejected by the server and removed.`,
      );
    }

    await countQueued();
  }, [countQueued]);

  useEffect(() => {
    setOnline(navigator.onLine);
    void countQueued();
    if (navigator.onLine) void flush();

    const back = () => {
      setOnline(true);
      void flush();
    };
    const gone = () => setOnline(false);

    window.addEventListener('online', back);
    window.addEventListener('offline', gone);
    return () => {
      window.removeEventListener('online', back);
      window.removeEventListener('offline', gone);
    };
  }, [flush, countQueued]);

  useEffect(() => {
    if (!writable) return;
    void api.get<Location[]>('/locations').then(setLocations).catch(() => undefined);
    void api.get<Category[]>('/categories').then(setCategories).catch(() => undefined);
  }, [writable]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  if (!writable) {
    return (
      <>
        <h1>Capture</h1>
        <div className="banner">
          You have view-only access. Ask an admin for the entry role to add
          items.
        </div>
      </>
    );
  }

  function payloadFrom(): Record<string, unknown> {
    const body: Record<string, unknown> = {
      kind: form.kind,
      name: form.name.trim(),
      status: sticky.status,
    };

    if (form.serialNumber.trim()) body.serialNumber = form.serialNumber.trim();
    if (sticky.locationId) body.locationId = sticky.locationId;
    if (sticky.categoryId) body.categoryId = sticky.categoryId;
    if (form.kind === 'consumable') body.quantity = Number(form.quantity || 1);
    if (form.purchasePrice.trim()) body.purchasePrice = form.purchasePrice.trim();

    // Only admins and owners may send this at all - the API returns 403
    // otherwise, so the field is not even rendered for an entry clerk.
    if (canAdmin(me?.role) && form.replacementValue.trim()) {
      body.replacementValue = form.replacementValue.trim();
    }

    return body;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setLastCreated(null);

    const payload = payloadFrom();

    try {
      // One key per capture attempt, reused if this ends up in the outbox.
      const asset = await api.post<Asset>('/assets', payload, crypto.randomUUID());
      setLastCreated(asset);
      setToast(`${asset.code} captured`);
      setForm({ ...EMPTY, kind: form.kind });
    } catch (e) {
      const offline = !navigator.onLine || !(e instanceof ApiError);

      if (offline && outbox.available()) {
        // The server was unreachable, so the capture is kept rather than lost.
        // The code is assigned when it syncs - it has to stay gapless, and a
        // phone cannot promise that.
        await outbox.add(payload);
        await countQueued();
        setToast('No connection — saved and will sync');
        setForm({ ...EMPTY, kind: form.kind });
      } else {
        setError(e instanceof Error ? e.message : 'Could not save this item');
      }
    } finally {
      setBusy(false);
    }
  }

  // Undo removes the row the person just made. Only for a capture that reached
  // the server: a queued one has no id yet.
  async function undo() {
    if (!lastCreated) return;
    try {
      await api.del(`/assets/${lastCreated.id}`);
      setToast(`${lastCreated.code} removed`);
      setLastCreated(null);
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 403
          ? 'Only an admin can remove an item.'
          : 'Could not undo that.',
      );
    }
  }

  return (
    <>
      <h1>Capture</h1>
      <p className="muted" style={{ marginBottom: 14 }}>
        The asset code is issued when it saves.
      </p>

      {!online ? (
        <div className="banner">
          You are offline. Captures are saved on this phone and sync when the
          connection returns.
        </div>
      ) : null}

      {pendingCount > 0 ? (
        <div className="banner">
          {pendingCount} capture{pendingCount === 1 ? '' : 's'} waiting to sync.
        </div>
      ) : null}

      {error ? <div className="error">{error}</div> : null}

      <form onSubmit={submit} className="card">
        <div className="field">
          <label htmlFor="kind">Type</label>
          <select
            id="kind"
            value={form.kind}
            onChange={(e) =>
              setForm({ ...form, kind: e.target.value as typeof form.kind })
            }
          >
            <option value="asset">Asset — tracked individually</option>
            <option value="consumable">Consumable — counted as stock</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="name">Name</label>
          <input
            id="name"
            required
            maxLength={160}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Dell Latitude 5420"
          />
        </div>

        {/* Conditional, per spec: a consumable is counted, an asset has a serial. */}
        {form.kind === 'consumable' ? (
          <div className="field">
            <label htmlFor="quantity">Quantity</label>
            <input
              id="quantity"
              type="number"
              min={1}
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: e.target.value })}
            />
          </div>
        ) : (
          <div className="field">
            <label htmlFor="serial">Serial number</label>
            <input
              id="serial"
              value={form.serialNumber}
              onChange={(e) =>
                setForm({ ...form, serialNumber: e.target.value })
              }
              placeholder="Optional"
            />
          </div>
        )}

        <div className="row">
          <div className="field">
            <label htmlFor="location">Location</label>
            <select
              id="location"
              value={sticky.locationId}
              onChange={(e) =>
                setSticky({ ...sticky, locationId: e.target.value })
              }
            >
              <option value="">Not set</option>
              {locations
                .filter((l) => l.isActive)
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="status">Status</label>
            <select
              id="status"
              value={sticky.status}
              onChange={(e) => setSticky({ ...sticky, status: e.target.value })}
            >
              <option value="in_use">In use</option>
              <option value="in_store">In store</option>
              <option value="repair">Repair</option>
            </select>
          </div>
        </div>

        <div className="field">
          <label htmlFor="category">Category</label>
          <select
            id="category"
            value={sticky.categoryId}
            onChange={(e) =>
              setSticky({ ...sticky, categoryId: e.target.value })
            }
          >
            <option value="">Not set</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className={canAdmin(me?.role) ? 'row' : 'field'}>
          <div className="field">
            <label htmlFor="price">Purchase price (LKR)</label>
            <input
              id="price"
              inputMode="decimal"
              value={form.purchasePrice}
              onChange={(e) =>
                setForm({ ...form, purchasePrice: e.target.value })
              }
              placeholder="125000.00"
            />
          </div>

          {canAdmin(me?.role) ? (
            <div className="field">
              <label htmlFor="replacement">Replacement value</label>
              <input
                id="replacement"
                inputMode="decimal"
                value={form.replacementValue}
                onChange={(e) =>
                  setForm({ ...form, replacementValue: e.target.value })
                }
                placeholder="150000.00"
              />
            </div>
          ) : null}
        </div>

        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Capture item'}
        </button>

        <p className="muted" style={{ marginTop: 12, marginBottom: 0 }}>
          Location, category and status stay set for the next item.
        </p>
      </form>

      {toast ? (
        <div className="toast">
          {toast}
          {lastCreated ? (
            <button
              type="button"
              onClick={undo}
              style={{
                marginLeft: 12,
                background: 'none',
                border: 'none',
                color: 'inherit',
                textDecoration: 'underline',
                cursor: 'pointer',
                font: 'inherit',
              }}
            >
              Undo
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
