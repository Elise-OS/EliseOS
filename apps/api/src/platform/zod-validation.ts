import { BadRequestException } from '@nestjs/common';
import type { z } from 'zod';

export function parseRequest<TSchema extends z.ZodType>(
  schema: TSchema,
  input: unknown,
): z.infer<TSchema> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new BadRequestException({
      code: 'INVALID_REQUEST',
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return result.data;
}
