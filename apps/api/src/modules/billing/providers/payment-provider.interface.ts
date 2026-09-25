// payment-provider.interface.ts is the seam every payment integration sits
// behind.
//
// Sri Lanka forces this. Stripe does not onboard LK-registered businesses
// directly, so the first provider is PayHere - but a foreign entity, a second
// local gateway, or a customer who insists on a bank transfer each mean another
// implementation, not a rewrite. Nothing outside this folder knows which
// provider is in use.
export type CheckoutRequest = {
  tenantId: string;
  tenantName: string;
  subscriptionId: string;
  planCode: string;
  planName: string;
  amount: string;
  currency: string;
  customerEmail: string;
  customerFirstName: string;
  customerLastName: string;
  returnUrl: string;
  cancelUrl: string;
  notifyUrl: string;
};

/**
 * What the browser needs to start a payment.
 *
 * `fields` is posted to `action` as a form. Returning data rather than a
 * redirect keeps the decision about how to render it in the web app.
 */
export type CheckoutSession = {
  action: string;
  fields: Record<string, string>;
};

export type WebhookResult = {
  /** The provider's id for this delivery, used for exactly-once processing. */
  eventId: string;
  subscriptionRef: string | null;
  /** Our own subscription id, echoed back through the provider. */
  subscriptionId: string | null;
  outcome: 'paid' | 'pending' | 'failed' | 'cancelled' | 'chargeback' | 'ignored';
  amount: string | null;
  currency: string | null;
  providerRef: string | null;
  raw: Record<string, unknown>;
};

export interface PaymentProvider {
  readonly name: string;

  /** Whether the provider is configured. False means its keys are missing. */
  isConfigured(): boolean;

  createCheckout(request: CheckoutRequest): Promise<CheckoutSession>;

  /**
   * Verifies the signature on a callback and reads it.
   *
   * Returns null when the signature does not match. A caller that gets null
   * must do nothing at all - an unverified callback is an attacker telling us
   * a payment succeeded.
   */
  parseWebhook(body: Record<string, unknown>): WebhookResult | null;

  cancel(subscriptionRef: string): Promise<void>;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
