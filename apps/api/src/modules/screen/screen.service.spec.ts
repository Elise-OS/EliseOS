import { describe, it, expect, vi } from 'vitest';
import { ScreenService, cityFromAddress } from './screen.service';
import {
  ARTE_LIVE_URL,
  initialScreenState,
  advanceScreenSchedule,
  screenIsQuiet,
  screenLocalTime,
} from '@michel/contracts';
import type { PrismaService } from '../../platform/prisma.service';
function fixture() {
  const state = initialScreenState();
  state.settings.quietStart = '00:00';
  state.settings.quietEnd = '00:00';
  state.settings.consent = true;
  const row = {
    id: 'screen1',
    homeId: 'home1',
    state,
    lastSeenAt: new Date(),
    capabilities: { camera: true, microphone: true },
    tokenHash: 'hash',
  };
  const membership = { userId: 'user1', systemRole: 'OWNER', user: { displayName: 'Paul' } };
  const home = {
    id: 'home1',
    address: null,
    timezone: 'Europe/Paris',
    organizationId: 'org1',
    primaryResident: { displayName: 'Michel' },
    organization: { memberships: [membership] },
  };
  const db = {
    home: {
      findFirst: vi.fn().mockResolvedValue(home),
      findUniqueOrThrow: vi.fn().mockResolvedValue(home),
    },
    residentScreen: {
      upsert: vi.fn().mockResolvedValue(row),
      findUniqueOrThrow: vi.fn().mockResolvedValue(row),
      update: vi.fn().mockResolvedValue(row),
      findUnique: vi.fn().mockResolvedValue(row),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    user: { findUniqueOrThrow: vi.fn().mockResolvedValue({ displayName: 'Paul' }) },
    visit: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
    appointment: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi
        .fn()
        .mockImplementation(({ data }) => Promise.resolve({ id: 'appointment1', ...data })),
    },
    observationEvent: { findFirst: vi.fn().mockResolvedValue(null) },
    membership: { findMany: vi.fn().mockResolvedValue([membership]) },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => Promise.resolve(fn(db)));
  return { state, row, db, service: new ScreenService(db as unknown as PrismaService) };
}
describe('Resident display policy', () => {
  it('extracts only the city from a stored address for the weather provider', () => {
    expect(cityFromAddress('12 rue de la Paix, 45000 Orléans, France')).toBe('Orléans');
    expect(cityFromAddress('Orléans')).toBe('Orléans');
    expect(cityFromAddress('12 rue de la Paix')).toBeNull();
  });
  it('handles midnight and DST using household wall time', () => {
    const s = initialScreenState();
    expect(screenIsQuiet(s.settings, '23:00')).toBe(true);
    expect(screenIsQuiet(s.settings, '08:00')).toBe(false);
    expect(screenLocalTime(new Date('2026-03-29T01:30:00Z'), 'Europe/Paris').time).toBe('03:30');
    advanceScreenSchedule(s, new Date('2026-09-15T01:00:00Z'), 'Europe/Paris');
    expect(s.playback.asleep).toBe(true);
  });
  it('does not undo a resident stop during the same slot', () => {
    const s = initialScreenState();
    advanceScreenSchedule(s, new Date('2026-09-14T10:00:00Z'), 'Europe/Paris');
    s.playback.asleep = true;
    advanceScreenSchedule(s, new Date('2026-09-14T10:05:00Z'), 'Europe/Paris');
    expect(s.playback.asleep).toBe(true);
    advanceScreenSchedule(s, new Date('2026-09-15T06:01:00Z'), 'Europe/Paris');
    expect(s.playback.asleep).toBe(false);
  });
  it('rejects expired or reused pairing codes', async () => {
    const { service } = fixture();
    await expect(service.pair('a'.repeat(24))).rejects.toThrow();
  });
  it('refuses a call without consent', async () => {
    vi.stubEnv('ELISE_JITSI_URL', 'https://test.ts.net:8444');
    vi.stubEnv('ELISE_JITSI_SECRET', 'secret');
    const { service, state } = fixture();
    state.settings.consent = false;
    await expect(service.startCall('user1')).rejects.toThrow('Accord');
    vi.unstubAllEnvs();
  });
  it('allows a receive-only call before resident camera and microphone are connected', async () => {
    vi.stubEnv('ELISE_JITSI_URL', 'https://test.ts.net:8444');
    vi.stubEnv('ELISE_JITSI_SECRET', 'secret');
    const { service, row, state } = fixture();
    row.capabilities = { camera: false, microphone: false };
    await service.startCall('user1');
    expect(state.call?.userId).toBe('user1');
    vi.unstubAllEnvs();
  });
  it('rejects a concurrent call and does not overwrite it', async () => {
    vi.stubEnv('ELISE_JITSI_URL', 'https://test.ts.net:8444');
    vi.stubEnv('ELISE_JITSI_SECRET', 'secret');
    const { service, state } = fixture();
    state.call = {
      id: 'existing',
      room: 'existing',
      userId: 'user1',
      name: 'Paul',
      automatic: true,
      createdAt: Date.now(),
      acceptedAt: null,
      deadline: Date.now() + 5000,
    };
    await expect(service.startCall('user1')).rejects.toThrow('déjà');
    expect(state.call.id).toBe('existing');
    vi.unstubAllEnvs();
  });
  it('does not create commands while the display is offline', async () => {
    const { service, row, state } = fixture();
    row.lastSeenAt = new Date(0);
    await expect(service.command('user1', { action: 'play' })).rejects.toThrow('hors ligne');
    expect(state.commands).toHaveLength(0);
  });
  it('does not give another caregiver the caller token', async () => {
    const { service, state } = fixture();
    state.call = {
      id: 'call',
      room: 'room',
      userId: 'another',
      name: 'X',
      automatic: true,
      createdAt: Date.now(),
      acceptedAt: Date.now(),
      deadline: 0,
    };
    await expect(service.join('user1', undefined, 'call')).rejects.toThrow();
  });
  it('clears an ongoing call when consent is revoked', async () => {
    const { service, state } = fixture();
    state.call = {
      id: 'call',
      room: 'room',
      userId: 'user1',
      name: 'Paul',
      automatic: true,
      createdAt: Date.now(),
      acceptedAt: Date.now(),
      deadline: 0,
    };
    await service.settings('user1', { ...state.settings, consent: false });
    expect(state.call).toBeNull();
    expect(state.history.at(-1)?.result).toBe('consent_revoked');
  });
});

