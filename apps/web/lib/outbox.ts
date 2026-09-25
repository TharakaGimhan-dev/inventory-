// outbox.ts holds captures made while the phone had no signal.
//
// The Firebase app got offline persistence from Firestore's IndexedDB layer.
// That is gone, so this is the replacement, and it is deliberately narrower:
// only captures are queued. Reads simply fail offline, which is honest - a
// stale register is worse than a visibly unavailable one.
//
// Each queued capture carries an idempotency key generated when it was written.
// The key is what makes a replay safe: the API returns the original asset for a
// repeated key rather than creating a second one, so a flush that runs twice
// (two tabs, a retry after a timeout) cannot duplicate a row or burn a code.
import type { Asset } from './types';

const DB_NAME = 'inventory-outbox';
const STORE = 'captures';
const VERSION = 1;

export type QueuedCapture = {
  id: string;
  /** Sent as Idempotency-Key. Generated once, reused on every attempt. */
  idempotencyKey: string;
  payload: Record<string, unknown>;
  createdAt: number;
  attempts: number;
  lastError?: string;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = run(transaction.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
  });
}

export const outbox = {
  /** IndexedDB is missing in some private windows; the app must still work. */
  available(): boolean {
    return typeof indexedDB !== 'undefined';
  },

  async add(payload: Record<string, unknown>): Promise<QueuedCapture> {
    const entry: QueuedCapture = {
      id: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      payload,
      createdAt: Date.now(),
      attempts: 0,
    };

    await tx('readwrite', (store) => store.add(entry));
    return entry;
  },

  async all(): Promise<QueuedCapture[]> {
    if (!this.available()) return [];
    try {
      const rows = await tx<QueuedCapture[]>('readonly', (s) => s.getAll());
      return rows.sort((a, b) => a.createdAt - b.createdAt);
    } catch {
      return [];
    }
  },

  async remove(id: string): Promise<void> {
    await tx('readwrite', (store) => store.delete(id));
  },

  async markFailed(entry: QueuedCapture, error: string): Promise<void> {
    await tx('readwrite', (store) =>
      store.put({ ...entry, attempts: entry.attempts + 1, lastError: error }),
    );
  },
};

export type FlushResult = { sent: Asset[]; failed: number };

/**
 * Sends every queued capture, oldest first.
 *
 * Order matters: asset codes are issued in the order the server receives
 * captures, and a person who captured three things expects them numbered in
 * that order.
 *
 * A 4xx other than 409 means the server refused the payload itself - retrying
 * it forever would block every capture behind it, so it is dropped and
 * reported. Network failures are kept and retried.
 */
export async function flushOutbox(
  send: (payload: Record<string, unknown>, key: string) => Promise<Asset>,
): Promise<FlushResult> {
  const queued = await outbox.all();
  const sent: Asset[] = [];
  let failed = 0;

  for (const entry of queued) {
    try {
      sent.push(await send(entry.payload, entry.idempotencyKey));
      await outbox.remove(entry.id);
    } catch (error) {
      const status = (error as { status?: number }).status;

      if (status && status >= 400 && status < 500 && status !== 409) {
        await outbox.remove(entry.id);
        failed += 1;
        continue;
      }

      await outbox.markFailed(entry, (error as Error).message);
      // Stop at the first network failure rather than hammering an offline
      // connection with the whole queue - and it keeps the codes in order.
      break;
    }
  }

  return { sent, failed };
}
