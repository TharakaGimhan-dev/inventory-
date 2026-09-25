// quota.decorator.ts marks a route as consuming a metered resource.
import { SetMetadata } from '@nestjs/common';
import { UsageMetric } from '../../modules/billing/models/usage-counter.model';

export const QUOTA_KEY = 'quota';

/** @Quota(UsageMetric.ASSETS) - refuses the request when the plan is full. */
export const Quota = (metric: UsageMetric) => SetMetadata(QUOTA_KEY, metric);
