import { z } from 'zod';

// A calendar day in the home's timezone, never converted through the phone's timezone.
export const liaisonDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Invalid calendar date');
export const liaisonTagSchema = z.enum(['MEAL', 'TREATMENT', 'MOOD', 'REST']);
const liaisonTagsSchema = z.array(liaisonTagSchema).max(4).optional();
export const liaisonCreateSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('NOTE'),
      body: z.string().trim().min(1).max(3000),
      tags: liaisonTagsSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('TASK'),
      body: z.string().trim().min(1).max(3000),
      assigneeId: z.string().min(1).nullable().default(null),
      dueOn: liaisonDateSchema.nullable().default(null),
      tags: liaisonTagsSchema,
    })
    .strict(),
]);
export const liaisonFilterSchema = z.enum(['ALL', 'OPEN', 'DONE']);
export const liaisonQuerySchema = z.object({
  filter: liaisonFilterSchema.default('ALL'),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export const liaisonCompletionSchema = z.object({ completed: z.boolean() }).strict();
export type LiaisonCreate = z.infer<typeof liaisonCreateSchema>;
export type LiaisonFilter = z.infer<typeof liaisonFilterSchema>;
export type LiaisonQuery = z.infer<typeof liaisonQuerySchema>;
export type LiaisonTag = z.infer<typeof liaisonTagSchema>;
export interface LiaisonPerson {
  id: string;
  displayName: string;
}
export interface LiaisonEntry {
  id: string;
  kind: 'NOTE' | 'TASK';
  body: string;
  tags: LiaisonTag[];
  createdAt: string;
  author: LiaisonPerson | null;
  assignee: LiaisonPerson | null;
  dueOn: string | null;
  completedAt: string | null;
  completedBy: LiaisonPerson | null;
}
export interface LiaisonVisit {
  id: string;
  visitorName: string;
  startsAt: string;
  endsAt: string | null;
  notes: string | null;
  completedAt: string | null;
  completedBy: LiaisonPerson | null;
}
export interface LiaisonPage {
  items: LiaisonEntry[];
  nextCursor: string | null;
  openTasks?: LiaisonEntry[];
  members: LiaisonPerson[];
  currentUser?: LiaisonPerson;
  visits: LiaisonVisit[];
  canWrite: boolean;
  timezone: string;
  today: string;
}
