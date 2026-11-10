import { describe, expect, it, vi } from 'vitest';
import { CamerasService } from './cameras.service';

const camera = {
  id: 'camera-1',
  homeId: 'home-1',
  roomId: 'room-1',
  deviceId: 'device-1',
  name: 'Salon',
  provider: 'reolink',
  streamKey: 'camera_stream_1',
  streamEntityId: 'camera.salon',
  personEntityId: 'binary_sensor.salon_person',
  privacyEntityId: 'switch.salon_privacy',
  streamUrlEncrypted: 'unused',
  status: 'ONLINE',
  compatibility: 'VALIDATED',
  liveEnabled: true,
  talkEnabled: true,
  ptzEnabled: true,
  privacySupported: true,
  snapshotEnabled: true,
  privacyMode: false,
  consentedAt: new Date(),
  consentedById: 'user-1',
  lastSeenAt: new Date(),
  lastPersonSeenAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('camera media authorization', () => {
  it('issues a scoped short-lived ticket for an authenticated caregiver', async () => {
    process.env.CAMERA_TICKET_KEY = 'camera-ticket-test-secret';
    const prisma = {
      home: { findFirst: vi.fn().mockResolvedValue({ id: 'home-1' }) },
      camera: {
        findFirst: vi.fn().mockResolvedValue(camera),
        findUnique: vi.fn().mockResolvedValue(camera),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const service = new CamerasService(prisma as never, {} as never);
    const session = await service.liveSession('user-1', camera.id, true);
    const url = new URL(session.mediaUrl, 'https://elise.test');
    expect(session.talkEnabled).toBe(true);
    await expect(
      service.authorizeMedia(url.searchParams.get('ticket')!, camera.streamKey, true),
    ).resolves.toBe(true);
    await expect(
      service.authorizeMedia(url.searchParams.get('ticket')!, camera.streamKey, false),
    ).resolves.toBe(false);
    await expect(
      service.authorizeMedia(url.searchParams.get('ticket')!, 'another-camera', true),
    ).resolves.toBe(false);
    expect(prisma.auditLog.create).toHaveBeenCalledOnce();
    const auditInput: unknown = prisma.auditLog.create.mock.calls[0]?.[0];
    expect(JSON.stringify(auditInput)).toContain('CAMERA_TALK_STARTED');
  });

  it('refuses a live session while privacy mode is active', async () => {
    const prisma = {
      home: { findFirst: vi.fn().mockResolvedValue({ id: 'home-1' }) },
      camera: { findFirst: vi.fn().mockResolvedValue({ ...camera, privacyMode: true }) },
    };
    const service = new CamerasService(prisma as never, {} as never);
    await expect(service.liveSession('user-1', camera.id, false)).rejects.toThrow(
      'Le mode intimité est actif.',
    );
  });

  it('revokes an existing media ticket as soon as privacy mode is active', async () => {
    process.env.CAMERA_TICKET_KEY = 'camera-ticket-test-secret';
    const prisma = {
      home: { findFirst: vi.fn().mockResolvedValue({ id: 'home-1' }) },
      camera: {
        findFirst: vi.fn().mockResolvedValue(camera),
        findUnique: vi.fn().mockResolvedValue({ ...camera, privacyMode: true }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const service = new CamerasService(prisma as never, {} as never);
    const session = await service.liveSession('user-1', camera.id, false);
    const url = new URL(session.mediaUrl, 'https://elise.test');

    await expect(
      service.authorizeMedia(url.searchParams.get('ticket')!, camera.streamKey, false),
    ).resolves.toBe(false);
  });
});
