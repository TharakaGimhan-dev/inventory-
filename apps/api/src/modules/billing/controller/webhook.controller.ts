// webhook.controller.ts receives payment callbacks.
//
// Public by necessity - the provider has no token from us. The signature is the
// only thing standing between this endpoint and anyone who can POST to it, so
// nothing here may act on a body that failed verification.
import { Body, Controller, HttpCode, Inject, Logger, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../../../common/decorators/public.decorator';
import {
  PAYMENT_PROVIDER, PaymentProvider,
} from '../providers/payment-provider.interface';
import { SubscriptionService } from '../service/subscription.service';

@ApiExcludeController()
@Controller('webhooks')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly subscriptions: SubscriptionService,
  ) {}

  @Public()
  // Public and unauthenticated, so it is reachable by anyone. A forged
  // callback changes nothing, but a flood of them is still work - each one
  // costs a hash. Generous enough for the provider's own retries.
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Post('payhere')
  // 200 on every path that is not a server fault, including a rejected
  // signature. A provider that gets an error retries, and retrying a forged
  // callback forever achieves nothing but noise in our logs.
  @HttpCode(200)
  async payhere(@Body() body: Record<string, unknown>) {
    const result = this.provider.parseWebhook(body);

    if (!result) {
      // The provider logs the specifics. Nothing is said here that would tell
      // a prober which part of their forgery was wrong.
      return { received: true };
    }

    const outcome = await this.subscriptions.handleWebhook(result);
    this.logger.log(`PayHere ${result.outcome} for ${result.subscriptionId}: ${outcome}`);

    return { received: true };
  }
}
