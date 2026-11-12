/**
 * Which button presses raise an SOS.
 *
 * Decision for the SONOFF SNZB-01P used as an assistance button: every press is an SOS.
 * zigbee-herdsman-converters 26.90.0 (Zigbee2MQTT 2.13) exposes the SNZB-01P through
 * `ewelinkAction()` with exactly three actions, mapped from genOnOff commands:
 * commandToggle → "single", commandOn → "double", commandOff → "long". Neither the
 * converter nor the SONOFF product documentation gives "double" a cancel or test meaning;
 * the three gestures are equivalent, freely assignable presses. An elderly person in
 * distress can press twice by panic or tremor, and a missed SOS is far worse than a false
 * one, so "double" stays an SOS like "single" and "long".
 *
 * Home Assistant reports these presses through the Zigbee2MQTT event entity
 * `event.<name>_action`, whose `event_type` attribute carries the same values; the
 * Élise bridge forwards it as `payload.action`.
 */
export const SNZB_01P_SOS_ACTIONS = ['single', 'double', 'long'] as const;

/** Every action that always raises an SOS on a button with the assistance role. */
export const ASSISTANCE_SOS_ACTIONS: readonly string[] = [...SNZB_01P_SOS_ACTIONS, 'sos'];

/** A "release" only follows a press already reported; it is never a new press. */
const RELEASE_ACTION = 'release';

export function isAssistanceRole(role: string | null | undefined): boolean {
  return role?.toUpperCase() === 'ASSISTANCE';
}

/** Whether this button event belongs to the SOS rule (press or its release). */
export function isSosButtonEvent(action: unknown, role: string | null | undefined): boolean {
  return isAssistanceRole(role) || action === 'sos' || action === RELEASE_ACTION;
}

/**
 * Whether this button event is a press that must raise an SOS.
 *
 * With the assistance role, the named actions above always raise an SOS, and so does any
 * other press value (another button model, an unexpected event type): when in doubt, alert.
 * Without the assistance role, only an explicit "sos" action does, as before.
 */
export function isSosPress(action: unknown, role: string | null | undefined): boolean {
  if (action === RELEASE_ACTION) return false;
  // ASSISTANCE_SOS_ACTIONS are SOS by decision; any other press value is too: when in doubt,
  // alert. No action of an assistance button is ever filtered out, except "release".
  if (isAssistanceRole(role)) return true;
  return action === 'sos';
}
