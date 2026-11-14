import { z } from 'zod';

export const boxHealthActionSchema = z.enum([
  'open-zigbee',
  'open-sensors',
  'run-backup',
  'open-remote-access',
]);

export const boxHealthCheckLevelSchema = z.enum(['ok', 'warning', 'critical', 'unknown']);
export const boxHealthVerdictSchema = z.enum(['ok', 'warning', 'critical']);

export const boxHealthCheckSchema = z.object({
  id: z.string().min(1),
  level: boxHealthCheckLevelSchema,
  params: z.record(z.string(), z.unknown()).default({}),
  detail: z.string().optional(),
  action: boxHealthActionSchema.optional(),
});

export const boxHealthGroupSchema = z.object({
  id: z.string().min(1),
  checks: z.array(boxHealthCheckSchema),
});

export const boxHealthReportSchema = z.object({
  verdict: boxHealthVerdictSchema,
  checkedAt: z.iso.datetime(),
  groups: z.array(boxHealthGroupSchema),
  backup: z.object({ running: z.boolean() }).optional(),
  technical: z.unknown().optional(),
});

export type BoxHealthAction = z.infer<typeof boxHealthActionSchema>;
export type BoxHealthCheckLevel = z.infer<typeof boxHealthCheckLevelSchema>;
export type BoxHealthVerdict = z.infer<typeof boxHealthVerdictSchema>;
export type BoxHealthCheck = z.infer<typeof boxHealthCheckSchema>;
export type BoxHealthGroup = z.infer<typeof boxHealthGroupSchema>;
export type BoxHealthReport = z.infer<typeof boxHealthReportSchema>;
