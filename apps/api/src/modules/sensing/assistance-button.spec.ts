import { describe, expect, it } from 'vitest';
import {
  ASSISTANCE_SOS_ACTIONS,
  isSosButtonEvent,
  isSosPress,
  SNZB_01P_SOS_ACTIONS,
} from './assistance-button';

describe('assistance button SOS rule', () => {
  it('lists the exact SNZB-01P actions of Zigbee2MQTT 2.13 as SOS', () => {
    expect([...SNZB_01P_SOS_ACTIONS]).toEqual(['single', 'double', 'long']);
    for (const action of SNZB_01P_SOS_ACTIONS) expect(ASSISTANCE_SOS_ACTIONS).toContain(action);
  });

  it.each(['single', 'double', 'long', 'sos'])(
    'raises an SOS for a %s press of an assistance button',
    (action) => {
      expect(isSosButtonEvent(action, 'ASSISTANCE')).toBe(true);
      expect(isSosPress(action, 'ASSISTANCE')).toBe(true);
      expect(isSosPress(action, 'assistance')).toBe(true);
    },
  );

  it('still raises an SOS for an unexpected press value of an assistance button', () => {
    expect(isSosPress('triple', 'ASSISTANCE')).toBe(true);
    expect(isSosPress(undefined, 'ASSISTANCE')).toBe(true);
  });

  it('never raises an SOS for a release', () => {
    expect(isSosPress('release', 'ASSISTANCE')).toBe(false);
    expect(isSosPress('release', null)).toBe(false);
  });

  it('keeps a button without the assistance role out of SOS, except an explicit sos action', () => {
    for (const action of ['single', 'double', 'long']) {
      expect(isSosButtonEvent(action, null)).toBe(false);
      expect(isSosButtonEvent(action, 'MAIN_ENTRANCE')).toBe(false);
      expect(isSosPress(action, null)).toBe(false);
    }
    expect(isSosPress('sos', null)).toBe(true);
  });
});
