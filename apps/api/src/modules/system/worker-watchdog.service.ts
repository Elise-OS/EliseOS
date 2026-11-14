import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../platform/prisma.service';

export const WORKER_HEARTBEAT_KEY = 'worker.heartbeat';
export const WORKER_ALERT_RULE_KEY = 'system:worker';
/** The worker writes its heartbeat every 15 seconds; five silent minutes mean it has stopped. */
export const WORKER_STALE_AFTER_MS = 5 * 60_000;
const CHECK_INTERVAL_MS = 60_000;

export interface WorkerState {
  healthy: boolean;
  lastSeenAt: string | null;
  failingTasks: string[];
}

export function readWorkerState(value: string | null | undefined, now: Date): WorkerState {
  let lastSeenAt: string | null = null;
  let failingTasks: string[] = [];
  try {
    const parsed = JSON.parse(value ?? 'null') as { at?: unknown; failingTasks?: unknown } | null;
    if (typeof parsed?.at === 'string' && !Number.isNaN(Date.parse(parsed.at))) {
      lastSeenAt = parsed.at;
    }
    if (Array.isArray(parsed?.failingTasks)) {
      failingTasks = parsed.failingTasks.filter((task): task is string => typeof task === 'string');
    }
  } catch {
    // An unreadable heartbeat is treated as a missing one.
  }
  const fresh =
    lastSeenAt !== null && now.getTime() - Date.parse(lastSeenAt) < WORKER_STALE_AFTER_MS;
  return { healthy: fresh && failingTasks.length === 0, lastSeenAt, failingTasks };
}

/**
 * The worker is the service that raises alerts, so it cannot report its own death.
 * The API watches its heartbeat and opens an explicit system alert in every home when the
 * worker has stopped or when one of its evaluations keeps failing: silence must never be
 * read as "everything is fine".
 */
@Injectable()
export class WorkerWatchdogService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkerWatchdogService.name);
  private readonly startedAt = Date.now();
  private timer: ReturnType<typeof setInterval> | null = null;

  public constructor(private readonly prisma: PrismaService) {}

  public onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.check().catch((error: unknown) =>
        this.logger.error('Vérification du worker impossible', error),
      );
    }, CHECK_INTERVAL_MS);
    this.timer.unref();
  }

  public onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  public async state(now = new Date()): Promise<WorkerState> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: WORKER_HEARTBEAT_KEY },
    });
    return readWorkerState(setting?.value, now);
  }

  public async check(now = new Date()): Promise<void> {
    // The worker only starts once the API is healthy: give it time before judging it.
    if (now.getTime() - this.startedAt < WORKER_STALE_AFTER_MS) return;
    const state = await this.state(now);
    const homes = await this.prisma.home.findMany({ select: { id: true } });
    for (const home of homes) await this.syncAlert(home.id, state);
  }

  private async syncAlert(homeId: string, state: WorkerState): Promise<void> {
    const latest = await this.prisma.alert.findFirst({
      where: { homeId, ruleKey: WORKER_ALERT_RULE_KEY },
      orderBy: { openedAt: 'desc' },
      select: { id: true, status: true, conditionClearedAt: true },
    });
    const open = latest && (latest.status === 'OPEN' || latest.status === 'ACKNOWLEDGED');
    if (!state.healthy) {
      const explanation =
        state.failingTasks.length > 0
          ? `Certaines vérifications automatiques échouent depuis plus de cinq minutes (${state.failingTasks.join(', ')}). Les alertes correspondantes peuvent ne pas se déclencher. Redémarrez le boîtier Élise ou installez la dernière mise à jour.`
          : 'Le service qui analyse les capteurs et envoie les notifications ne répond plus. Tant qu’il est arrêté, aucune alerte ni notification ne peut être émise. Redémarrez le boîtier Élise.';
      if (open) {
        await this.prisma.alert.update({
          where: { id: latest.id },
          data: { explanation, conditionClearedAt: null },
        });
        return;
      }
      // An alert closed by hand is not re-opened until the worker has really recovered.
      if (latest && !latest.conditionClearedAt) return;
      await this.prisma.alert.create({
        data: {
          homeId,
          type: 'SYSTEM',
          severity: 'URGENT',
          title: 'La surveillance automatique est interrompue',
          explanation,
          ruleKey: WORKER_ALERT_RULE_KEY,
        },
      });
      return;
    }
    if (!latest) return;
    if (!open) {
      if (!latest.conditionClearedAt) {
        await this.prisma.alert.update({
          where: { id: latest.id },
          data: { conditionClearedAt: new Date() },
        });
      }
      return;
    }
    await this.prisma.$transaction([
      this.prisma.alert.update({
        where: { id: latest.id },
        data: { status: 'RESOLVED', resolvedAt: new Date(), conditionClearedAt: new Date() },
      }),
      this.prisma.alertTransition.create({
        data: {
          alertId: latest.id,
          from: latest.status,
          to: 'RESOLVED',
          note: 'Retour automatique à la normale',
        },
      }),
    ]);
  }
}
