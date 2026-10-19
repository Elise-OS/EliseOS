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
import { scheduledDate } from '../medications/medication-time';
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
    address: null as string | null,
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
      findMany: vi.fn().mockResolvedValue([row]),
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
    membership: {
      findMany: vi.fn().mockResolvedValue([membership]),
      findFirst: vi.fn().mockResolvedValue(membership),
    },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => Promise.resolve(fn(db)));
  return { state, row, home, db, service: new ScreenService(db as unknown as PrismaService) };
}
describe('Resident display policy', () => {
  it('extracts only the city from a stored address for the weather provider', () => {
    expect(cityFromAddress('12 rue de la Paix, 45000 Orléans, France')).toBe('Orléans');
    expect(cityFromAddress('Orléans')).toBe('Orléans');
    expect(cityFromAddress('12 rue de la Paix')).toBeNull();
  });
  it('returns French city suggestions for weather autocomplete', async () => {
    const { service } = fixture();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            results: [
              {
                name: 'Orléans',
                admin1: 'Centre-Val de Loire',
                country: 'France',
                latitude: 47.9029,
                longitude: 1.9039,
              },
            ],
          }),
      }),
    );
    await expect(service.searchWeatherCities('user1', 'Orl')).resolves.toEqual([
      {
        name: 'Orléans',
        label: 'Orléans, Centre-Val de Loire, France',
        latitude: 47.9029,
        longitude: 1.9039,
      },
    ]);
    vi.unstubAllGlobals();
  });
  it('does not infer TV weather from the home address when no city is configured', async () => {
    const { service, home } = fixture();
    home.address = '12 rue de la Paix, 45000 Orléans, France';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    try {
      const snapshot = await service.snapshot('user1');
      expect(snapshot.weather).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('returns weather on the first snapshot after an API restart', async () => {
    const { service, state } = fixture();
    state.settings.weatherCity = 'Chécy cold start';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            results: [{ name: 'Chécy', latitude: 47.89402, longitude: 2.02304 }],
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            current: { time: '2026-10-04T16:30', temperature_2m: 18.4, weather_code: 2 },
            daily: {
              temperature_2m_min: [11.2],
              temperature_2m_max: [19.1],
              weather_code: [2],
            },
          }),
      });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const snapshot = await service.snapshot('user1');
      expect(snapshot.weather).toEqual({
        city: 'Chécy',
        temperature: 18.4,
        minimum: 11.2,
        maximum: 19.1,
        weatherCode: 2,
        observedAt: '2026-10-04T16:30',
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
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
  it('accepts a mobile call immediately so joining does not depend on the maintenance timer', async () => {
    vi.stubEnv('ELISE_JITSI_URL', 'https://test.ts.net:8444');
    vi.stubEnv('ELISE_JITSI_SECRET', 'secret');
    const { service, state } = fixture();
    await service.startCall('user1', 'mobile');
    expect(state.call).toMatchObject({ client: 'mobile', automatic: true });
    expect(state.call?.acceptedAt).toEqual(expect.any(Number));
    await expect(service.join('user1', undefined, state.call!.id)).resolves.toMatchObject({
      url: 'https://test.ts.net:8444',
      room: state.call!.room,
      name: 'Paul',
    });
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
  it('accepts a photo without a caption while keeping titles required for other media', async () => {
    const { service, state } = fixture();
    await service.media('user1', {
      id: '3b2c2950-6fe5-45f8-82a5-a28707113e53',
      title: '',
      kind: 'photo',
      url: '/api/v1/screen-media/home1/photo',
    });
    expect(state.media[0]?.title).toBe('');
    await expect(service.media('user1', { ...playlist, title: ' ' })).rejects.toThrow();
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
  it('stores, executes and clears scheduled messages and photos', async () => {
    const { service, state } = fixture();
    const photoId = '550e8400-e29b-41d4-a716-446655440000';
    state.media.push({
      id: photoId,
      title: 'Souvenir en famille',
      kind: 'photo',
      url: `/api/v1/screen-media/home1/${photoId}`,
      mimeType: 'image/jpeg',
    });
    const future = new Date(Date.now() + 60_000);
    await service.scheduleContent('user1', {
      kind: 'message',
      scheduledAt: future,
      messages: ['Bonne journée ❤️'],
      messageIntervalSeconds: 20,
    });
    await service.scheduleContent('user1', {
      kind: 'photo',
      scheduledAt: future,
      mediaId: photoId,
    });
    expect(state.scheduledContent).toHaveLength(2);

    for (const item of state.scheduledContent ?? []) item.scheduledAt = Date.now() - 1;
    await (service as unknown as { tick: () => Promise<void> }).tick();

    expect(state.scheduledContent).toEqual([]);
    expect(state.message).toBe('Bonne journée ❤️');
    expect(state.playback.mediaId).toBe(photoId);
    expect(state.commands.at(-1)).toMatchObject({ action: 'play', status: 'pending' });
  });
  it('stores the chosen pictogram and includes it in the resident agenda', async () => {
    const { service, db } = fixture();
    const today = screenLocalTime(new Date(), 'Europe/Paris').date;
    const startsAt = scheduledDate(today, 17 * 60, 'Europe/Paris');
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
  it('only requests events scheduled on the current local day for the TV agenda', async () => {
    const { service, db } = fixture();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-23T12:00:00.000Z'));
    try {
      await service.snapshot('user1');
      const dayStart = scheduledDate('2026-09-23', 0, 'Europe/Paris');
      const nextDayStart = scheduledDate('2026-09-24', 0, 'Europe/Paris');
      for (const query of [db.visit.findMany, db.appointment.findMany]) {
        expect(query).toHaveBeenCalledWith({
          where: { homeId: 'home1', startsAt: { gte: dayStart, lt: nextDayStart } },
          orderBy: { startsAt: 'asc' },
        });
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
