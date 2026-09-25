'use client';

// The tools tab: getting data out, and getting it in.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ApiError, api } from '@/lib/api';
import { canAdmin, useAuth } from '@/lib/auth';
import { download } from '@/lib/download';

type ImportProblem = { line: number; column: string; message: string };
type ImportResponse = {
  imported: number;
  willImport?: number;
  problems: ImportProblem[];
  applied: boolean;
  createdLocations?: string[];
};

const today = () => new Date().toISOString().slice(0, 10);

export default function ToolsPage() {
  const { me } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<ImportResponse | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  async function get(path: string, filename: string, label: string) {
    setBusy(label);
    setError(null);
    setLocked(null);

    try {
      await download(path, filename);
      setToast(`${label} downloaded`);
    } catch (e) {
      // 402 means the plan does not include it — a different thing from an
      // error, and it has a way forward.
      if (e instanceof ApiError && e.status === 402) setLocked(e.message);
      else setError(e instanceof Error ? e.message : 'Could not prepare that file');
    } finally {
      setBusy(null);
    }
  }

  async function labels() {
    setBusy('Labels');
    setError(null);
    setLocked(null);

    try {
      await download('/assets/labels.pdf', `asset-labels-${today()}.pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      setToast('Label sheet downloaded');
    } catch (e) {
      if (e instanceof ApiError && e.status === 402) setLocked(e.message);
      else setError(e instanceof Error ? e.message : 'Could not prepare the labels');
    } finally {
      setBusy(null);
    }
  }

  async function checkImport(apply: boolean) {
    setBusy(apply ? 'Importing' : 'Checking');
    setError(null);
    setLocked(null);

    try {
      const result = await api.post<ImportResponse>('/assets/import', {
        csv,
        dryRun: !apply,
      });

      setPreview(result);

      if (result.applied) {
        setToast(`${result.imported} item${result.imported === 1 ? '' : 's'} imported`);
        setCsv('');
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 402) setLocked(e.message);
      else setError(e instanceof Error ? e.message : 'Could not read that file');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <h1>Tools</h1>

      {locked ? (
        <div className="limit-prompt">
          <strong>Not included in your plan.</strong>
          {locked} <Link href="/billing">See plans</Link>.
        </div>
      ) : null}

      {error ? <div className="error">{error}</div> : null}

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Export</h2>
        <p className="muted" style={{ fontSize: 13.5 }}>
          CSV is available on every plan, always — including if your
          subscription lapses.
        </p>

        <button
          className="primary"
          disabled={busy !== null}
          onClick={() => get('/assets/export', `asset-register-${today()}.csv`, 'CSV')}
        >
          {busy === 'CSV' ? 'Preparing…' : 'Download CSV'}
        </button>

        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button
            className="ghost"
            style={{ flex: 1 }}
            disabled={busy !== null}
            onClick={() =>
              get('/assets/export.xlsx', `asset-register-${today()}.xlsx`, 'Excel')
            }
          >
            Excel
          </button>
          <button
            className="ghost"
            style={{ flex: 1 }}
            disabled={busy !== null}
            onClick={() => get('/assets/report.pdf', `asset-report-${today()}.pdf`, 'Report')}
          >
            PDF report
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Labels</h2>
        <p className="muted" style={{ fontSize: 13.5 }}>
          A printable sheet of QR labels, 24 to an A4 page. Each code is
          readable by any QR scanner.
        </p>
        <button className="ghost" style={{ width: '100%' }} disabled={busy !== null} onClick={labels}>
          {busy === 'Labels' ? 'Preparing…' : 'Print label sheet'}
        </button>
      </div>

      {canAdmin(me?.role) ? (
        <div className="card">
          <h2>Import</h2>
          <p className="muted" style={{ fontSize: 13.5 }}>
            Paste a CSV with a <strong>Name</strong> column. Location, Status,
            Serial number, Purchase price and Qty are optional. Locations named
            here are created for you.
          </p>

          <div className="field">
            <label htmlFor="csv">CSV</label>
            <textarea
              id="csv"
              rows={7}
              value={csv}
              onChange={(e) => {
                setCsv(e.target.value);
                setPreview(null);
              }}
              placeholder={'Name,Location,Status,Qty\nMeeting table,Board room,in_use,1'}
              style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12.5 }}
            />
          </div>

          {preview ? (
            preview.problems.length > 0 ? (
              <div className="error">
                <strong>
                  {preview.problems.length} problem
                  {preview.problems.length === 1 ? '' : 's'}. Nothing was imported.
                </strong>
                <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                  {preview.problems.slice(0, 10).map((p, i) => (
                    <li key={i}>
                      Line {p.line}, {p.column}: {p.message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : preview.applied ? (
              <div className="banner">
                Imported {preview.imported} item
                {preview.imported === 1 ? '' : 's'}
                {preview.createdLocations?.length
                  ? `, and created ${preview.createdLocations.length} location${preview.createdLocations.length === 1 ? '' : 's'}`
                  : ''}
                .
              </div>
            ) : (
              <div className="banner">
                {preview.willImport} row
                {preview.willImport === 1 ? '' : 's'} look fine. Import them?
              </div>
            )
          ) : null}

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="ghost"
              style={{ flex: 1 }}
              disabled={!csv.trim() || busy !== null}
              onClick={() => checkImport(false)}
            >
              {busy === 'Checking' ? 'Checking…' : 'Check file'}
            </button>
            <button
              className="primary"
              style={{ flex: 1 }}
              disabled={
                !preview || preview.problems.length > 0 || preview.applied || busy !== null
              }
              onClick={() => checkImport(true)}
            >
              {busy === 'Importing' ? 'Importing…' : 'Import'}
            </button>
          </div>
        </div>
      ) : null}

      {toast ? <div className="toast">{toast}</div> : null}
    </>
  );
}
