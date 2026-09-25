'use client';

// The plan screen: what this organisation is on, how much of it is used, what
// the alternatives cost, and what has been paid.
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { ApiError, api } from '@/lib/api';
import { canAdmin, useAuth } from '@/lib/auth';
import { UsageBar } from '@/components/UsageBar';
import { CheckoutButton } from '@/components/CheckoutButton';
import type { Invoice, Plan, Subscription } from '@/lib/types';

export default function BillingPage() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <Billing />
    </Suspense>
  );
}

function Billing() {
  const { me } = useAuth();
  const params = useSearchParams();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, p] = await Promise.all([
        api.get<Subscription>('/billing/subscription'),
        api.get<Plan[]>('/billing/plans'),
      ]);
      setSubscription(s);
      setPlans(p);

      if (canAdmin(me?.role)) {
        setInvoices(await api.get<Invoice[]>('/billing/invoices'));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your plan');
    }
  }, [me?.role]);

  useEffect(() => {
    void load();
  }, [load]);

  // The return from a checkout. It says the customer came back, not that they
  // paid — the webhook decides that, and it may not have arrived yet.
  useEffect(() => {
    const payment = params.get('payment');
    if (payment === 'done') {
      setNotice(
        'Thank you. Your payment is being confirmed — this page updates once the bank confirms it, usually within a minute.',
      );
      const timer = setTimeout(() => void load(), 8000);
      return () => clearTimeout(timer);
    }
    if (payment === 'cancelled') {
      setNotice('Payment cancelled. Nothing has been charged.');
    }
  }, [params, load]);

  async function cancel() {
    try {
      const result = await api.post<{ message: string }>('/billing/cancel');
      setNotice(result.message);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not cancel');
    }
  }

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

  const active = subscription.subscription?.status === 'active';

  return (
    <>
      <h1>Plan</h1>
      <p className="muted" style={{ marginBottom: 16 }}>
        {subscription.plan?.name ?? 'No plan'} · {subscription.tenant.status}
      </p>

      {notice ? <div className="banner">{notice}</div> : null}

      {subscription.access.reason ? (
        <div className={subscription.access.level === 'read_only' ? 'error' : 'banner'}>
          {subscription.access.reason}
          {subscription.access.daysRemaining !== null
            ? ` ${subscription.access.daysRemaining} day${subscription.access.daysRemaining === 1 ? '' : 's'} left.`
            : ''}
        </div>
      ) : null}

      <div className="card" style={{ marginBottom: 18 }}>
        <h2>Usage</h2>
        {subscription.metrics.map((metric) => (
          <UsageBar key={metric.metric} metric={metric} />
        ))}
      </div>

      {subscription.subscription?.cancelAtPeriodEnd ? (
        <div className="banner">
          Cancelled. Your plan stays active until{' '}
          {subscription.subscription.currentPeriodEnd?.slice(0, 10)}.
        </div>
      ) : null}

      <h2>Plans</h2>
      {plans.map((plan) => {
        const isCurrent = plan.code === subscription.plan?.code;
        const paid = Number(plan.priceMonthly) > 0;

        return (
          <div key={plan.id} className={isCurrent ? 'plan-card current' : 'plan-card'}>
            <div className="plan-head">
              <span className="plan-name">
                {plan.name}
                {isCurrent ? ' · current' : ''}
              </span>
              <span className="plan-price">
                {paid
                  ? `${plan.currency} ${Number(plan.priceMonthly).toLocaleString()}/mo`
                  : 'Free'}
              </span>
            </div>
            <ul style={{ marginBottom: paid && !isCurrent ? 12 : 0 }}>
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

            {/* Only the owner pays. An admin can run the register without
                being able to change what the company is billed. */}
            {paid && !isCurrent && me?.role === 'owner' ? (
              <CheckoutButton planCode={plan.code} planName={plan.name} />
            ) : null}
          </div>
        );
      })}

      {active && me?.role === 'owner' && !subscription.subscription?.cancelAtPeriodEnd ? (
        <button className="ghost" style={{ width: '100%', marginTop: 8 }} onClick={cancel}>
          Cancel subscription
        </button>
      ) : null}

      {canAdmin(me?.role) && invoices.length > 0 ? (
        <div className="card" style={{ marginTop: 18 }}>
          <h2>Invoices</h2>
          <table className="invoices">
            <tbody>
              {invoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td className="mono">{invoice.number}</td>
                  <td>{(invoice.paidAt ?? invoice.createdAt).slice(0, 10)}</td>
                  <td className="num">
                    {invoice.currency} {Number(invoice.amount).toLocaleString()}
                  </td>
                  <td>
                    <span className={`pill ${invoice.status}`}>{invoice.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <p className="muted" style={{ marginTop: 16 }}>
        Your data can always be exported, whatever plan you are on and whatever
        the state of your subscription.
      </p>
    </>
  );
}
