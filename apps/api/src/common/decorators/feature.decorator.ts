// feature.decorator.ts marks a route as belonging to a paid tier.
import { SetMetadata } from '@nestjs/common';

export const FEATURE_KEY = 'feature';

/** Keys of plans.features. Data, so a tier changes without a deploy. */
export type FeatureName = 'csvExport' | 'reports' | 'labels' | 'api';

/** @RequiresFeature('reports') — 402 when the plan does not include it. */
export const RequiresFeature = (feature: FeatureName) =>
  SetMetadata(FEATURE_KEY, feature);
