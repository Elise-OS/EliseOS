// PROVISIONAL (voie UI) — sera remplacé par la version de la voie GPT (origin/feat/box-health).
import { z } from 'zod';

export const boxHealthLevelSchema = z.enum(['ok', 'warning', 'critical', 'unknown']);
export type BoxHealthLevel = z.infer<typeof boxHealthLevelSchema>;

export const boxHealthVerdictSchema = z.enum(['ok', 'warning', 'critical']);
export type BoxHealthVerdict = z.infer<typeof boxHealthVerdictSchema>;

export const boxHealthActionSchema = z.enum(['open-zigbee', 'open-sensors', 'run-backup', 'open-remote-access']);
export type BoxHealthAction = z.infer<typeof boxHealthActionSchema>;

export const boxHealthCheckSchema = z.object({
  id: z.string(),
  level: boxHealthLevelSchema,
  params: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  detail: z.string().optional(),
  action: boxHealthActionSchema.optional(),
});
export type BoxHealthCheck = z.infer<typeof boxHealthCheckSchema>;

export const boxHealthGroupSchema = z.object({
  id: z.string(),
  checks: z.array(boxHealthCheckSchema),
});
export type BoxHealthGroup = z.infer<typeof boxHealthGroupSchema>;

export const boxHealthReportSchema = z.object({
  verdict: boxHealthVerdictSchema,
  checkedAt: z.string(),
  groups: z.array(boxHealthGroupSchema),
  backup: z.object({ running: z.boolean() }).optional(),
  technical: z.record(z.unknown()).optional(),
});
export type BoxHealthReport = z.infer<typeof boxHealthReportSchema>;
