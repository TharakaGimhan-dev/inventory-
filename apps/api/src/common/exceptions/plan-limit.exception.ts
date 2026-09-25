// plan-limit.exception.ts is the one 402 the whole app raises.
//
// Shared between the quota guard (which rejects early, before any work) and the
// services (which reject authoritatively, inside the transaction), so the
// client sees one shape no matter which of the two stopped it.
import { HttpException, HttpStatus } from '@nestjs/common';

const HUMAN: Record<string, string> = {
  assets: 'assets',
  members: 'team members',
  locations: 'locations',
  storage_bytes: 'bytes of storage',
};

export class PlanLimitExceededException extends HttpException {
  constructor(metric: string, limit: number, current: number) {
    super(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,
        error: 'Plan limit reached',
        message: `Your plan allows ${limit} ${HUMAN[metric] ?? metric}. Upgrade to add more.`,
        metric,
        limit,
        current,
        upgradeUrl: '/billing',
      },
      // 402, not 403: "you may not" and "your plan is full" are different
      // answers, and only one of them has an upgrade button.
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
