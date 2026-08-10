import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  alertRuleSettingsSchema,
  DEFAULT_ALERT_RULE_SETTINGS,
  type AlertRuleSettings,
} from '@michel/contracts';
import { PrismaService } from '../../platform/prisma.service';

@Injectable()
export class AlertsService {
  public constructor(private readonly prisma: PrismaService) {}

  public list(userId: string) {
    return this.prisma.alert.findMany({
      where: { home: { organization: { memberships: { some: { userId } } } } },
      orderBy: { openedAt: 'desc' },
      take: 100,
      include: { transitions: true },
    });
  }

  public async feed(userId: string, limit: number, cursor?: string) {
    const items = await this.prisma.alert.findMany({
      where: { home: { organization: { memberships: { some: { userId } } } } },
      orderBy: [{ openedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { transitions: { orderBy: { createdAt: 'asc' } } },
    });
    const page = items.slice(0, limit);
    return { items: page, nextCursor: items.length > limit ? (page.at(-1)?.id ?? null) : null };
  }

  public async rules(userId: string): Promise<AlertRuleSettings> {
    const home = await this.administratorHome(userId);
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
              some: { userId, systemRole: { in: ['OWNER', 'ADMINISTRATOR', 'CAREGIVER'] } },
            },
          },
        },
      },
    });
    if (!alert) throw new NotFoundException('Alert not found');
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.alert.update({
        where: { id },
        data: {
          status,
          acknowledgedAt: status === 'ACKNOWLEDGED' ? now : alert.acknowledgedAt,
          resolvedAt: status === 'RESOLVED' || status === 'DISMISSED' ? now : null,
        },
      });
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
      await tx.outboxMessage.create({
        data: {
          homeId: alert.homeId,
          topic: 'push',
          payload: { event: `alert.${status.toLowerCase()}`, alertId: id },
        },
      });
      return updated;
    });
  }

  private async administratorHome(userId: string) {
    const home = await this.prisma.home.findFirst({
      where: {
        organization: {
          memberships: {
            some: { userId, systemRole: { in: ['OWNER', 'ADMINISTRATOR'] } },
          },
        },
      },
      select: { id: true },
    });
    if (!home) throw new ForbiddenException('Administrator access required');
    return home;
  }
}
