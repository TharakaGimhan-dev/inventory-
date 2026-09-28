// upload.schema.ts is the contract for asking to upload a photo.
import { z } from 'zod';

/** The largest single photo the API will sign for. A phone JPEG is 2-5 MB. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * The types a photo may be, and the extension the server gives each one.
 *
 * The extension comes from here rather than from a client-sent file name, so a
 * caller cannot name its upload `evil.html` and have ImageKit serve it back.
 */
export const IMAGE_EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const;

export type ImageContentType = keyof typeof IMAGE_EXTENSIONS;

export const signUploadSchema = z.object({
  // Declared by the client and reserved against the plan's storage before a
  // signature is issued. ImageKit cannot bind a size into the signature, so
  // this is trusted - see UploadService.sign.
  size: z.number().int().min(1).max(MAX_UPLOAD_BYTES),
  contentType: z.enum(
    Object.keys(IMAGE_EXTENSIONS) as [ImageContentType, ...ImageContentType[]],
  ),
});

export type SignUploadInput = z.infer<typeof signUploadSchema>;
