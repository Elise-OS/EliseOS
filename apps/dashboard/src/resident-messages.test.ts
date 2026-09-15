import { describe, it, expect } from 'vitest';
import { residentMessageAt } from './resident-messages';

describe('Resident message rotation', () => {
  const state = {
    message: 'Bonjour',
    messages: ['Bonjour', 'Paul vient demain', 'Bonne soirée'],
    messageIntervalSeconds: 5,
    messageUpdatedAt: 1000,
  };
  it('uses the requested duration and loops through all messages', () => {
    expect(residentMessageAt(state, 5999).text).toBe('Bonjour');
    expect(residentMessageAt(state, 6000).text).toBe('Paul vient demain');
    expect(residentMessageAt(state, 11000).text).toBe('Bonne soirée');
    expect(residentMessageAt(state, 16000).text).toBe('Bonjour');
  });
  it('keeps rotation stable across refreshes and offline snapshots', () => {
    expect(residentMessageAt(JSON.parse(JSON.stringify(state)), 26000).text).toBe('Bonne soirée');
    expect(residentMessageAt({ ...state, messageUpdatedAt: 26000 }, 26000).text).toBe('Bonjour');
  });
  it('supports older saved messages and clearing the banner', () => {
    expect(residentMessageAt({ message: 'Ancien message' }, 100000).text).toBe('Ancien message');
    expect(residentMessageAt({ message: '', messages: [] }, 100000).count).toBe(0);
  });
});
