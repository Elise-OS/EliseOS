import { Injectable, OnModuleInit } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import { PrismaService } from './prisma.service';

@Injectable()
export class SeedService implements OnModuleInit {
  public constructor(private readonly prisma: PrismaService) {}

  public async onModuleInit(): Promise<void> {
    if (process.env.MICHEL_DEMO_MODE !== 'true') return;
    if ((await this.prisma.organization.count()) > 0) return;

    const passwordHash = await hash(process.env.DEMO_PASSWORD ?? 'Michel-Demo-2026!');
    await this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: { id: 'org_demo', name: 'Famille Martin' },
      });
      const home = await tx.home.create({
        data: {
          id: 'home_demo',
          organizationId: organization.id,
          name: 'Maison de Madeleine',
          learningStartedAt: new Date(),
        },
      });
      const resident = await tx.resident.create({
        data: { homeId: home.id, displayName: 'Madeleine', birthYear: 1942 },
      });
      await tx.home.update({ where: { id: home.id }, data: { primaryResidentId: resident.id } });
      const user = await tx.user.create({
        data: { email: 'paul@michel.local', displayName: 'Paul Martin', passwordHash },
      });
      await tx.membership.create({
        data: { organizationId: organization.id, userId: user.id, systemRole: 'OWNER' },
      });
      await tx.caregiverProfile.create({
        data: { userId: user.id, residentId: resident.id, relation: 'Petit-fils', isPrimary: true },
      });
      const rooms = await Promise.all(
        [
          ['Salon', 'LIVING_ROOM'],
          ['Cuisine', 'KITCHEN'],
          ['Chambre', 'BEDROOM'],
          ['Salle de bain', 'BATHROOM'],
          ['Entrée', 'ENTRANCE'],
        ].map(([name, kind]) =>
          tx.room.create({ data: { homeId: home.id, name: name!, kind: kind! } }),
        ),
      );
      const now = Date.now();
      const samples = [
        ['motion', 'binary_sensor.cuisine_motion', 12, rooms[1]?.id, { active: true }],
        ['contact', 'binary_sensor.entree_door', 64, rooms[4]?.id, { open: false }],
        ['motion', 'binary_sensor.salon_motion', 132, rooms[0]?.id, { active: true }],
        ['temperature', 'sensor.salon_temperature', 8, rooms[0]?.id, { value: 21.4, unit: '°C' }],
        ['humidity', 'sensor.chambre_humidity', 18, rooms[2]?.id, { value: 48, unit: '%' }],
        ['battery', 'sensor.entree_battery', 45, rooms[4]?.id, { value: 82, unit: '%' }],
      ] as const;
      for (const [capability, entityId, minutesAgo, roomId, payload] of samples) {
        const sensor = await tx.sensor.create({
          data: {
            homeId: home.id,
            roomId: roomId ?? null,
            entityId,
            capability,
            status: 'ONLINE',
            lastSeenAt: new Date(now - minutesAgo * 60_000),
          },
        });
        await tx.observationEvent.create({
          data: {
            homeId: home.id,
            sensorId: sensor.id,
            sourceEventId: `demo-${capability}-${minutesAgo}`,
            capability,
            quality: 'good',
            payload,
            occurredAt: new Date(now - minutesAgo * 60_000),
            receivedAt: new Date(now - minutesAgo * 60_000),
          },
        });
      }
      await tx.configurationRevision.create({
        data: {
          homeId: home.id,
          version: 1,
          settings: { wakeTime: '07:00', sleepTime: '22:00', inactivityMinutes: 180, locale: 'fr' },
        },
      });
      await tx.journalEntry.create({
        data: {
          homeId: home.id,
          kind: 'DAILY_SUMMARY',
          title: 'Tout semble normal',
          body: 'Michel dispose de suffisamment de données pour évaluer la matinée.',
        },
      });
      await tx.alert.create({
        data: {
          homeId: home.id,
          type: 'DOOR_OPEN',
          severity: 'INFO',
          status: 'RESOLVED',
          title: 'Porte d’entrée ouverte',
          explanation: 'La porte est restée ouverte quelques minutes puis a été refermée.',
          openedAt: new Date(now - 22 * 3_600_000),
          resolvedAt: new Date(now - 21.8 * 3_600_000),
        },
      });
      await tx.visit.create({
        data: {
          homeId: home.id,
          visitorName: 'Sophie Martin',
          startsAt: new Date(now + 26 * 3_600_000),
          endsAt: new Date(now + 28 * 3_600_000),
          notes: 'Visite familiale',
        },
      });
      await tx.appointment.create({
        data: {
          homeId: home.id,
          title: 'Rendez-vous médecin',
          startsAt: new Date(now + 4 * 86_400_000),
          location: 'Cabinet médical',
          notes: 'Prévoir la carte Vitale',
        },
      });
    });
  }
}