describe('TV and YouTube playlists', () => {
  const playlist = {
    id: 'd108520f-6129-4b1b-b69d-a838471667f9',
    title: 'Concerts',
    kind: 'youtube' as const,
    url: 'https://www.youtube.com/watch?v=M7lc1UVf-VE',
    playlistUrls: ['https://www.youtube.com/watch?v=M7lc1UVf-VE', 'https://youtu.be/bHQqvYy5KYo'],
  };
  it('stores playlist order and keeps next within YouTube even with photos', async () => {
    const { service, state } = fixture();
    await service.media('user1', playlist);
    expect(state.media[0]?.playlistUrls).toEqual(playlist.playlistUrls);
    state.media.push({
      id: '3b2c2950-6fe5-45f8-82a5-a28707113e53',
      title: 'Famille',
      kind: 'photo',
      url: '/api/v1/screen-media/home1/photo',
    });
    await service.command('user1', { action: 'play', mediaId: playlist.id });
    await service.command('user1', { action: 'pause' });
    await service.command('user1', { action: 'next' });
    expect(state.playback.mediaId).toBe(playlist.id);
    expect(state.playback.paused).toBe(false);
    expect(state.activity.at(-1)?.title).toBe('Vidéo suivante demandée');
  });
  it('launches ARTE and keeps TV selected when next is requested', async () => {
    const { service, state } = fixture();
    await service.media('user1', {
      id: playlist.id,
      title: 'ARTE',
      kind: 'tv',
      url: ARTE_LIVE_URL,
    });
    state.media.push({
      id: '3b2c2950-6fe5-45f8-82a5-a28707113e53',
      title: 'Famille',
      kind: 'photo',
      url: '/api/v1/screen-media/home1/photo',
    });
    await service.command('user1', { action: 'play', mediaId: playlist.id });
    expect(state.activity.at(-1)?.title).toBe('ARTE lancée');
    await service.command('user1', { action: 'next' });
    expect(state.playback.mediaId).toBe(playlist.id);
  });
  it('rejects invalid YouTube entries and arbitrary TV sources', async () => {
    const { service, state } = fixture();
    await expect(
      service.media('user1', {
        ...playlist,
        playlistUrls: ['https://youtube.com.evil.test/watch?v=M7lc1UVf-VE'],
      }),
    ).rejects.toThrow();
    await expect(
      service.media('user1', {
        ...playlist,
        kind: 'tv',
        playlistUrls: undefined,
        url: 'https://example.com/live.m3u8',
      }),
    ).rejects.toThrow();
    expect(state.media).toHaveLength(0);
  });
});

