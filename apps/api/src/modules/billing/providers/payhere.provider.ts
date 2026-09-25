// payhere.provider.ts integrates PayHere, the practical choice for a
// Sri Lanka-registered business.
//
// ─────────────────────────────────────────────────────────────────────────────
// VERIFY BEFORE TAKING REAL MONEY
//
// The field names and the two hash formulas below follow PayHere's documented
// Checkout and Notify shapes, but they are written from documentation and not
// from a live integration against your merchant account. Gateways change field
// names and add required parameters, and a mismatch here fails in the worst
// way: a customer is charged and the webhook is rejected, so they pay and stay
// locked out.
//
// Before going live, against PayHere's current docs and their sandbox:
//   1. confirm every field name in createCheckout
//   2. confirm the md5sig formula in parseWebhook, including the case of each
//      hash and the exact amount formatting PayHere signs
//   3. confirm the recurrence and duration values for a monthly subscription
//   4. run a sandbox payment end to end and read the real notification body
//
// The signature check is the security boundary. If it is wrong in the lenient
// direction, anyone who can POST to the notify URL can mark any subscription
// paid.
// ─────────────────────────────────────────────────────────────────────────────
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import {
  CheckoutRequest, CheckoutSession, PaymentProvider, WebhookResult,
} from './payment-provider.interface';

const LIVE_CHECKOUT = 'https://www.payhere.lk/pay/checkout';
const SANDBOX_CHECKOUT = 'https://sandbox.payhere.lk/pay/checkout';

/** PayHere's status_code values. */
const STATUS = {
  SUCCESS: '2',
  PENDING: '0',
  CANCELLED: '-1',
  FAILED: '-2',
  CHARGEBACK: '-3',
} as const;

const md5 = (value: string) =>
  createHash('md5').update(value).digest('hex').toUpperCase();

@Injectable()
export class PayHereProvider implements PaymentProvider {
  readonly name = 'payhere';
  private readonly logger = new Logger(PayHereProvider.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.get<string>('PAYHERE_MERCHANT_ID') &&
        this.config.get<string>('PAYHERE_SECRET'),
    );
  }

  private get merchantId(): string {
    return this.config.get<string>('PAYHERE_MERCHANT_ID') ?? '';
  }

  private get secret(): string {
    return this.config.get<string>('PAYHERE_SECRET') ?? '';
  }

  private get checkoutUrl(): string {
    return this.config.get<string>('PAYHERE_SANDBOX') === 'true'
      ? SANDBOX_CHECKOUT
      : LIVE_CHECKOUT;
  }

  async createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
    // PayHere signs the amount as it is sent, so it is formatted once here and
    // the same string goes into both the form and the hash. Formatting it twice
    // is how a signature mismatch appears for one amount in a hundred.
    const amount = Number(request.amount).toFixed(2);

    // Our own subscription id is the order id, so the notification can be tied
    // back to a row without trusting anything else in the body.
    const orderId = request.subscriptionId;

    const hash = md5(
      this.merchantId + orderId + amount + request.currency + md5(this.secret),
    );

    return {
      action: this.checkoutUrl,
      fields: {
        merchant_id: this.merchantId,
        return_url: request.returnUrl,
        cancel_url: request.cancelUrl,
        notify_url: request.notifyUrl,
        order_id: orderId,
        items: `${request.planName} — ${request.tenantName}`,
        currency: request.currency,
        amount,
        first_name: request.customerFirstName,
        last_name: request.customerLastName,
        email: request.customerEmail,
        // PayHere requires these; they are not collected in the app, so they
        // are sent empty and PayHere asks the customer on its own page.
        phone: '',
        address: '',
        city: '',
        country: 'Sri Lanka',
        // Monthly, until cancelled.
        recurrence: '1 Month',
        duration: 'Forever',
        hash,
      },
    };
  }

  parseWebhook(body: Record<string, unknown>): WebhookResult | null {
    const get = (key: string) =>
      body[key] === undefined || body[key] === null ? '' : String(body[key]);

    const merchantId = get('merchant_id');
    const orderId = get('order_id');
    const amount = get('payhere_amount');
    const currency = get('payhere_currency');
    const statusCode = get('status_code');
    const signature = get('md5sig');

    if (!orderId || !signature) {
      this.logger.warn('PayHere callback missing order_id or md5sig');
      return null;
    }

    const expected = md5(
      merchantId + orderId + amount + currency + statusCode + md5(this.secret),
    );

    if (!safeEquals(expected, signature.toUpperCase())) {
      // Loud, because the only two causes are a misconfigured secret and
      // someone forging a payment notification.
      this.logger.error(
        `PayHere signature mismatch for order ${orderId}; refusing to act on it`,
      );
      return null;
    }

    if (merchantId !== this.merchantId) {
      this.logger.error(`PayHere callback for another merchant: ${merchantId}`);
      return null;
    }

    return {
      // PayHere does not send a delivery id, so one is derived from the fields
      // that identify this payment. A genuine retry produces the same string;
      // a later renewal of the same subscription does not.
      eventId: `${orderId}:${statusCode}:${get('payment_id') || amount}`,
      subscriptionRef: get('subscription_id') || null,
      subscriptionId: orderId,
      outcome: OUTCOME[statusCode] ?? 'ignored',
      amount: amount || null,
      currency: currency || null,
      providerRef: get('payment_id') || null,
      raw: body,
    };
  }

  async cancel(subscriptionRef: string): Promise<void> {
    // PayHere cancels a recurring subscription from the merchant portal or
    // through its Subscription API, which needs a separate OAuth app. Until
    // that is set up, cancelling stops OUR side and the final charge is stopped
    // by hand. Saying so is better than a silent no-op that lets a cancelled
    // customer be billed again.
    this.logger.warn(
      `PayHere subscription ${subscriptionRef} must be cancelled in the ` +
        `merchant portal; the local subscription has been marked cancelled.`,
    );
  }
}

const OUTCOME: Record<string, WebhookResult['outcome']> = {
  [STATUS.SUCCESS]: 'paid',
  [STATUS.PENDING]: 'pending',
  [STATUS.CANCELLED]: 'cancelled',
  [STATUS.FAILED]: 'failed',
  [STATUS.CHARGEBACK]: 'chargeback',
};

/** Constant-time compare, so a signature cannot be guessed byte by byte. */
function safeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
