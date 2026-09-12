/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Vitest asymmetric matchers use `any`. */
import { describe, expect, it, vi } from 'vitest';
import { SensorsService } from './sensors.service';

const membershipHome = { id: 'home-1' };

const detectedDevice = (now = new Date('2026-08-21T10:00:00.000Z')) => ({
  id: 'device-sonoff',
  homeId: 'home-1',
  name: 'SNZB-02P',
  displayName: null,
  manufacturer: 'SONOFF',
  model: 'SNZB-02P',
  protocol: 'zigbee',
  integration: 'zigbee2mqtt',
  installationStatus: 'NEEDS_PLACEMENT',
  enabled: true,
  placementConfirmedAt: null,
  room: null,
  sensors: [
    {
      id: 'sensor-temperature',
      entityId: 'sensor.sonoff_temperature',
      capability: 'temperature',
      sourceName: 'Temperature',
      status: 'ONLINE',
      unit: '°C',
      lastSeenAt: now,
      analysisEnabled: true,
      classificationSource: 'METADATA',
      classificationConfidence: 1,
      classificationReason: 'device class',
      classificationConfirmedAt: null,
      removedAt: null,
      events: [{ payload: { value: 21.7 } }],
    },
    {
      id: 'sensor-humidity',
      entityId: 'sensor.sonoff_humidity',
      capability: 'humidity',
      sourceName: 'Humidity',
      status: 'ONLINE',
      unit: '%',
      lastSeenAt: now,
      analysisEnabled: true,
      classificationSource: 'METADATA',
      classificationConfidence: 1,
      classificationReason: 'device class',
      classificationConfirmedAt: null,
      removedAt: null,
      events: [{ payload: { value: 48 } }],
    },
    {
      id: 'sensor-battery',
      entityId: 'sensor.sonoff_battery',
      capability: 'battery',
      sourceName: 'Battery',
      status: 'ONLINE',
      unit: '%',
      lastSeenAt: now,
      analysisEnabled: true,
      classificationSource: 'METADATA',
      classificationConfidence: 1,
      classificationReason: 'device class',
      classificationConfirmedAt: null,
      removedAt: null,
      events: [{ payload: { value: 96 } }],
    },
  ],
});

