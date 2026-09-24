import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  alertRuleSettingsSchema,
  DEFAULT_ALERT_RULE_SETTINGS,
  type AlertRuleSettings,
} from '@michel/contracts';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../platform/prisma.service';
import { rolesFor } from '../auth/access-policy';

const ALERT_MANAGERS = rolesFor('alerts:manage');
const CONFIGURATION_MANAGERS = rolesFor('configuration:manage');
type AlertAnchor = { id: string; homeId: string; openedAt: Date };
type MovementEvidence = { occurredAt: Date; roomName: string | null };

@Injectable()
export class AlertsService {
  public constructor(private readonly prisma: PrismaService) {}

  public list(userId: string) {
    return this.prisma.alert.findMany({
      where: {
        home: { organization: { memberships: { some: { userId, disabledAt: null } } } },
      },
      orderBy: { openedAt: 'desc' },
      take: 100,
      include: {
        room: { select: { id: true, name: true } },
        transitions: { orderBy: { createdAt: 'asc' } },
        cameraSnapshots: {
          where: { expiresAt: { gt: new Date() } },
          select: { id: true, cameraId: true, capturedAt: true, expiresAt: true },
        },
      },
    });
  }

  public async feed(userId: string, limit: number, cursor?: string) {
    const items = await this.prisma.alert.findMany({
      where: {
        home: { organization: { memberships: { some: { userId, disabledAt: null } } } },
      },
      orderBy: [{ openedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        room: { select: { id: true, name: true } },
        transitions: { orderBy: { createdAt: 'asc' } },
        cameraSnapshots: {
          where: { expiresAt: { gt: new Date() } },
          select: { id: true, cameraId: true, capturedAt: true, expiresAt: true },
        },
      },
    });
    const page = items.slice(0, limit);
    const evidence = await this.inactivityEvidence(
      page.filter((item) => item.type === 'INACTIVITY'),
    );
    return {
      items: page.map((item) =>
        item.type === 'INACTIVITY'
          ? { ...item, lastMovement: evidence.get(item.id) ?? null }
          : item,
      ),
      nextCursor: items.length > limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  public async summary(userId: string) {
    const where = {
      home: { organization: { memberships: { some: { userId, disabledAt: null } } } },
      status: { in: ['OPEN', 'ACKNOWLEDGED'] as Array<'OPEN' | 'ACKNOWLEDGED'> },
      severity: 'URGENT' as const,
    };
    return { urgentCount: await this.prisma.alert.count({ where }) };
  }

  public async detail(userId: string, id: string) {
    const alert = await this.prisma.alert.findFirst({
      where: {
        id,
        home: { organization: { memberships: { some: { userId, disabledAt: null } } } },
      },
      include: {
        room: { select: { id: true, name: true } },
        transitions: { orderBy: { createdAt: 'asc' } },
        cameraSnapshots: {
          where: { expiresAt: { gt: new Date() } },
          select: { id: true, cameraId: true, capturedAt: true, expiresAt: true },
        },
      },
    });
    if (!alert) throw new NotFoundException('Alert not found');

    const sensorId =
      /^(?:temperature-low|temperature-high|sensor-offline|door-open|low-battery):(.+)$/.exec(
        alert.ruleKey ?? '',
      )?.[1];
    const sensor = sensorId
      ? await this.prisma.sensor.findFirst({
          where: { id: sensorId, homeId: alert.homeId },
          select: { id: true, sourceName: true, capability: true, unit: true },
        })
      : null;
    const observations = sensor
      ? await this.prisma.observationEvent.findMany({
          where: {
            homeId: alert.homeId,
            sensorId: sensor.id,
            occurredAt: {
              gte: new Date(alert.openedAt.getTime() - 30 * 60 * 1000),
              ...(alert.resolvedAt
                ? { lte: new Date(alert.resolvedAt.getTime() + 30 * 60 * 1000) }
                : {}),
            },
          },
          orderBy: { occurredAt: 'desc' },
          take: 20,
          select: { id: true, occurredAt: true, capability: true, quality: true, payload: true },
        })
      : [];
    const movementEvidence =
      alert.type === 'INACTIVITY'
        ? ((await this.inactivityEvidence([alert])).get(alert.id) ?? null)
        : undefined;
    return {
      ...alert,
      ...(alert.type === 'INACTIVITY' ? { lastMovement: movementEvidence } : {}),
      sensor,
      observations: observations.map((observation) => {
        const raw = (observation.payload as { value?: unknown } | null)?.value;
        const value =
          typeof raw === 'number' && Number.isFinite(raw)
            ? raw
            : typeof raw === 'string' && raw.trim() && Number.isFinite(Number(raw))
              ? Number(raw)
              : null;
        return {
          id: observation.id,
          occurredAt: observation.occurredAt,
          capability: observation.capability,
          quality: observation.quality,
          payload: { value },
        };
      }),
    };
  }

  private async inactivityEvidence(alerts: AlertAnchor[]): Promise<Map<string, MovementEvidence>> {
    if (alerts.length === 0) return new Map();
    const evidence = await this.prisma.$queryRaw<
      Array<{ alertId: string; occurredAt: Date; roomName: string | null }>
    >`
      SELECT alert.id AS "alertId", movement."occurredAt", movement."roomName"
      FROM "Alert" AS alert
      JOIN LATERAL (
        SELECT event."occurredAt", COALESCE(event_room.name, sensor_room.name) AS "roomName"
        FROM "ObservationEvent" AS event
        JOIN "Sensor" AS sensor
          ON sensor.id = event."sensorId" AND sensor."homeId" = event."homeId"
        LEFT JOIN "Room" AS event_room ON event_room.id = event."roomId"
        LEFT JOIN "Room" AS sensor_room ON sensor_room.id = sensor."roomId"
        WHERE event."homeId" = alert."homeId"
          AND event."occurredAt" <= alert."openedAt"
          AND event.quality = 'good'
          AND event.capability IN ('motion', 'occupancy', 'person_presence')
          AND COALESCE((event.payload->>'active')::boolean, false) = true
        ORDER BY event."occurredAt" DESC
        LIMIT 1
      ) AS movement ON true
      WHERE alert.id IN (${Prisma.join(alerts.map((alert) => alert.id))})
    `;
    return new Map(
      evidence.map(({ alertId, occurredAt, roomName }) => [alertId, { occurredAt, roomName }]),
    );
  }

  public async rules(userId: string): Promise<AlertRuleSettings> {
    const home = await this.memberHome(userId);
    const revision = await this.prisma.configurationRevision.findFirst({
      where: { homeId: home.id },
      orderBy: { version: 'desc' },
      select: { settings: true },
    });
    const settings = revision?.settings as Record<string, unknown> | undefined;
    const parsed = alertRuleSettingsSchema.safeParse(settings?.alertRules);
    return parsed.success ? parsed.data : DEFAULT_ALERT_RULE_SETTINGS;
  }

  public async updateRules(userId: string, rules: AlertRuleSettings): Promise<AlertRuleSettings> {
    const home = await this.administratorHome(userId);
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`alert-rules:${home.id}`}))`;
      const latest = await tx.configurationRevision.findFirst({
        where: { homeId: home.id },
        orderBy: { version: 'desc' },
      });
      const current = (latest?.settings as Record<string, unknown> | undefined) ?? {};
      await tx.configurationRevision.create({
        data: {
          homeId: home.id,
          version: (latest?.version ?? 0) + 1,
          settings: { ...current, alertRules: rules },
        },
      });
      await tx.auditLog.create({
        data: {
          homeId: home.id,
          actorId: userId,
          action: 'ALERT_RULES_UPDATED',
          target: home.id,
          metadata: { ruleTypes: Object.keys(rules) },
        },
      });
    });
    return rules;
  }

  public async transition(
    userId: string,
    id: string,
    status: 'ACKNOWLEDGED' | 'RESOLVED' | 'DISMISSED',
    note?: string,
  ) {
    const alert = await this.prisma.alert.findFirst({
      where: {
        id,
        home: {
          organization: {
            memberships: {
              some: {
                userId,
                disabledAt: null,
                systemRole: { in: ALERT_MANAGERS },
              },
            },
          },
        },
      },
    });
    if (!alert) throw new NotFoundException('Alert not found');
    if (
      !['OPEN', 'ACKNOWLEDGED'].includes(alert.status) ||
      (status === 'ACKNOWLEDGED' && alert.status !== 'OPEN')
    )
      throw new ConflictException('Cette alerte a déjà changé de statut.');
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.alert.updateMany({
        where: { id, status: alert.status },
        data: {
          status,
          acknowledgedAt: status === 'ACKNOWLEDGED' ? now : alert.acknowledgedAt,
          resolvedAt: status === 'RESOLVED' || status === 'DISMISSED' ? now : null,
        },
      });
      if (changed.count !== 1) throw new ConflictException('Cette alerte a déjà changé de statut.');
      await tx.alertTransition.create({
        data: { alertId: id, userId, from: alert.status, to: status, note: note ?? null },
      });
      await tx.outboxMessage.create({
        data: {
          homeId: alert.homeId,
          topic: 'webhook',
          payload: { event: `alert.${status.toLowerCase()}`, alertId: id },
        },
      });
      return tx.alert.findUniqueOrThrow({ where: { id } });
    });
  }

  private async administratorHome(userId: string) {
    const home = await this.prisma.home.findFirst({
      where: {
        organization: {
          memberships: {
            some: {
              userId,
              disabledAt: null,
              systemRole: { in: CONFIGURATION_MANAGERS },
            },
          },
        },
      },
      select: { id: true },
    });
    if (!home) throw new ForbiddenException('Administrator access required');
    return home;
  }

  private async memberHome(userId: string) {
    const home = await this.prisma.home.findFirst({
      where: {
        organization: { memberships: { some: { userId, disabledAt: null } } },
      },
      select: { id: true },
    });
    if (!home) throw new ForbiddenException('Access denied');
    return home;
  }
}
