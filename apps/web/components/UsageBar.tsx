// UsageBar.tsx shows how much of a plan limit is used.
//
// The numbers come from the API pre-computed, so the app never does its own
// arithmetic on a limit and cannot disagree with what the server will enforce.
import { METRIC_LABELS, type Subscription } from '@/lib/types';

export function UsageBar({
  metric,
}: {
  metric: Subscription['metrics'][number];
}) {
  const label = METRIC_LABELS[metric.metric] ?? metric.metric;

  if (metric.unlimited) {
    return (
      <div className="usage">
        <div className="usage-head">
          <span>{label}</span>
          <span className="muted">{metric.used} · unlimited</span>
        </div>
      </div>
    );
  }

  const pct = metric.limit > 0
    ? Math.min(Math.round((metric.used / metric.limit) * 100), 100)
    : 100;

  // Warn before the wall, not at it: someone who discovers the limit by being
  // refused mid-stocktake has already lost their place.
  const level = pct >= 100 ? 'full' : pct >= 80 ? 'near' : 'ok';

  return (
    <div className="usage">
      <div className="usage-head">
        <span>{label}</span>
        <span className="muted">
          {metric.used} / {metric.limit}
        </span>
      </div>
      <div
        className="usage-track"
        role="progressbar"
        aria-valuenow={metric.used}
        aria-valuemin={0}
        aria-valuemax={metric.limit}
        aria-label={`${label}: ${metric.used} of ${metric.limit} used`}
      >
        <div className={`usage-fill ${level}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
