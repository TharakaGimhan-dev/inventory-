// billing.spec.ts covers the two things in Phase 5 that must not be wrong.
//
//   1. Signature verification. It is the only thing between the notify URL and
//      anyone who can POST to it. If it is lenient, a stranger marks any
//      subscription paid.
//   2. Exactly-once processing. Providers retry, and a retry applied twice
//      extends a subscription twice or writes a second invoice for one payment.
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { PayHereProvider } from '../../src/modules/billing/providers/payhere.provider';

const MERCHANT_ID = '1220000';
const SECRET = 'test-merchant-secret';

const md5 = (v: string) =>
  createHash('md5').update(v).digest('hex').toUpperCase();

const config = {
  get: (key: string, fallback?: string) =>
    (({
      PAYHERE_MERCHANT_ID: MERCHANT_ID,
      PAYHERE_SECRET: SECRET,
      PAYHERE_SANDBOX: 'true',
    } as Record<string, string>)[key] ?? fallback),
} as unknown as ConfigService;

const provider = new PayHereProvider(config);

/** Builds a callback signed the way PayHere documents. */
function notification(over: Record<string, string> = {}) {
  const body = {
    merchant_id: MERCHANT_ID,
    order_id: 'a3f1c2d4-0000-4000-8000-000000000001',
    payhere_amount: '2500.00',
    payhere_currency: 'LKR',
    status_code: '2',
    payment_id: '3200012345',
    subscription_id: 'SUB-9911',
    ...over,
  };

  return {
    ...body,
    md5sig: md5(
      body.merchant_id +
        body.order_id +
        body.payhere_amount +
        body.payhere_currency +
        body.status_code +
        md5(SECRET),
    ),
  };
}

describe('PayHere signature verification', () => {
  it('accepts a correctly signed notification', () => {
    const result = provider.parseWebhook(notification());

    expect(result).not.toBeNull();
    expect(result!.outcome).toBe('paid');
    expect(result!.subscriptionId).toBe('a3f1c2d4-0000-4000-8000-000000000001');
    expect(result!.providerRef).toBe('3200012345');
    expect(result!.subscriptionRef).toBe('SUB-9911');
  });

  it('rejects a tampered amount', () => {
    // The attack that matters: pay 100, claim 25000. The amount is signed, so
    // changing it invalidates the signature.
    const body = notification();
    body.payhere_amount = '25000.00';

    expect(provider.parseWebhook(body)).toBeNull();
  });

  it('rejects a forged success for a real subscription', () => {
    // Someone who knows a subscription id but not the secret.
    const body = notification();
    body.md5sig = md5('anything they can compute without the secret');

    expect(provider.parseWebhook(body)).toBeNull();
  });

  it('rejects a notification with no signature at all', () => {
    const body = notification();
    (body as Record<string, unknown>).md5sig = '';

    expect(provider.parseWebhook(body)).toBeNull();
  });

  it('rejects a correctly signed notification for another merchant', () => {
    // Signed with our secret would not happen, but a merchant id mismatch
    // means the row it points at is not ours to change.
    const other = '9999999';
    const body = {
      merchant_id: other,
      order_id: 'x',
      payhere_amount: '1.00',
      payhere_currency: 'LKR',
      status_code: '2',
    } as Record<string, string>;
    body.md5sig = md5(
      other + 'x' + '1.00' + 'LKR' + '2' + md5(SECRET),
    );

    expect(provider.parseWebhook(body)).toBeNull();
  });

  it('accepts lower-case signatures', () => {
    // Gateways are inconsistent about hash case; rejecting a valid payment over
    // capitalisation would lock out a customer who did pay.
    const body = notification();
    body.md5sig = body.md5sig.toLowerCase();

    expect(provider.parseWebhook(body)).not.toBeNull();
  });

  it('maps every documented status code', () => {
    const outcome = (code: string) =>
      provider.parseWebhook(notification({ status_code: code }))?.outcome;

    expect(outcome('2')).toBe('paid');
    expect(outcome('0')).toBe('pending');
    expect(outcome('-1')).toBe('cancelled');
    expect(outcome('-2')).toBe('failed');
    expect(outcome('-3')).toBe('chargeback');
  });

  it('gives a retry of the same payment the same event id', () => {
    // This is what makes exactly-once processing possible: the provider sends
    // no delivery id, so it is derived from the fields identifying the payment.
    const first = provider.parseWebhook(notification());
    const retry = provider.parseWebhook(notification());

    expect(first!.eventId).toBe(retry!.eventId);
  });

  it('gives a later renewal a different event id', () => {
    // A genuine second payment must not be mistaken for a duplicate, or the
    // subscription is never extended.
    const first = provider.parseWebhook(notification());
    const renewal = provider.parseWebhook(
      notification({ payment_id: '3200099999' }),
    );

    expect(first!.eventId).not.toBe(renewal!.eventId);
  });
});

describe('PayHere checkout', () => {
  it('signs the amount exactly as it sends it', async () => {
    const session = await provider.createCheckout({
      tenantId: 't',
      tenantName: 'Lanka Traders',
      subscriptionId: 'sub-1',
      planCode: 'starter',
      planName: 'Starter',
      // Deliberately unformatted: formatting it twice is how a signature
      // mismatch appears for one amount in a hundred.
      amount: '2500',
      currency: 'LKR',
      customerEmail: 'owner@lanka.lk',
      customerFirstName: 'Nimal',
      customerLastName: 'Perera',
      returnUrl: 'https://app.example/billing',
      cancelUrl: 'https://app.example/billing',
      notifyUrl: 'https://api.example/api/v1/webhooks/payhere',
    });

    expect(session.fields.amount).toBe('2500.00');
    expect(session.fields.hash).toBe(
      md5(MERCHANT_ID + 'sub-1' + '2500.00' + 'LKR' + md5(SECRET)),
    );
    expect(session.action).toContain('sandbox');
  });

  it('uses our subscription id as the order id', () => {
    // So a callback ties back to a row without trusting anything else in it.
    return provider
      .createCheckout({
        tenantId: 't',
        tenantName: 'X',
        subscriptionId: 'the-subscription-id',
        planCode: 'starter',
        planName: 'Starter',
        amount: '2500.00',
        currency: 'LKR',
        customerEmail: 'a@b.lk',
        customerFirstName: 'A',
        customerLastName: 'B',
        returnUrl: 'https://x/1',
        cancelUrl: 'https://x/2',
        notifyUrl: 'https://x/3',
      })
      .then((s) => expect(s.fields.order_id).toBe('the-subscription-id'));
  });
});

describe('when PayHere is not configured', () => {
  it('reports itself unconfigured rather than half-working', () => {
    const empty = new PayHereProvider({
      get: (_k: string, fallback?: string) => fallback,
    } as unknown as ConfigService);

    expect(empty.isConfigured()).toBe(false);
  });
});
