// upload.service.ts signs photo uploads to ImageKit.
//
// The file never passes through the API. The client asks here for a one-time
// signature, posts the photo straight to ImageKit with it, and then saves the
// returned path on the asset. The API's part is to decide whether the tenant
// has room, where the file goes, and to sign with a key the client never sees.
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection } from '@nestjs/sequelize';
import { createHmac, randomUUID } from 'node:crypto';
import { Sequelize } from 'sequelize-typescript';
import { PlanLimitExceededException } from '../../../common/exceptions/plan-limit.exception';
import { CURRENT_PERIOD, UsageMetric } from '../../billing/models/usage-counter.model';
import { PlanService } from '../../billing/service/plan.service';
import { UsageService } from '../../billing/service/usage.service';
import { IMAGE_EXTENSIONS, SignUploadInput } from '../schemas/upload.schema';
import { tenantFolder } from './image-paths';

/**
 * How long a signature stays usable. ImageKit refuses an expire more than an
 * hour ahead; half an hour covers a slow upload on a weak mobile signal.
 */
export const SIGNATURE_TTL_SECONDS = 30 * 60;

type ImageKitKeys = { publicKey: string; privateKey: string; urlEndpoint: string };

/**
 * ImageKit's client-upload signature: HMAC-SHA1 over token + expire, keyed by
 * the private key, as lower-case hex.
 */
export function imageKitSignature(privateKey: string, token: string, expire: number): string {
  return createHmac('sha1', privateKey).update(token + String(expire)).digest('hex');
}

@Injectable()
export class UploadService {
  constructor(
    private readonly config: ConfigService,
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly usage: UsageService,
    private readonly plans: PlanService,
  ) {}

  /** What a client needs before it offers a camera button. */
  publicConfig(): { enabled: boolean; urlEndpoint: string | null } {
    return {
      enabled: this.keys() !== null,
      // Returned even when uploads are off, so photos saved before the keys
      // were removed still display.
      urlEndpoint: this.urlEndpoint(),
    };
  }

  /**
   * Reserves the photo's bytes against the plan, then signs an upload into the
   * tenant's own folder.
   *
   * Two limitations, both accepted:
   *
   * - The reserved size is the one the client DECLARED. ImageKit cannot bind a
   *   size into the signature, so a client that lies uploads more than it paid
   *   for, up to ImageKit's own per-file cap. The honest client (ours) sends
   *   the real size, and the per-request ceiling bounds the rest.
   * - Reserved bytes are not refunded when a photo is removed from an asset or
   *   an upload never happens. Refunding needs ImageKit's delete API and a
   *   record of which reservation became which file; until then storage usage
   *   only grows, which errs towards the customer seeing an upgrade prompt
   *   early rather than us storing for free.
   */
  async sign(tenantId: string, input: SignUploadInput) {
    const keys = this.keys();
    if (!keys) {
      // The same stance as PayHere with no keys: say so, rather than hand out
      // a signature ImageKit will reject.
      throw new ServiceUnavailableException('Photo uploads are not configured yet');
    }

    await this.reserve(tenantId, input.size);

    // Unique per upload. ImageKit refuses a token it has seen before, so a
    // leaked signature cannot be replayed for a second file.
    const token = randomUUID();
    const expire = Math.floor(Date.now() / 1000) + SIGNATURE_TTL_SECONDS;

    // The server picks both the folder and the name. The folder is what ties
    // the file to this tenant (see assertImagePaths); the name, with
    // useUniqueFileName=false on the client, is what makes `path` knowable
    // before the upload finishes.
    const folder = tenantFolder(tenantId);
    const fileName = `${randomUUID()}.${IMAGE_EXTENSIONS[input.contentType]}`;

    return {
      publicKey: keys.publicKey,
      urlEndpoint: keys.urlEndpoint,
      token,
      expire,
      signature: imageKitSignature(keys.privateKey, token, expire),
      folder,
      fileName,
      path: `${folder}/${fileName}`,
    };
  }

  /**
   * Claims `size` bytes of storage, or refuses with 402.
   *
   * The condition rides on the increment itself (increaseWithinLimit), so two
   * uploads racing for the last few megabytes cannot both be granted them.
   */
  private async reserve(tenantId: string, size: number): Promise<void> {
    const limits = await this.plans.effectiveLimits(tenantId);

    const granted = await this.sequelize.transaction(async (transaction) => {
      if (PlanService.isUnlimited(limits.storageBytes)) {
        await this.usage.change(
          UsageMetric.STORAGE_BYTES, size, transaction, CURRENT_PERIOD, tenantId,
        );
        return true;
      }

      const claimed = await this.usage.increaseWithinLimit(
        UsageMetric.STORAGE_BYTES,
        size,
        limits.storageBytes,
        transaction,
        CURRENT_PERIOD,
        tenantId,
      );

      return claimed !== null;
    });

    // The current figure for the 402 is read AFTER the transaction has
    // released its connection. Read inside it, each refused request holds one
    // connection while waiting for a second, and a burst larger than the pool
    // deadlocks every request in it.
    if (!granted) {
      throw new PlanLimitExceededException(
        UsageMetric.STORAGE_BYTES,
        limits.storageBytes,
        await this.usage.current(UsageMetric.STORAGE_BYTES, tenantId),
      );
    }
  }

  /** All three keys, or null. Half a configuration is no configuration. */
  private keys(): ImageKitKeys | null {
    const publicKey = this.config.get<string>('IMAGEKIT_PUBLIC_KEY');
    const privateKey = this.config.get<string>('IMAGEKIT_PRIVATE_KEY');
    const urlEndpoint = this.urlEndpoint();

    if (!publicKey || !privateKey || !urlEndpoint) return null;
    return { publicKey, privateKey, urlEndpoint };
  }

  /**
   * The endpoint without a trailing slash, because a client builds the image
   * URL as urlEndpoint + path and every path starts with one.
   */
  private urlEndpoint(): string | null {
    const value = this.config.get<string>('IMAGEKIT_URL_ENDPOINT');
    return value ? value.replace(/\/+$/, '') : null;
  }
}
