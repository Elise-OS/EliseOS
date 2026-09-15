import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Client } from 'pg';
import { from, interval, map, merge, Observable, of, Subject, switchMap, filter } from 'rxjs';
import { PrismaService } from '../../platform/prisma.service';

interface DatabaseNotification {
  homeId: string;
  type:
    | 'activity'
    | 'alerts'
    | 'household'
    | 'journal'
    | 'schedule'
    | 'medications'
    | 'presence'
    | 'screen';
  entityId?: string;
}

@Injectable()
export class RealtimeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeService.name);
  private readonly updates = new Subject<DatabaseNotification>();
  private client: Client | null = null;

  public constructor(private readonly prisma: PrismaService) {}

  public async onModuleInit(): Promise<void> {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) return;
    this.client = new Client({ connectionString });
    this.client.on('notification', (message) => {
      if (!message.payload) return;
      try {
        this.updates.next(JSON.parse(message.payload) as DatabaseNotification);
      } catch {
        this.logger.warn('Notification temps réel invalide ignorée');
      }
    });
    this.client.on('error', (error) =>
      this.logger.error('Canal temps réel PostgreSQL interrompu', error),
    );
    await this.client.connect();
    await this.client.query('LISTEN michel_updates');
  }

  public async onModuleDestroy(): Promise<void> {
    this.updates.complete();
    await this.client?.end();
  }

  public forUser(userId: string): Observable<{ data: unknown }> {
    return from(
      this.prisma.home.findFirst({
        where: { organization: { memberships: { some: { userId, disabledAt: null } } } },
        select: { id: true },
      }),
    ).pipe(
      switchMap((home) => {
        const now = () => new Date().toISOString();
        const initial = of({ data: { type: 'connected', timestamp: now() } });
        const heartbeat = interval(15_000).pipe(
          map(() => ({ data: { type: 'heartbeat', timestamp: now() } })),
        );
        const updates = this.updates.pipe(
          filter((event) => Boolean(home && event.homeId === home.id)),
          map((event) => ({
            data: { type: event.type, entityId: event.entityId, timestamp: now() },
          })),
        );
        return merge(initial, heartbeat, updates);
      }),
    );
  }
}
