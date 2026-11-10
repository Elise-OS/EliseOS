import { z } from 'zod';

export const updateStateSchema = z.enum([
  'UNCONFIGURED',
  'CHECKING',
  'UP_TO_DATE',
  'AVAILABLE',
  'DOWNLOADING',
  'INSTALLING',
  'VERIFYING',
  'RESTARTING',
  'SUCCEEDED',
  'ROLLED_BACK',
  'FAILED',
]);

export const updateStatusSchema = z.object({
  state: updateStateSchema,
  currentVersion: z.string(),
  latestVersion: z.string().nullable(),
  updateAvailable: z.boolean(),
  authConfigured: z.boolean(),
  authUsername: z.string().nullable(),
  checkedAt: z.iso.datetime().nullable(),
  releaseNotes: z.string().nullable(),
  progress: z.number().int().min(0).max(100).nullable(),
  message: z.string().nullable(),
  error: z.string().nullable(),
});

export type UpdateState = z.infer<typeof updateStateSchema>;
export type UpdateStatus = z.infer<typeof updateStatusSchema>;

export const updateCredentialsSchema = z.object({
  username: z.string().trim().min(1).max(100),
  token: z.string().trim().min(1).max(500),
});

export type UpdateCredentials = z.infer<typeof updateCredentialsSchema>;
