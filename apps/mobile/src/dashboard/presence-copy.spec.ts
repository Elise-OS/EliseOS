import type { PresenceEstimate } from '@michel/contracts';
import { describe, expect, it } from 'vitest';
import { caregiverPresenceCopy } from './presence-copy';

const estimate = (trackingState: PresenceEstimate['trackingState']): PresenceEstimate => ({
  sessionId: 'tracking',
  state: trackingState === 'AMBIGUOUS' ? 'AMBIGUOUS' : 'OPEN',
  since: '2026-08-30T08:00:00.000Z',
  lastConfirmedAt: '2026-08-30T08:00:00.000Z',
  durationSeconds: 10,
  roomId: 'cuisine',
  detectedAt: '2026-08-30T08:00:00.000Z',
  confidence: 'MEDIUM',
  identifiedResidentId: 'resident',
  source: 'SENSOR',
  plausibleTransition: null,
  ambiguousReason: null,
  trackingState,
  confirmedRoomId: 'cuisine',
  candidateRoomId: trackingState === 'IN_TRANSIT' ? 'salon' : null,
  pathRoomIds: trackingState === 'IN_TRANSIT' ? ['cuisine', 'couloir', 'salon'] : [],
  confidenceScore: 0.65,
  reasonCodes: [],
  explanation: 'Explication aidant.',
  lastEvidenceAt: '2026-08-30T08:00:00.000Z',
  evidenceSummary: [],
  trackingDegraded: false,
});

describe('caregiverPresenceCopy', () => {
  it('describes a pending route without claiming the destination is confirmed', () => {
    const copy = caregiverPresenceCopy(estimate('IN_TRANSIT'));
    expect(copy.title).toBe('Déplacement probable');
    expect(copy.why).toContain('dernière pièce fiable');
  });

  it('uses non-attributed wording for contradictory presence', () => {
    expect(caregiverPresenceCopy(estimate('AMBIGUOUS')).title).toBe('Présence non attribuée');
  });
});