describe('TV messages and appointment pictograms', () => {
  it('persists several messages, their duration and their author', async () => {
    const { service, state } = fixture();
    await service.message('user1', {
      messages: [' Bonjour ', 'À demain ❤️'],
      messageIntervalSeconds: 15,
    });
    expect(state.messages).toEqual(['Bonjour', 'À demain ❤️']);
    expect(state.message).toBe('Bonjour');
    expect(state.messageIntervalSeconds).toBe(15);
    expect(state.messageAuthor).toBe('Paul');
    expect(state.messageUpdatedAt).toEqual(expect.any(Number));
    await service.message('user1', { messages: [] });
    expect(state.messages).toEqual([]);
    expect(state.message).toBe('');
    expect(state.messageAuthor).toBeNull();
  });
  it('accepts the old single-message API and rejects invalid timers and empty entries', async () => {
    const { service, state } = fixture();
    await service.message('user1', 'Bonjour');
    expect(state.messages).toEqual(['Bonjour']);
    await expect(
      service.message('user1', { messages: [''], messageIntervalSeconds: 10 }),
    ).rejects.toThrow();
    await expect(
      service.message('user1', { messages: ['Bonjour'], messageIntervalSeconds: 0 }),
    ).rejects.toThrow();
    await expect(
      service.message('user1', { messages: Array(21).fill('Bonjour') }),
    ).rejects.toThrow();
    expect(state.messages).toEqual(['Bonjour']);
  });
  it('stores the chosen pictogram and includes it in the resident agenda', async () => {
    const { service, db } = fixture();
    const startsAt = new Date(Date.now() + 3600000);
    await service.addAppointment('user1', {
      title: 'Coiffeur',
      startsAt,
      pictogram: 'hairdresser',
    });
    expect(db.appointment.create).toHaveBeenCalledWith({
      data: { homeId: 'home1', title: 'Coiffeur', startsAt, pictogram: 'hairdresser' },
    });
    db.appointment.findMany.mockResolvedValue([
      { id: 'appointment1', title: 'Coiffeur', startsAt, pictogram: 'hairdresser' },
    ] as never);
    const snapshot = await service.snapshot('user1');
    expect(snapshot.agenda[0]?.pictogram).toBe('hairdresser');
    await service.updateAppointmentPictogram('user1', 'appointment1', 'walk');
    expect(db.appointment.updateMany).toHaveBeenCalledWith({
      where: { id: 'appointment1', homeId: 'home1' },
      data: { pictogram: 'walk' },
    });
    db.appointment.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.updateAppointmentPictogram('user1', 'foreign-appointment', 'medical'),
    ).rejects.toThrow();
  });
  it('requires the corresponding permission to publish messages or change appointments', async () => {
    const { service, state, db } = fixture();
    state.settings.grants.user1 = {
      autoAnswer: false,
      message: false,
      control: false,
      call: false,
      administer: false,
    };
    await expect(service.message('user1', { messages: ['Bonjour'] })).rejects.toThrow();
    await expect(
      service.updateAppointmentPictogram('user1', 'appointment1', 'medical'),
    ).rejects.toThrow();
    expect(db.appointment.updateMany).not.toHaveBeenCalled();
  });
});
