import { z } from 'zod';

export const calendarEventTypeSchema = z.enum(['APPOINTMENT', 'VISIT']);
export const calendarRecurrenceSchema = z.enum(['NONE', 'DAILY', 'WEEKLY', 'MONTHLY']);

const calendarCommonSchema = z.object({
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime().nullable().default(null),
  notes: z.string().trim().max(3000).nullable().default(null),
  recurrence: calendarRecurrenceSchema.default('NONE'),
  recurrenceUntil: z.iso.datetime().nullable().default(null),
});

export const calendarCreateSchema = z.discriminatedUnion('type', [
  calendarCommonSchema.extend({
    type: z.literal('APPOINTMENT'),
    title: z.string().trim().min(1).max(180),
    location: z.string().trim().max(240).nullable().default(null),
  }),
  calendarCommonSchema.extend({
    type: z.literal('VISIT'),
    visitorName: z.string().trim().min(1).max(180),
  }),
]);

export const calendarUpdateSchema = calendarCreateSchema.and(
  z.object({ scope: z.enum(['ONE', 'SERIES']).default('ONE') }),
);
export const calendarDeleteSchema = z.object({ scope: z.enum(['ONE', 'SERIES']).default('ONE') });

export type CalendarCreate = z.infer<typeof calendarCreateSchema>;
export type CalendarUpdate = z.infer<typeof calendarUpdateSchema>;
export type CalendarRecurrence = z.infer<typeof calendarRecurrenceSchema>;

export interface CalendarEvent {
  id: string;
  type: 'APPOINTMENT' | 'VISIT';
  title: string;
  startsAt: string;
  endsAt: string | null;
  detail: string | null;
  notes: string | null;
  seriesId: string | null;
  recurrence: CalendarRecurrence;
  recurrenceUntil: string | null;
}

export interface CalendarPage {
  items: CalendarEvent[];
  timezone: string;
  canWrite: boolean;
}
