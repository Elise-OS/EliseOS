/**
 * Shared rule for "the last activity of the person".
 *
 * Only signals produced by the person count: motion, presence, door/window
 * contacts and button presses. Smart plug measurements (power, energy), battery or link quality
 * updates and other environment readings are not activity of the person.
 * The dashboard ("last reliable activity") and the mobile home screen
 * ("last activity") use this same rule.
 */
export const LIFE_ACTIVITY_CAPABILITIES = [
  'motion',
  'occupancy',
  'person_presence',
  'contact',
  'dry_contact',
  'button',
] as const;

/** Activity counted in the activity charts uses the same person-generated signals. */
export const ACTIVITY_CAPABILITIES = [...LIFE_ACTIVITY_CAPABILITIES] as const;

const lifeActivityCapabilities: ReadonlySet<string> = new Set(LIFE_ACTIVITY_CAPABILITIES);

export function isLifeActivityCapability(capability: string): boolean {
  return lifeActivityCapabilities.has(capability);
}

/** A life signal whose measure is reliable (quality "good"). */
export function isReliableLifeActivity(event: { capability: string; quality: string }): boolean {
  return isLifeActivityCapability(event.capability) && event.quality === 'good';
}
