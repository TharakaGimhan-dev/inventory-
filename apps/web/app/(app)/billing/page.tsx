'use client';

// The plan screen: what this organisation is on, how much of it is used, and
// what the alternatives cost.
//
// Subscribing is Phase 5, with the payment provider. Until then this screen is
// honest about that rather than showing a button that does nothing.
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { UsageBar } from '@/components/UsageBar';
import type { Plan, Subscription } from '@/lib/types';

export default function BillingPage() {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<Subscription>('/billing/subscription'),
      api.get<Plan[]>('/billing/plans'),
    ])
      .then(([s, p]) => {
        setSubscription(s);
        setPlans(p);
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : 'Could not load your plan'),
      );
  }, []);

  if (error) {
    return (
      <>
        <h1>Plan</h1>
        <div className="error">{error}</div>
      </>
    );
  }

  if (!subscription) {
    return (
      <>
        <h1>Plan</h1>
        <p className="muted">Loading…</p>
      </>
    );
  }

  return (
    <>
      <h1>Plan</h1>
      <p className="muted" style={{ marginBottom: 16 }}>
        {subscription.plan?.name ?? 'No plan'} · {subscription.tenant.status}
      </p>

      <div className="card" style={{ marginBottom: 18 }}>
        <h2>Usage</h2>
        {subscription.metrics.map((metric) => (
          <UsageBar key={metric.metric} metric={metric} />
        ))}
      </div>

      <h2>Plans</h2>
      {plans.map((plan) => (
        <div
          key={plan.id}
          className={
            plan.code === subscription.plan?.code
              ? 'plan-card current'
              : 'plan-card'
          }
        >
          <div className="plan-head">
            <span className="plan-name">
              {plan.name}
              {plan.code === subscription.plan?.code ? ' · current' : ''}
            </span>
            <span className="plan-price">
              {Number(plan.priceMonthly) === 0
                ? 'Free'
                : `${plan.currency} ${Number(plan.priceMonthly).toLocaleString()}/mo`}
            </span>
          </div>
          <ul>
            <li>
              {plan.limits.assets === -1
                ? 'Unlimited assets'
                : `${plan.limits.assets.toLocaleString()} assets`}
            </li>
            <li>
              {plan.limits.members === -1
                ? 'Unlimited users'
                : `${plan.limits.members} users`}
            </li>
            {plan.features.reports ? <li>PDF and Excel reports</li> : null}
            {plan.features.labels ? <li>QR label sheets</li> : null}
            {plan.features.api ? <li>API access</li> : null}
          </ul>
        </div>
      ))}

      <p className="muted" style={{ marginTop: 16 }}>
        To change plan, contact us — online payment is coming shortly. Your data
        can always be exported, whatever plan you are on.
      </p>
    </>
  );
}
