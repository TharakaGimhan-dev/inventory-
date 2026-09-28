// image-paths.ts decides which photo paths an asset may carry.
//
// assets.imageIds stores ImageKit file PATHS (/tenants/<tenantId>/<uuid>.jpg),
// not ImageKit file ids. A client builds the image URL as urlEndpoint + path
// with no extra lookup, and the tenant is readable from the path itself - which
// is what lets this file refuse another tenant's photo without asking ImageKit.
import { BadRequestException } from '@nestjs/common';
import { PlanLimitExceededException } from '../../../common/exceptions/plan-limit.exception';
import { PlanService } from '../../billing/service/plan.service';

/** Where every upload for a tenant lands. The server chooses it, never the client. */
export const tenantFolder = (tenantId: string) => `/tenants/${tenantId}`;

// One path segment: letters, digits, '_', '-' and '.', never starting with a
// dot. That rules out '.' and '..', so a path cannot climb out of the tenant's
// folder into another one.
const SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

/**
 * Throws unless every path is in the caller's own folder and there are no more
 * of them than the plan allows.
 *
 * 400 for a foreign or malformed path, 402 for too many. The two are different
 * answers: one is a client bug or an attack, the other has an upgrade button.
 */
export function assertImagePaths(
  paths: string[],
  tenantId: string,
  photosPerAsset: number,
): void {
  const prefix = `${tenantFolder(tenantId)}/`;

  for (const path of paths) {
    const rest = path.startsWith(prefix) ? path.slice(prefix.length) : null;

    if (!rest || !rest.split('/').every((segment) => SEGMENT.test(segment))) {
      // Deliberately does not echo whose folder it was, or whether it exists.
      throw new BadRequestException(
        `Photo "${path}" was not uploaded to this organisation`,
      );
    }
  }

  if (!PlanService.isUnlimited(photosPerAsset) && paths.length > photosPerAsset) {
    throw new PlanLimitExceededException('photosPerAsset', photosPerAsset, paths.length);
  }
}
