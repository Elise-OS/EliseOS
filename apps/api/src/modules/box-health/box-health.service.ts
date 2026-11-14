import { Injectable } from '@nestjs/common';
import type {
  BoxHealthCheck,
  BoxHealthReport,
  RemoteAccessStatus,
  ZigbeeStatus,
} from '@elise/contracts';
import { PrismaService } from '../../platform/prisma.service';
import { RemoteAccessAgentClient } from '../remote-access/remote-access-agent.client';
import { ZigbeeAgentClient } from '../zigbee/zigbee-agent.client';
import { WorkerWatchdogService } from '../system/worker-watchdog.service';
import { HealthAgentClient } from './health-agent.client';
import type { HostHealthStatus } from './health-agent.client';
import {
  backupLevel,
  batteryLevel,
  check,
  containerLevel,
  databaseGrowth,
  percentLevel,
  storageErrorLevel,
  temperatureLevel,
  throttlingLevel,
  verdictFor,
  type DatabaseSizeBaseline,
} from './box-health.rules';
import { batteryPercentFromSensors, sensorCoverageState } from '@elise/shared';
import type { WorkerState } from '../system/worker-watchdog.service';

@Injectable()
export class BoxHealthService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly host: HealthAgentClient,
    private readonly worker: WorkerWatchdogService,
    private readonly zigbee: ZigbeeAgentClient,
    private readonly remote: RemoteAccessAgentClient,
  ) {}

  public async report(): Promise<BoxHealthReport> {
    const home = await this.prisma.home.findFirst({ select: { id: true, timezone: true } });
    const since24h = new Date(Date.now() - 86400000);
    const since2m = new Date(Date.now() - 120000);
    const [
      hostResult,
      workerResult,
      zigbeeResult,
      remoteResult,
      dbResult,
      sensorResult,
      notificationResult,
      failedOutboxResult,
      urgentOutboxResult,
      equipmentResult,
      eventResult,
      settingResult,
    ] = await Promise.allSettled([
      this.host.status(),
      this.worker.state(),
      this.zigbee.status(),
      this.remote.status(),
      this.prisma.$queryRaw<
        Array<{ bytes: bigint }>
      >`SELECT pg_database_size(current_database()) AS bytes`,
      this.prisma.sensor.findMany({
        where: { homeId: home?.id ?? '', removedAt: null },
        select: {
          id: true,
          capability: true,
          deviceClass: true,
          sourceName: true,
          entityId: true,
          available: true,
          status: true,
          lastSeenAt: true,
          room: { select: { name: true } },
          events: { orderBy: { receivedAt: 'desc' }, take: 1, select: { payload: true } },
        },
      }),
      this.prisma.notificationDelivery.count({
        where: { createdAt: { gte: since24h }, status: 'FAILED' },
      }),
      this.prisma.outboxMessage.count({ where: { status: 'FAILED' } }),
      this.prisma.outboxMessage.findMany({
        where: {
          status: { in: ['PENDING', 'FAILED'] },
          topic: 'webhook',
          createdAt: { lt: since2m },
        },
        select: { payload: true },
      }),
      this.prisma.equipmentSyncState.findFirst({
        where: { homeId: home?.id ?? '' },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.observationEvent.findFirst({
        where: { homeId: home?.id ?? '' },
        orderBy: { receivedAt: 'desc' },
        select: { receivedAt: true },
      }),
      this.prisma.systemSetting.findUnique({ where: { key: 'box-health.dbSize' } }),
    ]);
    const host: HostHealthStatus | null =
      hostResult.status === 'fulfilled' ? hostResult.value : null;
    const checks: BoxHealthCheck[] = [];
    const root = host?.disk?.root?.usedPercent;
    const dockerDisk = host?.disk?.docker?.usedPercent;
    const diskValues = [root, dockerDisk].filter(
      (value): value is number => typeof value === 'number',
    );
    const diskLevel =
      diskValues.length !== 2
        ? 'unknown'
        : Math.max(...diskValues) > 92
          ? 'critical'
          : Math.max(...diskValues) > 80
            ? 'warning'
            : 'ok';
    checks.push(
      check(
        'disk',
        diskLevel,
        { percent: root ?? null, dockerPercent: dockerDisk ?? null },
        diskLevel === 'unknown' ? 'Impossible de vérifier l’espace disque.' : undefined,
      ),
    );
    const swapTotal = host?.memory?.SwapTotal;
    const swapFree = host?.memory?.SwapFree;
    const swapPercent =
      typeof swapTotal === 'number' && typeof swapFree === 'number'
        ? swapTotal > 0
          ? ((swapTotal - swapFree) * 100) / swapTotal
          : swapTotal === 0 && swapFree === 0
            ? 0
            : null
        : null;
    checks.push(
      check('memory', percentLevel(swapPercent, 50, 100), {
        percent: swapPercent,
        total: swapTotal ?? null,
        kind: 'swap',
      }),
    );
    const temps = host?.temperatureC ?? null;
    checks.push(
      check('temperature', !temps?.length ? 'unknown' : temperatureLevel(Math.max(...temps)), {
        celsius: temps ?? null,
      }),
    );
    const throttled = host?.throttled;
    checks.push(
      check('throttling', throttlingLevel(throttled, host?.throttledApplicable), {
        flags: throttled ?? null,
        applicable: host?.throttledApplicable ?? null,
      }),
    );
    checks.push(
      check('containers', containerLevel(host?.containers), {
        containers: host?.containers ?? null,
      }),
    );
    const io = host?.diskErrors?.count;
    checks.push(check('storage-errors', storageErrorLevel(io), { count: io ?? null }));
    const backup = host?.backup?.last;
    const backupAge = backup?.at ? (Date.now() - Date.parse(backup.at)) / 86400000 : null;
    checks.push(
      check(
        'backup',
        backupLevel(backup),
        { last: backup ?? null, days: backupAge },
        undefined,
        'run-backup',
      ),
    );
    const workerState: WorkerState | null =
      workerResult.status === 'fulfilled' ? workerResult.value : null;
    checks.push(
      check(
        'worker',
        workerResult.status === 'rejected' ? 'unknown' : workerState?.healthy ? 'ok' : 'warning',
        { state: workerState },
      ),
    );
    const equipment = equipmentResult.status === 'fulfilled' ? equipmentResult.value : null;
    checks.push(
      check(
        'home-assistant',
        equipmentResult.status === 'rejected' || !equipment
          ? 'unknown'
          : equipment.bridgeConnected
            ? 'ok'
            : 'warning',
        {
          connected: equipment?.bridgeConnected ?? null,
          lastSeenAt: equipment?.homeAssistantSeenAt ?? null,
        },
      ),
    );
    const zigbeeState: ZigbeeStatus | null =
      zigbeeResult.status === 'fulfilled' ? zigbeeResult.value : null;
    checks.push(
      check(
        'zigbee',
        zigbeeResult.status === 'rejected'
          ? 'unknown'
          : zigbeeState?.state === 'READY'
            ? 'ok'
            : 'warning',
        { state: zigbeeState?.state ?? null, issues: zigbeeState?.issues ?? null },
        undefined,
        'open-zigbee',
      ),
    );
    const remoteState: RemoteAccessStatus | null =
      remoteResult.status === 'fulfilled' ? remoteResult.value : null;
    checks.push(
      check(
        'remote-access',
        remoteResult.status === 'rejected'
          ? 'unknown'
          : remoteState?.state === 'READY'
            ? 'ok'
            : 'warning',
        { state: remoteState?.state ?? null },
        undefined,
        'open-remote-access',
      ),
    );
    const sensors = sensorResult.status === 'fulfilled' ? sensorResult.value : null;
    const unavailable =
      sensors?.filter((sensor) => !sensor.available || sensor.status !== 'ONLINE') ?? [];
    const battery = sensors ? batteryPercentFromSensors(sensors) : null;
    const latestSensorSeenAt =
      sensors?.reduce<Date | null>(
        (latest, sensor) =>
          sensor.lastSeenAt && (!latest || sensor.lastSeenAt > latest) ? sensor.lastSeenAt : latest,
        null,
      ) ?? null;
    const vitalUnavailable = unavailable.some(
      (sensor) =>
        /sos|emergency/i.test(
          `${sensor.capability} ${sensor.deviceClass} ${sensor.sourceName} ${sensor.entityId}`,
        ) ||
        (['contact', 'dry_contact'].includes(sensor.capability) &&
          /entr|entry|front.?door/i.test(
            `${sensor.room?.name ?? ''} ${sensor.sourceName ?? ''} ${sensor.entityId ?? ''}`,
          )),
    );
    checks.push(
      check(
        'sensors-offline',
        sensorResult.status === 'rejected'
          ? 'unknown'
          : vitalUnavailable
            ? 'critical'
            : unavailable.length
              ? 'warning'
              : 'ok',
        {
          count: unavailable.length,
          total: sensors?.length ?? null,
          lastSeenAt: latestSensorSeenAt?.toISOString() ?? null,
        },
        undefined,
        'open-sensors',
      ),
    );
    checks.push(
      check(
        'sensors-battery',
        sensorResult.status === 'rejected' ? 'unknown' : batteryLevel(battery),
        { percent: battery },
      ),
    );
    checks.push(
      check(
        'coverage',
        sensors === null
          ? 'unknown'
          : sensorCoverageState(
                sensors.length,
                sensors.filter((sensor) => sensor.available && sensor.status === 'ONLINE').length,
              ) === 'OUTAGE'
            ? 'warning'
            : sensors.length
              ? 'ok'
              : 'unknown',
        {
          total: sensors?.length ?? null,
          count:
            sensors?.filter((sensor) => sensor.available && sensor.status === 'ONLINE').length ??
            null,
        },
      ),
    );
    checks.push(
      check(
        'deliveries',
        notificationResult.status === 'rejected'
          ? 'unknown'
          : notificationResult.value > 0
            ? 'warning'
            : 'ok',
        { failed: notificationResult.status === 'fulfilled' ? notificationResult.value : null },
      ),
    );
    const overdueAlertIds =
      urgentOutboxResult.status === 'fulfilled'
        ? [
            ...new Set(
              urgentOutboxResult.value
                .map((row) => (row.payload as { alertId?: unknown } | null)?.alertId)
                .filter((id): id is string => typeof id === 'string'),
            ),
          ]
        : [];
    let overdueUrgentAlerts: number | null = null;
    let overdueAlertQueryFailed = urgentOutboxResult.status === 'rejected';
    if (!overdueAlertQueryFailed) {
      const [alertResult] = await Promise.allSettled([
        this.prisma.alert.count({ where: { id: { in: overdueAlertIds }, severity: 'URGENT' } }),
      ]);
      if (alertResult?.status === 'fulfilled') overdueUrgentAlerts = alertResult.value;
      else overdueAlertQueryFailed = true;
    }
    checks.push(
      check(
        'outbox',
        failedOutboxResult.status === 'rejected' || overdueAlertQueryFailed
          ? 'unknown'
          : failedOutboxResult.value > 0 || (overdueUrgentAlerts ?? 0) > 0
            ? 'warning'
            : 'ok',
        {
          failed: failedOutboxResult.status === 'fulfilled' ? failedOutboxResult.value : null,
          urgent: overdueUrgentAlerts,
        },
      ),
    );
    const latestEvent =
      eventResult.status === 'fulfilled' ? (eventResult.value?.receivedAt ?? null) : null;
    const eventHours = latestEvent ? (Date.now() - latestEvent.getTime()) / 3600000 : null;
    const localHour = Number(
      new Intl.DateTimeFormat('en', {
        timeZone: home?.timezone ?? 'UTC',
        hour: '2-digit',
        hourCycle: 'h23',
      }).format(new Date()),
    );
    checks.push(
      check(
        'last-event',
        eventResult.status === 'rejected' || eventHours == null || eventHours < 0
          ? 'unknown'
          : eventHours > 12
            ? 'critical'
            : localHour >= 8 && localHour < 22 && eventHours > 2
              ? 'warning'
              : 'ok',
        { hours: eventHours, minutes: eventHours == null ? null : eventHours * 60 },
      ),
    );
    const dbBytes = dbResult.status === 'fulfilled' ? Number(dbResult.value[0]?.bytes) : null;
    let dbBaseline: DatabaseSizeBaseline | null = null;
    if (settingResult.status === 'fulfilled' && settingResult.value?.value) {
      try {
        const parsed = JSON.parse(settingResult.value.value) as DatabaseSizeBaseline;
        if (typeof parsed.bytes === 'number' && typeof parsed.at === 'string') dbBaseline = parsed;
      } catch {
        /* older byte-only baselines have no date and must be refreshed first */
      }
    }
    const dbGrowth = databaseGrowth(dbBytes, dbBaseline);
    const dbLevel = settingResult.status === 'rejected' ? 'unknown' : dbGrowth.level;
    checks.push(check('db-size', dbLevel, { total: dbBytes, percent: dbGrowth.percent }));
    if (dbBytes != null && settingResult.status === 'fulfilled' && dbGrowth.refreshBaseline) {
      const now = new Date();
      await this.prisma.systemSetting
        .upsert({
          where: { key: 'box-health.dbSize' },
          create: {
            key: 'box-health.dbSize',
            value: JSON.stringify({ bytes: dbBytes, at: now.toISOString() }),
          },
          update: { value: JSON.stringify({ bytes: dbBytes, at: now.toISOString() }) },
        })
        .catch(() => undefined);
    }
    const groups = [
      { id: 'monitoring', checks: [checks[7]!, checks[13]!, checks[16]!] },
      { id: 'home', checks: [checks[8]!, checks[9]!, checks[11]!, checks[12]!] },
      { id: 'notifications', checks: [checks[14]!, checks[15]!] },
      { id: 'box', checks: checks.slice(0, 6) },
      { id: 'data', checks: [checks[17]!, checks[6]!] },
      { id: 'access', checks: [checks[10]!] },
    ];
    return {
      verdict: verdictFor(checks.map((item) => item.level)),
      checkedAt: new Date().toISOString(),
      groups,
      backup: { running: Boolean(host?.backup?.running) },
      technical: host ?? null,
    };
  }
}