describe('SensorsService physical device views', () => {
  it('uses a friendly name for a presence sensor instead of a technical entity name', () => {
    const base = detectedDevice();
    const service = new SensorsService({} as never, {} as never);
    const result = (
      service as unknown as { deviceView(device: unknown): { name: string } }
    ).deviceView({
      ...base,
      name: 'Tvoc alert enable',
      model: 'Multi-function smart presence sensor R3',
      sensors: [{ ...base.sensors[0], capability: 'occupancy', sourceName: 'Occupancy' }],
    });

    expect(result.name).toBe('Capteur de présence');
  });

  it('unpairs a Zigbee sensor before removing it from Élise', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 2 });
    const deleteDevice = vi.fn().mockResolvedValue(undefined);
    const prisma = {
      home: { findFirst: vi.fn().mockResolvedValue(membershipHome) },
      device: {
        findFirst: vi.fn().mockResolvedValue({
          ...detectedDevice(),
          networkIdentifier: '0x00124b0023456789',
        }),
        delete: deleteDevice,
      },
      sensor: { updateMany },
      $transaction: vi.fn(async (actions: Array<Promise<unknown>>) => Promise.all(actions)),
    };
    const mqtt = {
      zigbeeStatus: vi.fn().mockReturnValue({ online: true }),
      removeZigbeeDevice: vi.fn(),
    };
    const service = new SensorsService(prisma as never, mqtt as never);

    const result = await service.remove('user-1', 'device-sonoff');

    expect(mqtt.removeZigbeeDevice).toHaveBeenCalledWith('0x00124b0023456789');
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { deviceId: 'device-sonoff', homeId: 'home-1' },
        data: expect.objectContaining({ removedAt: expect.any(Date), available: false }),
      }),
    );
    expect(deleteDevice).toHaveBeenCalledWith({ where: { id: 'device-sonoff' } });
    expect(result).toEqual({ removed: true, unpaired: true });
  });

  it('chooses the available connection automatically without asking the user', async () => {
    const createdAt = new Date();
    const createdSession = {
      id: 'onboarding-auto',
      homeId: 'home-1',
      deviceId: null,
      requestedById: 'user-1',
      protocol: 'zigbee',
      status: 'WAITING_FOR_DEVICE',
      step: 'PAIRING',
      errorCode: null,
      errorMessage: null,
      expiresAt: new Date(Date.now() + 240_000),
      createdAt,
      updatedAt: createdAt,
    };
    const create = vi.fn().mockResolvedValue(createdSession);
    const prisma = {
      home: { findFirst: vi.fn().mockResolvedValue(membershipHome) },
      sensorOnboardingSession: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        create,
      },
      equipmentSyncState: { upsert: vi.fn().mockResolvedValue(undefined) },
    };
    const mqtt = {
      zigbeeStatus: vi.fn().mockReturnValue({
        online: true,
        pairingOpen: false,
        updatedAt: createdAt,
        pairingResponseAt: null,
        pairingError: null,
      }),
      setZigbeePairing: vi.fn(),
    };
    const service = new SensorsService(prisma as never, mqtt as never);

    const result = await service.createOnboarding('user-1', {});

    const createInput = create.mock.calls[0]?.[0] as {
      data: { protocol: string; step: string };
    };
    expect(createInput.data).toMatchObject({ protocol: 'zigbee', step: 'PAIRING' });
    expect(mqtt.setZigbeePairing).toHaveBeenCalledTimes(1);
    expect(mqtt.setZigbeePairing).toHaveBeenCalledWith(true, 240);
    expect(result.protocol).toBe('zigbee');
  });

  it('does not close a newer Zigbee search when an old session is cancelled again', async () => {
    const cancelledSession = {
      id: 'onboarding-old',
      homeId: 'home-1',
      deviceId: null,
      requestedById: 'user-1',
      protocol: 'zigbee',
      status: 'CANCELLED',
      step: 'PAIRING',
      errorCode: null,
      errorMessage: null,
      expiresAt: new Date(Date.now() - 60_000),
      createdAt: new Date(Date.now() - 300_000),
      updatedAt: new Date(Date.now() - 60_000),
    };
    const prisma = {
      home: { findFirst: vi.fn().mockResolvedValue(membershipHome) },
      sensorOnboardingSession: {
        findFirst: vi.fn().mockResolvedValue(cancelledSession),
        update: vi.fn().mockResolvedValue(cancelledSession),
      },
      equipmentSyncState: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
    const mqtt = {
      setZigbeePairing: vi.fn(),
      zigbeeStatus: vi.fn().mockReturnValue({
        online: true,
        pairingOpen: true,
        updatedAt: new Date(),
        pairingResponseAt: new Date(),
        pairingError: null,
      }),
    };
    const service = new SensorsService(prisma as never, mqtt as never);

    await service.cancelOnboarding('user-1', cancelledSession.id);

    expect(mqtt.setZigbeePairing).not.toHaveBeenCalled();
  });

  it('attaches a re-paired sensor that existed before the current session', async () => {
    const sessionStartedAt = new Date('2026-08-21T10:00:00.000Z');
    const waitingSession = {
      id: 'onboarding-repair',
      homeId: 'home-1',
      deviceId: null,
      requestedById: 'user-1',
      protocol: 'zigbee',
      status: 'WAITING_FOR_DEVICE',
      step: 'PAIRING',
      errorCode: null,
      errorMessage: null,
      expiresAt: new Date('2099-08-21T10:04:00.000Z'),
      createdAt: sessionStartedAt,
      updatedAt: sessionStartedAt,
    };
    const device = detectedDevice(new Date('2026-08-21T10:00:05.000Z'));
    const foundSession = {
      ...waitingSession,
      deviceId: device.id,
      status: 'DEVICE_FOUND',
      step: 'CLASSIFICATION',
    };
    const findFirst = vi.fn().mockResolvedValueOnce(device).mockResolvedValueOnce(device);
    const prisma = {
      home: { findFirst: vi.fn().mockResolvedValue(membershipHome) },
      device: { findFirst },
      sensorOnboardingSession: {
        findFirst: vi.fn().mockResolvedValue(waitingSession),
        update: vi.fn().mockResolvedValue(foundSession),
      },
      equipmentSyncState: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const mqtt = {
      zigbeeStatus: vi.fn().mockReturnValue({ pairingError: null }),
      setZigbeePairing: vi.fn(),
    };
    const service = new SensorsService(prisma as never, mqtt as never);

    const result = await service.onboarding('user-1', waitingSession.id);

    const detectionQuery = findFirst.mock.calls[0]?.[0] as {
      where: { updatedAt: { gte: Date }; NOT: unknown };
    };
    expect(detectionQuery.where.updatedAt.gte).toEqual(sessionStartedAt);
    expect(detectionQuery.where.NOT).toBeDefined();
    expect(result.status).toBe('DEVICE_FOUND');
    expect(result.detectedDevice?.detectedType).toBe('TEMPERATURE_HUMIDITY');
  });

  it('groups several measurements and exposes battery as secondary information', async () => {
    const now = new Date('2026-08-17T12:00:00.000Z');
    const prisma = {
      home: { findFirst: vi.fn().mockResolvedValue(membershipHome) },
      device: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'device-1',
            name: 'Air sensor',
            displayName: null,
            manufacturer: 'Vendor',
            model: 'A1',
            protocol: 'zigbee',
            integration: 'zigbee2mqtt',
            installationStatus: 'OPERATIONAL',
            enabled: true,
            placementConfirmedAt: now,
            room: { id: 'room-1', name: 'Salon', kind: 'LIVING_ROOM' },
            sensors: [
              {
                id: 'temperature',
                entityId: 'sensor.air_temperature',
                capability: 'temperature',
                sourceName: 'Temperature',
                status: 'ONLINE',
                unit: '°C',
                lastSeenAt: now,
                analysisEnabled: true,
                classificationSource: 'METADATA',
                classificationConfidence: 1,
                classificationReason: 'device class',
                classificationConfirmedAt: null,
                events: [{ payload: { value: 21.5 } }],
              },
              {
                id: 'battery',
                entityId: 'sensor.air_battery',
                capability: 'battery',
                sourceName: 'Battery',
                status: 'ONLINE',
                unit: '%',
                lastSeenAt: now,
                analysisEnabled: true,
                classificationSource: 'METADATA',
                classificationConfidence: 1,
                classificationReason: 'device class',
                classificationConfirmedAt: null,
                events: [{ payload: { value: 82 } }],
              },
              {
                id: 'tvoc-alert-enable',
                entityId: 'switch.air_tvoc_alert_enable',
                capability: 'switch',
                sourceName: 'TVOC alert enable',
                status: 'OFFLINE',
                unit: null,
                lastSeenAt: now,
                analysisEnabled: true,
                classificationSource: 'METADATA',
                classificationConfidence: 1,
                classificationReason: 'domain',
                classificationConfirmedAt: null,
                events: [],
              },
            ],
          },
        ]),
      },
      sensor: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const service = new SensorsService(prisma as never, {} as never);

    const result = await service.list('user-1');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ name: 'Air sensor', batteryPercent: 82 });
    expect(result[0]?.capabilities).toHaveLength(3);
    expect(
      result[0]?.capabilities.find((item: { capability: string }) => item.capability === 'battery')
        ?.primary,
    ).toBe(false);
    expect(
      result[0]?.capabilities.find(
        (item: { entityId: string }) => item.entityId === 'switch.air_tvoc_alert_enable',
      )?.primary,
    ).toBe(false);
  });

  it('starts a short verification and asks the bridge for a fresh inventory', async () => {
    const now = Date.now();
    const create = vi
      .fn()
      .mockImplementation(({ data }: { data: { status: string; expiresAt: Date } }) => ({
        id: 'test-short',
        deviceId: 'device-sonoff',
        sensorId: null,
        status: data.status,
        startedAt: new Date(now),
        expiresAt: data.expiresAt,
        observedAt: null,
      }));
    const prisma = {
      home: { findFirst: vi.fn().mockResolvedValue(membershipHome) },
      device: { findFirst: vi.fn().mockResolvedValue({ id: 'device-sonoff' }) },
      sensorVerificationSession: { create },
    };
    const mqtt = { requestInventory: vi.fn() };
    const service = new SensorsService(prisma as never, mqtt as never);

    const result = await service.startVerification('user-1', 'device-sonoff');

    expect(result.status).toBe('PENDING');
    expect(Date.parse(result.expiresAt) - now).toBeGreaterThanOrEqual(19_000);
    expect(Date.parse(result.expiresAt) - now).toBeLessThanOrEqual(21_000);
    expect(mqtt.requestInventory).toHaveBeenCalledWith('home-1');
  });

  it('keeps waiting when no new event has been received since the test started', async () => {
    const session = {
      id: 'test-1',
      homeId: 'home-1',
      deviceId: 'device-1',
      sensorId: null,
      requestedById: 'user-1',
      status: 'PENDING',
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      observedAt: null,
      errorCode: null,
    };
    const prisma = {
      home: { findFirst: vi.fn().mockResolvedValue(membershipHome) },
      device: { findFirst: vi.fn().mockResolvedValue(null) },
      equipmentSyncState: { findUnique: vi.fn().mockResolvedValue(null) },
      observationEvent: { findFirst: vi.fn().mockResolvedValue(null) },
      sensorVerificationSession: {
        findFirst: vi.fn().mockResolvedValue(session),
        update: vi.fn().mockResolvedValue({
          ...session,
          status: 'WAITING_FOR_DEVICE',
          errorCode: null,
        }),
      },
    };
    const service = new SensorsService(prisma as never, {} as never);

    const result = await service.verification('user-1', 'test-1');

    expect(result.status).toBe('WAITING_FOR_DEVICE');
  });

  it('confirms an online Zigbee sensor from the live bridge inventory without waiting for motion', async () => {
    const session = {
      id: 'test-zigbee-online',
      homeId: 'home-1',
      deviceId: 'device-presence',
      sensorId: null,
      requestedById: 'user-1',
      status: 'PENDING',
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + 20_000),
      observedAt: null,
      errorCode: null,
    };
    const update = vi
      .fn()
      .mockImplementation(
        ({ data }: { data: { status: string; observedAt: Date; errorCode: null } }) => ({
          ...session,
          ...data,
        }),
      );
    const prisma = {
      home: { findFirst: vi.fn().mockResolvedValue(membershipHome) },
      observationEvent: { findFirst: vi.fn().mockResolvedValue(null) },
      device: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'device-presence',
          enabled: true,
          protocol: 'zigbee',
          networkIdentifier: '0x00124b0023456789',
          sensors: [{ available: true, status: 'ONLINE' }],
        }),
      },
      equipmentSyncState: {
        findUnique: vi.fn().mockResolvedValue({ inventorySeenAt: new Date(Date.now() + 1000) }),
      },
      sensorVerificationSession: {
        findFirst: vi.fn().mockResolvedValue(session),
        update,
      },
    };
    const mqtt = {
      zigbeeStatus: vi.fn().mockReturnValue({ online: true }),
      isZigbeeDeviceJoined: vi.fn().mockReturnValue(true),
    };
    const service = new SensorsService(prisma as never, mqtt as never);

    const result = await service.verification('user-1', session.id);

    expect(result.status).toBe('COMPLETED');
    expect(mqtt.isZigbeeDeviceJoined).toHaveBeenCalledWith('0x00124b0023456789');
  });

  it('does not accept an old cached inventory as proof of a current connection', async () => {
    const session = {
      id: 'test-stale',
      homeId: 'home-1',
      deviceId: 'device-presence',
      sensorId: null,
      status: 'PENDING',
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + 20_000),
    };
    const prisma = {
      home: { findFirst: vi.fn().mockResolvedValue(membershipHome) },
      observationEvent: { findFirst: vi.fn().mockResolvedValue(null) },
      device: {
        findFirst: vi.fn().mockResolvedValue({
          enabled: true,
          protocol: 'zigbee',
          networkIdentifier: '0x00124b0023456789',
          sensors: [{ available: true, status: 'ONLINE' }],
        }),
      },
      equipmentSyncState: {
        findUnique: vi.fn().mockResolvedValue({ inventorySeenAt: new Date(Date.now() - 60_000) }),
      },
      sensorVerificationSession: {
        findFirst: vi.fn().mockResolvedValue(session),
        update: vi.fn().mockResolvedValue({ ...session, status: 'WAITING_FOR_DEVICE' }),
      },
    };
    const mqtt = {
      zigbeeStatus: vi.fn().mockReturnValue({ online: true }),
      isZigbeeDeviceJoined: vi.fn().mockReturnValue(true),
    };

    const result = await new SensorsService(prisma as never, mqtt as never).verification(
      'user-1',
      session.id,
    );

    expect(result.status).toBe('WAITING_FOR_DEVICE');
  });

  it('completes only after receiving a new event for the tested sensor', async () => {
    const observedAt = new Date();
    const session = {
      id: 'test-connected',
      homeId: 'home-1',
      deviceId: 'device-1',
      sensorId: null,
      requestedById: 'user-1',
      status: 'PENDING',
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      observedAt: null,
      errorCode: null,
    };
    const prisma = {
      home: { findFirst: vi.fn().mockResolvedValue(membershipHome) },
      observationEvent: { findFirst: vi.fn().mockResolvedValue({ occurredAt: observedAt }) },
      sensorVerificationSession: {
        findFirst: vi.fn().mockResolvedValue(session),
        update: vi.fn().mockResolvedValue({
          ...session,
          status: 'COMPLETED',
          observedAt,
        }),
      },
    };
    const service = new SensorsService(prisma as never, {} as never);

    const result = await service.verification('user-1', session.id);

    expect(result.status).toBe('COMPLETED');
    expect(result.observedAt).toBe(observedAt.toISOString());
  });

  it('expires a verification that received no response during its short verification window', async () => {
    const session = {
      id: 'test-expired',
      homeId: 'home-1',
      deviceId: null,
      sensorId: 'sensor-1',
      requestedById: 'user-1',
      status: 'WAITING_FOR_DEVICE',
      startedAt: new Date(Date.now() - 6 * 60_000),
      expiresAt: new Date(Date.now() - 60_000),
      observedAt: null,
      errorCode: null,
    };
    const update = vi
      .fn()
      .mockResolvedValue({ ...session, status: 'EXPIRED', errorCode: 'NO_NEW_SIGNAL' });
    const prisma = {
      home: { findFirst: vi.fn().mockResolvedValue(membershipHome) },
      observationEvent: { findFirst: vi.fn().mockResolvedValue(null) },
      sensorVerificationSession: {
        findFirst: vi.fn().mockResolvedValue({ ...session, status: 'PENDING' }),
        update,
      },
    };
    const service = new SensorsService(prisma as never, {} as never);
    const result = await service.verification('user-1', session.id);
    expect(result.status).toBe('EXPIRED');
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ errorCode: 'NO_NEW_SIGNAL' }) }),
    );
  });

  it('presents a detected SONOFF as a temperature and humidity sensor with live values', async () => {
    const createdAt = new Date('2026-08-21T09:59:00.000Z');
    const session = {
      id: 'onboarding-1',
      homeId: 'home-1',
      deviceId: 'device-sonoff',
      requestedById: 'user-1',
      protocol: 'zigbee',
      status: 'DEVICE_FOUND',
      step: 'CLASSIFICATION',
      errorCode: null,
      errorMessage: null,
      expiresAt: new Date('2099-08-21T10:03:00.000Z'),
      createdAt,
      updatedAt: createdAt,
    };
    const prisma = {
      home: { findFirst: vi.fn().mockResolvedValue(membershipHome) },
      sensorOnboardingSession: { findFirst: vi.fn().mockResolvedValue(session) },
      device: { findFirst: vi.fn().mockResolvedValue(detectedDevice()) },
      equipmentSyncState: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const mqtt = {
      zigbeeStatus: vi.fn().mockReturnValue({ pairingError: null }),
      setZigbeePairing: vi.fn(),
    };
    const service = new SensorsService(prisma as never, mqtt as never);

    const result = await service.onboarding('user-1', 'onboarding-1');

    expect(result).toMatchObject({
      status: 'DEVICE_FOUND',
      detectedDevice: {
        manufacturer: 'SONOFF',
        model: 'SNZB-02P',
        detectedType: 'TEMPERATURE_HUMIDITY',
        batteryPercent: 96,
      },
    });
    expect(result.detectedDevice?.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ capability: 'temperature', value: { value: 21.7 } }),
        expect.objectContaining({ capability: 'humidity', value: { value: 48 } }),
        expect.objectContaining({ capability: 'battery', primary: false }),
      ]),
    );
  });

  it('completes installation without cancelling its session and activates an assigned sensor', async () => {
    const now = new Date('2026-08-21T10:00:00.000Z');
    const device = detectedDevice(now);
    const session = {
      id: 'onboarding-1',
      homeId: 'home-1',
      deviceId: device.id,
      requestedById: 'user-1',
      protocol: 'zigbee',
      status: 'DEVICE_FOUND',
      step: 'CLASSIFICATION',
      errorCode: null,
      errorMessage: null,
      expiresAt: new Date('2026-08-21T10:03:00.000Z'),
      createdAt: now,
      updatedAt: now,
      device,
    };
    const transactionDeviceUpdate = vi.fn().mockResolvedValue(undefined);
    const transactionSensorUpdate = vi.fn().mockResolvedValue({ count: 3 });
    const transactionSessionUpdate = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      home: { findFirst: vi.fn().mockResolvedValue(membershipHome) },
      sensorOnboardingSession: { findFirst: vi.fn().mockResolvedValue(session) },
      homePlan: { findUnique: vi.fn().mockResolvedValue(null) },
      device: { findFirst: vi.fn().mockResolvedValue(device) },
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<void>) =>
        callback({
          device: { update: transactionDeviceUpdate },
          room: { findFirst: vi.fn().mockResolvedValue({ id: 'room-1' }) },
          sensor: { updateMany: transactionSensorUpdate },
          homePlan: { findUnique: vi.fn().mockResolvedValue(null) },
          sensorOnboardingSession: { updateMany: transactionSessionUpdate },
          equipmentSyncState: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        }),
      ),
    };
    const mqtt = { setZigbeePairing: vi.fn() };
    const service = new SensorsService(prisma as never, mqtt as never);

    const result = await service.completeOnboarding('user-1', session.id, {
      name: 'Température chambre',
      roomId: null,
    });

    const deviceUpdate = transactionDeviceUpdate.mock.calls[0]?.[0] as {
      data: { displayName: string; roomId: string | null; installationStatus: string };
    };
    expect(deviceUpdate.data).toMatchObject({
      displayName: 'Température chambre',
      roomId: null,
      installationStatus: 'NEEDS_PLACEMENT',
      placementConfirmedAt: null,
    });
    expect(transactionSensorUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { roomId: null },
      }),
    );
    const sessionUpdate = transactionSessionUpdate.mock.calls[0]?.[0] as {
      data: { status: string; step: string };
    };
    expect(sessionUpdate.data).toMatchObject({ status: 'COMPLETED', step: 'COMPLETE' });
    expect(mqtt.setZigbeePairing).toHaveBeenCalledWith(false, 0);
    expect(result.sessionId).toBe(session.id);

    await service.completeOnboarding('user-1', session.id, {
      name: 'Température chambre',
      roomId: 'room-1',
    });
    expect(transactionDeviceUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          roomId: 'room-1',
          installationStatus: 'OPERATIONAL',
          placementConfirmedAt: expect.any(Date),
        }),
      }),
    );
  });
});
