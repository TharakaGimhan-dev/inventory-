// zod-validation.pipe.ts validates controller input before the service runs.
// Pipes sit in the request flow: Request -> Guards -> Pipes -> Controller -> Service.
// The same Zod schemas are shared with the web app, so the form and the write path
// can never disagree about what a valid asset looks like.
import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { ZodSchema } from 'zod';

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown) {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: result.error.flatten(),
      });
    }

    return result.data;
  }
}
