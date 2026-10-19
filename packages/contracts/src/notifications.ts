import { z } from 'zod';

export const notificationPreferencesSchema = z
  .object({
    fallDetection: z.boolean(),
    smoke: z.boolean(),
    waterLeak: z.boolean(),
    liaisonMessages: z.boolean(),
    liaisonMoods: z.boolean(),
  })
  .strict();

export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  fallDetection: true,
  smoke: true,
  waterLeak: true,
  liaisonMessages: true,
  liaisonMoods: true,
};
