import { Injectable, OnModuleInit } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import { PrismaService } from './prisma.service';

const DEMO_IDS = {
  organization: 'org_demo',
  home: 'home_demo',
  resident: 'resident_demo',
  user: 'user_demo_paul',
} as const;

function relativeDate(
  reference: number,
  input: { days?: number; hours?: number; minutes?: number },
) {
  const offset =
    (input.days ?? 0) * 86_400_000 + (input.hours ?? 0) * 3_600_000 + (input.minutes ?? 0) * 60_000;
  return new Date(reference + offset);
}

@Injectable()
export class SeedService implements OnModuleInit {
  public constructor(private readonly prisma: PrismaService) {}

  public async onModuleInit(): Promise<void> {
    if (process.env.MICHEL_DEMO_MODE !== 'true') return;
    if ((await this.prisma.organization.count()) > 0) return;

    const passwordHash = await hash(process.env.DEMO_PASSWORD ?? 'Michel-Demo-2026!');
    const now = Date.now();
    await this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: { id: DEMO_IDS.organization, name: 'Famille Martin' },
      });
      const home = await tx.home.create({
        data: {
          id: DEMO_IDS.home,
          organizationId: organization.id,
          name: 'Maison de Madeleine',
          type: 'Maison',
          address: '12 rue des Tilleuls, 31000 Toulouse',
          floorCount: 1,
          installationStatus: 'LEARNING',
          learningStartedAt: relativeDate(now, { days: -6 }),
        },
      });
      const resident = await tx.resident.create({
        data: {
          id: DEMO_IDS.resident,
          homeId: home.id,
          displayName: 'Madeleine Martin',
          firstName: 'Madeleine',
          lastName: 'Martin',
          preferredName: 'Madeleine',
          birthYear: 1942,
          birthDate: new Date('1942-04-18T12:00:00.000Z'),
          spokenLanguage: 'Français',
          formOfAddress: 'Madame',
        },
      });
      await tx.home.update({ where: { id: home.id }, data: { primaryResidentId: resident.id } });

      const user = await tx.user.create({
        data: {
          id: DEMO_IDS.user,
          email: 'paul@michel.local',
          displayName: 'Paul Martin',
          passwordHash,
        },
      });
      await tx.membership.create({
        data: { organizationId: organization.id, userId: user.id, systemRole: 'OWNER' },
      });
      await tx.caregiverProfile.create({
        data: { userId: user.id, residentId: resident.id, relation: 'Petit-fils', isPrimary: true },
      });
      await tx.residentContext.create({
        data: {
          residentId: resident.id,
          livesAlone: true,
          receivesHomeHelp: true,
          receivesVisits: true,
          hasPet: true,
          mobility: 'CANE',
          hearingDifficulty: true,
        },
      });
      await tx.supportNeed.createMany({
        data: [
          { id: 'support_demo_fall', residentId: resident.id, kind: 'FALL_RISK' },
          {
            id: 'support_demo_hearing',
            residentId: resident.id,
            kind: 'HEARING',
            note: 'Appareil auditif en journée',
          },
        ],
      });
      await tx.trustedContact.createMany({
        data: [
          {
            id: 'contact_demo_paul',
            homeId: home.id,
            residentId: resident.id,
            userId: user.id,
            firstName: 'Paul',
            lastName: 'Martin',
            phone: '+33 6 12 34 56 78',
            email: 'paul@michel.local',
            relation: 'Petit-fils',
            isEmergency: true,
            priority: 1,
          },
          {
            id: 'contact_demo_sophie',
            homeId: home.id,
            residentId: resident.id,
            firstName: 'Sophie',
            lastName: 'Martin',
            phone: '+33 6 87 65 43 21',
            email: 'sophie@example.test',
            relation: 'Fille',
            isEmergency: true,
            priority: 2,
          },
          {
            id: 'contact_demo_claire',
            homeId: home.id,
            residentId: resident.id,
            firstName: 'Claire',
            lastName: 'Bernard',
            phone: '+33 5 61 00 00 00',
            relation: 'Aide à domicile',
            isEmergency: false,
            priority: 3,
          },
        ],
      });
      await tx.habitProfile.createMany({
        data: [
          {
            id: 'habit_demo_wakeup',
            homeId: home.id,
            residentId: resident.id,
            kind: 'WAKE_TIME',
            status: 'CONFIRMED',
            source: 'USER',
            startMinute: 420,
            endMinute: 480,
            parameters: { label: 'Lever habituel' },
            confidence: 0.93,
          },
          {
            id: 'habit_demo_lunch',
            homeId: home.id,
            residentId: resident.id,
            kind: 'LUNCH',
            status: 'CONFIRMED',
            source: 'LEARNED',
            startMinute: 720,
            endMinute: 780,
            parameters: { room: 'Cuisine' },
            confidence: 0.88,
          },
          {
            id: 'habit_demo_sleep',
            homeId: home.id,
            residentId: resident.id,
            kind: 'SLEEP_TIME',
            status: 'LEARNING',
            source: 'LEARNED',
            startMinute: 1_290,
            endMinute: 1_350,
            parameters: { label: 'Coucher observé' },
            confidence: 0.72,
          },
        ],
      });

      const rooms = [
        { id: 'room_demo_living', name: 'Salon', kind: 'LIVING_ROOM', sortOrder: 0 },
        { id: 'room_demo_kitchen', name: 'Cuisine', kind: 'KITCHEN', sortOrder: 1 },
        { id: 'room_demo_bedroom', name: 'Chambre', kind: 'BEDROOM', sortOrder: 2 },
        { id: 'room_demo_bathroom', name: 'Salle de bain', kind: 'BATHROOM', sortOrder: 3 },
        { id: 'room_demo_entrance', name: 'Entrée', kind: 'ENTRANCE', sortOrder: 4 },
      ] as const;
      for (const room of rooms) await tx.room.create({ data: { ...room, homeId: home.id } });

      const devices = [
        { id: 'device_demo_living', roomId: 'room_demo_living', name: 'Capteur du salon' },
        { id: 'device_demo_kitchen', roomId: 'room_demo_kitchen', name: 'Capteur de la cuisine' },
        { id: 'device_demo_bedroom', roomId: 'room_demo_bedroom', name: 'Capteur de la chambre' },
        {
          id: 'device_demo_bathroom',
          roomId: 'room_demo_bathroom',
          name: 'Capteur de la salle de bain',
        },
        { id: 'device_demo_entrance', roomId: 'room_demo_entrance', name: 'Capteur de l’entrée' },
      ] as const;
      for (const device of devices) {
        await tx.device.create({
          data: {
            ...device,
            homeId: home.id,
            sourceDeviceId: device.id,
            manufacturer: 'Élise Démo',
            model: 'Capteur virtuel',
            protocol: 'demo',
            integration: 'simulator',
            installationStatus: 'OPERATIONAL',
            placementConfirmedAt: relativeDate(now, { days: -6 }),
            lastSeenAt: relativeDate(now, { minutes: -2 }),
          },
        });
      }

      const samples = [
        [
          'sensor_demo_kitchen_motion',
          'motion',
          'binary_sensor.cuisine_motion',
          12,
          'room_demo_kitchen',
          'device_demo_kitchen',
          { active: true },
        ],
        [
          'sensor_demo_entrance_contact',
          'contact',
          'binary_sensor.entree_door',
          64,
          'room_demo_entrance',
          'device_demo_entrance',
          { open: false },
        ],
        [
          'sensor_demo_living_motion',
          'motion',
          'binary_sensor.salon_motion',
          32,
          'room_demo_living',
          'device_demo_living',
          { active: true },
        ],
        [
          'sensor_demo_living_temperature',
          'temperature',
          'sensor.salon_temperature',
          8,
          'room_demo_living',
          'device_demo_living',
          { value: 21.4, unit: '°C' },
        ],
        [
          'sensor_demo_bedroom_humidity',
          'humidity',
          'sensor.chambre_humidity',
          18,
          'room_demo_bedroom',
          'device_demo_bedroom',
          { value: 48, unit: '%' },
        ],
        [
          'sensor_demo_bathroom_motion',
          'motion',
          'binary_sensor.salle_de_bain_motion',
          52,
          'room_demo_bathroom',
          'device_demo_bathroom',
          { active: true },
        ],
        [
          'sensor_demo_entrance_battery',
          'battery',
          'sensor.entree_battery',
          45,
          'room_demo_entrance',
          'device_demo_entrance',
          { value: 82, unit: '%' },
        ],
      ] as const;
      for (const [id, capability, entityId, minutesAgo, roomId, deviceId, payload] of samples) {
        const sensor = await tx.sensor.create({
          data: {
            id,
            homeId: home.id,
            roomId,
            deviceId,
            entityId,
            sourceName: entityId,
            capability,
            status: 'ONLINE',
            compatibility: 'VALIDATED',
            available: true,
            analysisEnabled: true,
            lastSeenAt: relativeDate(now, { minutes: -Math.min(minutesAgo, 5) }),
          },
        });
        await tx.observationEvent.create({
          data: {
            id: `event_demo_${id}`,
            homeId: home.id,
            sensorId: sensor.id,
            roomId,
            roomSource: 'SENSOR',
            roomConfidence: 'HIGH',
            sourceEventId: `demo-${capability}-${minutesAgo}`,
            capability,
            quality: 'good',
            payload,
            occurredAt: relativeDate(now, { minutes: -minutesAgo }),
            receivedAt: relativeDate(now, { minutes: -minutesAgo }),
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
      await tx.journalEntry.createMany({
        data: [
          {
            id: 'journal_demo_today',
            homeId: home.id,
            kind: 'DAILY_SUMMARY',
            title: 'Tout semble normal',
            body: 'Madeleine a suivi son rythme habituel ce matin.',
            occurredAt: relativeDate(now, { hours: -1 }),
          },
          {
            id: 'journal_demo_visit',
            homeId: home.id,
            authorId: user.id,
            kind: 'NOTE',
            title: 'Passage de Claire',
            body: 'Courses rangées et pilulier préparé pour la semaine.',
            occurredAt: relativeDate(now, { days: -1, hours: -2 }),
          },
        ],
      });
      await tx.alert.createMany({
        data: [
          {
            id: 'alert_demo_temperature',
            homeId: home.id,
            roomId: 'room_demo_living',
            type: 'TEMPERATURE',
            severity: 'ATTENTION',
            status: 'OPEN',
            title: 'Température à surveiller',
            explanation: 'Le salon a été momentanément plus frais que d’habitude ce matin.',
            confidence: 0.86,
            ruleKey: 'demo:temperature',
            openedAt: relativeDate(now, { hours: -2 }),
          },
          {
            id: 'alert_demo_door',
            homeId: home.id,
            roomId: 'room_demo_entrance',
            type: 'DOOR_OPEN',
            severity: 'INFO',
            status: 'RESOLVED',
            title: 'Porte d’entrée ouverte',
            explanation: 'La porte est restée ouverte quelques minutes puis a été refermée.',
            openedAt: relativeDate(now, { hours: -22 }),
            resolvedAt: relativeDate(now, { hours: -21, minutes: -48 }),
          },
        ],
      });
      await tx.visit.create({
        data: {
          id: 'visit_demo_sophie',
          homeId: home.id,
          visitorName: 'Sophie Martin',
          startsAt: relativeDate(now, { hours: 26 }),
          endsAt: relativeDate(now, { hours: 28 }),
          notes: 'Visite familiale',
        },
      });
      await tx.appointment.create({
        data: {
          id: 'appointment_demo_doctor',
          homeId: home.id,
          title: 'Rendez-vous médecin',
          startsAt: relativeDate(now, { days: 4 }),
          location: 'Cabinet médical',
          notes: 'Prévoir la carte Vitale',
        },
      });

      await tx.medication.createMany({
        data: [
          {
            id: 'medication_demo_morning',
            homeId: home.id,
            residentId: resident.id,
            name: 'Traitement tension',
            dosage: '1 comprimé',
            instructions: 'À prendre au petit-déjeuner avec un verre d’eau.',
          },
          {
            id: 'medication_demo_evening',
            homeId: home.id,
            residentId: resident.id,
            name: 'Vitamine D',
            dosage: '2 gouttes',
            instructions: 'À prendre pendant le dîner.',
          },
        ],
      });
      await tx.medicationSchedule.createMany({
        data: [
          {
            id: 'schedule_demo_morning',
            medicationId: 'medication_demo_morning',
            minuteOfDay: 480,
            daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
            graceMinutes: 60,
          },
          {
            id: 'schedule_demo_evening',
            medicationId: 'medication_demo_evening',
            minuteOfDay: 1_140,
            daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
            graceMinutes: 90,
          },
        ],
      });
      await tx.medicationDose.createMany({
        data: [
          {
            id: 'dose_demo_taken',
            scheduleId: 'schedule_demo_morning',
            scheduledFor: relativeDate(now, { days: -1, hours: -2 }),
            status: 'TAKEN',
            confirmedAt: relativeDate(now, { days: -1, hours: -1, minutes: -50 }),
            confirmedById: user.id,
            note: 'Prise confirmée par Paul',
          },
          {
            id: 'dose_demo_missed',
            scheduleId: 'schedule_demo_evening',
            scheduledFor: relativeDate(now, { days: -2, hours: -1 }),
            status: 'MISSED',
            note: 'Prise non confirmée',
          },
          {
            id: 'dose_demo_pending',
            scheduleId: 'schedule_demo_evening',
            scheduledFor: relativeDate(now, { hours: 4 }),
            status: 'PENDING',
          },
        ],
      });
    });
  }
}
