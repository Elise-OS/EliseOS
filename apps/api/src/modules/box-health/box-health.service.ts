import { Injectable } from '@nestjs/common';
import type { BoxHealthCheck, BoxHealthReport } from '@elise/contracts';
import { PrismaService } from '../../platform/prisma.service';
import { RemoteAccessAgentClient } from '../remote-access/remote-access-agent.client';
import { ZigbeeAgentClient } from '../zigbee/zigbee-agent.client';
import { WorkerWatchdogService } from '../system/worker-watchdog.service';
import { HealthAgentClient } from './health-agent.client';
import { check, percentLevel, verdictFor } from './box-health.rules';

@Injectable()
export class BoxHealthService {
  public constructor(private readonly prisma: PrismaService, private readonly host: HealthAgentClient, private readonly worker: WorkerWatchdogService, private readonly zigbee: ZigbeeAgentClient, private readonly remote: RemoteAccessAgentClient) {}

  public async report(): Promise<BoxHealthReport> {
    const [hostResult, workerResult, zigbeeResult, remoteResult, dbResult, sensorResult, notificationResult, failedOutboxResult] = await Promise.allSettled([
      this.host.status(), this.worker.state(), this.zigbee.status(), this.remote.status(),
      this.prisma.$queryRaw<Array<{ bytes: bigint }>>`SELECT pg_database_size(current_database()) AS bytes`,
      this.prisma.sensor.count({ where: { removedAt: null } }),
      this.prisma.notificationDelivery.count({ where: { createdAt: { gte: new Date(Date.now() - 86400000) }, status: 'FAILED' } }),
      this.prisma.outboxMessage.count({ where: { status: 'FAILED' } }),
    ]);
    const host = hostResult.status === 'fulfilled' ? hostResult.value : null;
    const checks: BoxHealthCheck[] = [];
    const root = host?.disk?.root?.usedPercent;
    checks.push(check('disk', percentLevel(root, 80, 92), { usedPercent: root ?? null }, root == null ? 'Impossible de vérifier l’espace disque.' : undefined));
    const swapTotal = host?.memory?.SwapTotal; const swapFree = host?.memory?.SwapFree;
    const swapPercent = typeof swapTotal === 'number' && swapTotal > 0 && typeof swapFree === 'number' ? (swapTotal - swapFree) * 100 / swapTotal : null;
    checks.push(check('swap', percentLevel(swapPercent, 50, 80), { usedPercent: swapPercent }));
    const temps: number[] | null = host?.temperatureC;
    checks.push(check('temperature', !temps?.length ? 'unknown' : Math.max(...temps) > 75 ? 'warning' : 'ok', { celsius: temps ?? null }));
    const throttled = host?.throttled;
    checks.push(check('throttling', throttled == null ? 'unknown' : (throttled & 0xF) !== 0 ? 'critical' : 'ok', { flags: throttled ?? null }));
    checks.push(check('containers', !host || !Array.isArray(host.containers) ? 'unknown' : host.containers.some((item: any) => item.oomKilled) ? 'critical' : host.containers.some((item: any) => item.health === 'unhealthy' || item.restartCount > 0) ? 'warning' : 'ok', { containers: host?.containers ?? null }));
    const io = host?.diskErrors?.count;
    checks.push(check('disk-errors', typeof io !== 'number' ? 'unknown' : io > 0 ? 'critical' : 'ok', { count: io ?? null }, undefined, 'open-remote-access'));
    const backup = host?.backup?.last;
    const backupAge = backup?.at ? (Date.now() - Date.parse(backup.at)) / 86400000 : null;
    checks.push(check('backup', !backup ? 'warning' : !backup.ok ? 'critical' : backupAge! > 7 ? 'critical' : backupAge! > 3 ? 'warning' : 'ok', { last: backup ?? null }, undefined, 'run-backup'));
    checks.push(check('worker', workerResult.status === 'rejected' ? 'unknown' : (workerResult.value as any)?.status === 'ok' ? 'ok' : 'warning', { state: workerResult.status === 'fulfilled' ? workerResult.value : null }));
    checks.push(check('zigbee', zigbeeResult.status === 'rejected' ? 'unknown' : 'ok', { available: zigbeeResult.status === 'fulfilled' }, undefined, 'open-zigbee'));
    checks.push(check('remote-access', remoteResult.status === 'rejected' ? 'unknown' : 'ok', { available: remoteResult.status === 'fulfilled' }, undefined, 'open-remote-access'));
    checks.push(check('sensors', sensorResult.status === 'rejected' ? 'unknown' : 'ok', { count: sensorResult.status === 'fulfilled' ? sensorResult.value : null }, undefined, 'open-sensors'));
    checks.push(check('notifications', notificationResult.status === 'rejected' ? 'unknown' : notificationResult.value > 0 ? 'warning' : 'ok', { failed24h: notificationResult.status === 'fulfilled' ? notificationResult.value : null }));
    checks.push(check('outbox', failedOutboxResult.status === 'rejected' ? 'unknown' : failedOutboxResult.value > 0 ? 'warning' : 'ok', { failed: failedOutboxResult.status === 'fulfilled' ? failedOutboxResult.value : null }));
    const dbBytes = dbResult.status === 'fulfilled' ? Number(dbResult.value[0]?.bytes) : null;
    checks.push(check('database', dbBytes == null ? 'unknown' : 'ok', { sizeBytes: dbBytes }));
    const groups = [
      { id: 'surveillance', checks: [checks[7]!] }, { id: 'home', checks: [checks[8]!, checks[10]!] },
      { id: 'notifications', checks: [checks[11]!, checks[12]!] }, { id: 'box', checks: checks.slice(0, 7) },
      { id: 'data', checks: [checks[13]!] }, { id: 'access', checks: [checks[9]!] },
    ];
    return { verdict: verdictFor(checks.map((item) => item.level)), checkedAt: new Date().toISOString(), groups };
  }
}
