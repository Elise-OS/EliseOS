import { t } from '../i18n';

// The setup stores these values in French on the server; only their labels are translated.

/** Relation of the caregiver to the resident: stored value → catalog key. */
export const RELATIONS = [
  { value: 'Enfant', key: 'child' },
  { value: 'Petit-enfant', key: 'grandchild' },
  { value: 'Conjoint', key: 'partner' },
  { value: 'Ami(e)', key: 'friend' },
  { value: 'Professionnel', key: 'professional' },
  { value: 'Autre', key: 'other' },
] as const;

export function relationLabel(value: string) {
  const relation = RELATIONS.find((candidate) => candidate.value === value);
  return relation ? t(`setup.relation.${relation.key}`) : value;
}

/** First routines, named in French in the stored habits. */
const HABITS = { Lever: 'wakeUp', Coucher: 'bedtime', Déjeuner: 'lunch', Dîner: 'dinner' } as const;

export function habitLabel(name: string) {
  const key = HABITS[name as keyof typeof HABITS] as
    (typeof HABITS)[keyof typeof HABITS] | undefined;
  return key ? t(`setup.habit.${key}`) : name;
}
