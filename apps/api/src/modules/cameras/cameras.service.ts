import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  StreamableFile,
} from '@nestjs/common';
import {
  cameraConfigurationSchema,
  cameraNetworkConfigurationSchema,
  cameraPrivacySchema,
  type CameraConfiguration,
} from '@michel/contracts';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Prisma, type MembershipRole } from '@prisma/client';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { parseRequest } from '../../platform/zod-validation';
import { PrismaService } from '../../platform/prisma.service';
import { rolesFor } from '../auth/access-policy';
import { MqttIngestionService } from '../sensing/mqtt-ingestion.service';
import { decryptCameraSecret, encryptCameraSecret } from './camera-crypto';
import { discoverOnvifStreams } from './camera-onvif';
import { CameraNetworkDiscoveryService } from './camera-network-discovery.service';

const VIEW_ROLES = rolesFor('cameras:view');
const PRIVACY_ROLES = rolesFor('cameras:privacy');
const ADMIN_ROLES = rolesFor('cameras:manage');
const SESSION_SECONDS = 5 * 60;

type Ticket = { cameraId: string; streamKey: string; talk: boolean; exp: number };

@Injectable()
export class CamerasService implements OnModuleInit, OnModuleDestroy {
  private cleanupTimer?: NodeJS.Timeout;
  private healthTimer?: NodeJS.Timeout;
  private readonly go2rtcUrl = process.env.GO2RTC_URL ?? 'http://go2rtc:1984';
  private readonly mediaRoot = path.resolve(
    process.env.CAMERA_MEDIA_ROOT ?? '/var/lib/elise/camera-media',
  );

  public constructor(
    private readonly prisma: PrismaService,
    private readonly mqtt: MqttIngestionService,
    private readonly networkDiscovery: CameraNetworkDiscoveryService = new CameraNetworkDiscoveryService(),
  ) {}

  public async onModuleInit(): Promise<void> {
    await fs.mkdir(this.mediaRoot, { recursive: true });
    await this.reconcileStreams();
    this.cleanupTimer = setInterval(() => void this.cleanupExpiredSnapshots(), 15 * 60_000);
    this.cleanupTimer.unref();
    this.healthTimer = setInterval(() => void this.refreshCameraHealth(), 60_000);
    this.healthTimer.unref();
  }

  public onModuleDestroy(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    if (this.healthTimer) clearInterval(this.healthTimer);
  }

  public async list(userId: string) {
    const home = await this.homeFor(userId, VIEW_ROLES);
    const cameras = await this.prisma.camera.findMany({
      where: { homeId: home.id },
      include: { room: true },
      orderBy: [{ room: { sortOrder: 'asc' } }, { name: 'asc' }],
    });
    return cameras.map((camera) => this.present(camera));
  }

  public async discoverNetwork(userId: string) {
    await this.homeFor(userId, ADMIN_ROLES);
    return this.networkDiscovery.discover();
  }

  public async createNetworkCamera(userId: string, body: unknown) {
    const input = parseRequest(cameraNetworkConfigurationSchema, body);
    const home = await this.homeFor(userId, ADMIN_ROLES);
    const room = await this.prisma.room.findFirst({
      where: { id: input.roomId, homeId: home.id },
    });
    if (!room) throw new NotFoundException('Pièce introuvable.');
    await this.networkDiscovery.verifyTarget(input.address, input.rtspPort);
    const discovered = await discoverOnvifStreams(input.address, input.username, input.password);
    const fallbackPaths = [
      '/cam/realmonitor?channel=1&subtype=0',
      '/Streaming/Channels/101',
      '/live/ch00_0',
      '/stream1',
      '/h264Preview_01_main',
    ];
    const streamCandidates = [
      ...discovered.streamUris,
      ...fallbackPaths.map((path) => `rtsp://${input.address}:${input.rtspPort}${path}`),
    ];
    let streamUrl: string | undefined;
    for (const candidate of [...new Set(streamCandidates)]) {
      try {
        const authenticated = await this.authenticatedNetworkStreamUrl(candidate, input);
        await this.verifyNetworkStream(authenticated);
        streamUrl = authenticated;
        break;
      } catch {
        // Try the next automatically discovered ONVIF profile or common RTSP path.
      }
    }
    if (!streamUrl) {
      throw new BadRequestException(
        'Élise n’a pas trouvé de flux vidéo utilisable. Vérifiez le mot de passe local et que ONVIF ou RTSP est activé dans l’application de la caméra.',
      );
    }
    const resolvedStream = new URL(streamUrl);
    const streamKey = `camera_${randomUUID().replaceAll('-', '')}`;
    const streamEntityId = `network:${createHash('sha256')
      .update(
        `${input.address}:${resolvedStream.port || input.rtspPort}${resolvedStream.pathname}${resolvedStream.search}`,
      )
      .digest('hex')}`;
    const camera = await this.prisma.camera.create({
      data: {
        homeId: home.id,
        roomId: input.roomId,
        deviceId: null,
        name: input.name,
        provider: discovered.manufacturer || input.provider,
        streamKey,
        streamEntityId,
        personEntityId: null,
        privacyEntityId: null,
        streamUrlEncrypted: encryptCameraSecret(streamUrl),
        compatibility: 'RECOGNIZED',
        liveEnabled: true,
        talkEnabled: false,
        ptzEnabled: false,
        privacySupported: false,
        snapshotEnabled: true,
        consentedAt: new Date(),
        consentedById: userId,
        status: 'UNKNOWN',
      },
      include: { room: true },
    });
    await this.audit(home.id, userId, 'CAMERA_CONFIGURED', camera.id, {
      roomId: camera.roomId,
      provider: camera.provider,
      intimateSpace: ['BEDROOM', 'BATHROOM'].includes(room.kind),
    });
    await this.syncStream(camera.id);
    return this.present(
      await this.prisma.camera.findUniqueOrThrow({
        where: { id: camera.id },
        include: { room: true },
      }),
    );
  }

  private async authenticatedNetworkStreamUrl(
    streamUri: string,
    input: ReturnType<typeof cameraNetworkConfigurationSchema.parse>,
  ): Promise<string> {
    let url: URL;
    try {
      url = new URL(streamUri);
    } catch {
      throw new BadRequestException('Adresse du flux vidéo invalide.');
    }
    if (!['rtsp:', 'rtsps:'].includes(url.protocol) || url.hostname !== input.address) {
      throw new BadRequestException('Le flux vidéo ne pointe pas vers la caméra détectée.');
    }
    const port = Number(url.port || (url.protocol === 'rtsps:' ? 322 : 554));
    if (port !== input.rtspPort) await this.networkDiscovery.verifyTarget(input.address, port);
    url.username = input.username;
    url.password = input.password;
    url.hash = '';
    return url.toString();
  }

  private async verifyNetworkStream(streamUrl: string): Promise<void> {
    const temporaryKey = `camera_setup_${randomUUID().replaceAll('-', '')}`;
    try {
      const addQuery = new URLSearchParams({ name: temporaryKey, src: streamUrl });
      const added = await fetch(`${this.go2rtcUrl}/api/streams?${addQuery}`, {
        method: 'PUT',
        signal: AbortSignal.timeout(10_000),
      });
      if (!added.ok) throw new Error('stream setup failed');
      const frameQuery = new URLSearchParams({ src: temporaryKey });
      const frame = await fetch(`${this.go2rtcUrl}/api/frame.jpeg?${frameQuery}`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!frame.ok) throw new Error('stream probe failed');
      await frame.body?.cancel();
    } catch {
      throw new BadRequestException('Le flux vidéo n’a pas pu être vérifié avec la caméra.');
    } finally {
      const removeQuery = new URLSearchParams({ src: temporaryKey });
      await fetch(`${this.go2rtcUrl}/api/streams?${removeQuery}`, {
        method: 'DELETE',
        signal: AbortSignal.timeout(3_000),
      }).catch(() => undefined);
    }
  }

  public async update(userId: string, cameraId: string, body: unknown) {
    const input = parseRequest(cameraConfigurationSchema, body);
    const home = await this.homeFor(userId, ADMIN_ROLES);
    const existing = await this.cameraForHome(home.id, cameraId);
    const links = await this.validateLinks(home.id, input);
    const camera = await this.prisma.camera.update({
      where: { id: existing.id },
      data: {
        roomId: input.roomId,
        deviceId: links.deviceId,
        name: input.name,
        provider: input.provider,
        streamEntityId: input.streamEntityId,
        personEntityId: input.personEntityId,
        privacyEntityId: input.privacyEntityId,
        streamUrlEncrypted: encryptCameraSecret(input.streamUrl),
        compatibility: input.compatibility,
        liveEnabled: input.capabilities.live,
        talkEnabled: input.capabilities.talk,
        ptzEnabled: input.capabilities.ptz,
        privacySupported: input.capabilities.privacy,
        snapshotEnabled: input.capabilities.snapshot,
        consentedAt: new Date(),
        consentedById: userId,
      },
      include: { room: true },
    });
    if (links.personSensorId) await this.mapPersonSensor(links.personSensorId);
    await this.audit(home.id, userId, 'CAMERA_UPDATED', camera.id, {
      roomId: camera.roomId,
      intimateSpace: links.intimateSpace,
    });
    await this.syncStream(camera.id);
    return this.present(camera);
  }

  public async setPrivacy(userId: string, cameraId: string, body: unknown) {
    const { enabled } = parseRequest(cameraPrivacySchema, body);
    const home = await this.homeFor(userId, PRIVACY_ROLES);
    if (!enabled) await this.homeFor(userId, ADMIN_ROLES);
    const camera = await this.cameraForHome(home.id, cameraId);
    const updated = await this.prisma.camera.update({
      where: { id: camera.id },
      data: { privacyMode: enabled },
      include: { room: true },
    });
    if (enabled) await this.removeStream(camera.streamKey);
    else await this.syncStream(camera.id);
    if (camera.privacyEntityId) {
      this.mqtt.executeHomeAssistantCommand({
        domain: 'switch',
        service: enabled ? 'turn_on' : 'turn_off',
        target: { entity_id: camera.privacyEntityId },
      });
    }
    await this.audit(
      home.id,
      userId,
      enabled ? 'CAMERA_PRIVACY_ON' : 'CAMERA_PRIVACY_OFF',
      camera.id,
      {},
    );
    return this.present(updated);
  }

  public async liveSession(userId: string, cameraId: string, talk: boolean) {
    const home = await this.homeFor(userId, VIEW_ROLES);
    if (talk) await this.homeFor(userId, PRIVACY_ROLES);
    const camera = await this.cameraForHome(home.id, cameraId);
    if (!camera.consentedAt) throw new ForbiddenException('Le consentement caméra est requis.');
    if (camera.privacyMode) throw new ForbiddenException('Le mode intimité est actif.');
    if (!camera.liveEnabled) throw new ForbiddenException('Le direct est désactivé.');
    if (talk && !camera.talkEnabled) throw new ForbiddenException('L’interphone est indisponible.');
    const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1_000);
    const ticket = this.signTicket({
      cameraId: camera.id,
      streamKey: camera.streamKey,
      talk,
      exp: Math.floor(expiresAt.getTime() / 1_000),
    });
    const query = new URLSearchParams({
      src: camera.streamKey,
      talk: talk ? '1' : '0',
      ticket,
    });
    await this.audit(
      home.id,
      userId,
      talk ? 'CAMERA_TALK_STARTED' : 'CAMERA_LIVE_OPENED',
      camera.id,
      {
        expiresAt: expiresAt.toISOString(),
      },
    );
    return {
      cameraId: camera.id,
      mediaUrl: `/camera-viewer.html?${query.toString()}`,
      expiresAt: expiresAt.toISOString(),
      talkEnabled: camera.talkEnabled,
    };
  }

  public async authorizeMedia(ticket: string, streamKey: string, talk: boolean): Promise<boolean> {
    const parsed = this.verifyTicket(ticket);
    if (
      !parsed ||
      parsed.streamKey !== streamKey ||
      parsed.talk !== talk ||
      parsed.exp <= Date.now() / 1_000
    ) {
      return false;
    }
    const camera = await this.prisma.camera.findUnique({
      where: { id: parsed.cameraId },
      select: {
        streamKey: true,
        consentedAt: true,
        privacyMode: true,
        liveEnabled: true,
        talkEnabled: true,
      },
    });
    return Boolean(
      camera &&
      camera.streamKey === streamKey &&
      camera.consentedAt &&
      !camera.privacyMode &&
      camera.liveEnabled &&
      (!talk || camera.talkEnabled),
    );
  }

  public async refreshCameraHealth(): Promise<void> {
    const cameras = await this.prisma.camera.findMany({
      where: { liveEnabled: true, privacyMode: false },
      select: { id: true, streamKey: true },
    });
    await Promise.allSettled(
      cameras.map((camera) => this.probeCamera(camera.id, camera.streamKey)),
    );
  }

  public async snapshotForAlert(userId: string, alertId: string): Promise<StreamableFile> {
    const home = await this.homeFor(userId, VIEW_ROLES);
    const snapshot = await this.prisma.cameraSnapshot.findFirst({
      where: { homeId: home.id, alertId, expiresAt: { gt: new Date() } },
      orderBy: { capturedAt: 'desc' },
    });
    if (!snapshot) throw new NotFoundException('Aucune capture disponible pour cette alerte.');
    const absolutePath = path.resolve(this.mediaRoot, snapshot.path);
    if (!absolutePath.startsWith(`${this.mediaRoot}${path.sep}`)) throw new ForbiddenException();
    await fs.access(absolutePath);
    await this.audit(home.id, userId, 'CAMERA_SNAPSHOT_VIEWED', snapshot.cameraId, {
      alertId,
      snapshotId: snapshot.id,
    });
    return new StreamableFile(createReadStream(absolutePath), {
      type: snapshot.mimeType,
      disposition: `inline; filename="alerte-${alertId}.jpg"`,
    });
  }

  public async listRecordings(userId: string) {
    const home = await this.homeFor(userId, VIEW_ROLES);
    const recordings = await this.prisma.cameraRecording.findMany({
      where: { homeId: home.id, expiresAt: { gt: new Date() } },
      orderBy: { capturedAt: 'desc' },
      take: 100,
    });
    return recordings.map((recording) => ({
      id: recording.id,
      cameraId: recording.cameraId,
      cameraName: recording.cameraName,
      roomId: recording.roomId,
      roomName: recording.roomName,
      doorName: recording.doorName,
      capturedAt: recording.capturedAt.toISOString(),
      durationSeconds: recording.durationSeconds,
      expiresAt: recording.expiresAt.toISOString(),
    }));
  }

  public async recordingVideo(userId: string, recordingId: string): Promise<StreamableFile> {
    const home = await this.homeFor(userId, VIEW_ROLES);
    const recording = await this.prisma.cameraRecording.findFirst({
      where: { id: recordingId, homeId: home.id, expiresAt: { gt: new Date() } },
    });
    if (!recording) throw new NotFoundException('Enregistrement introuvable ou expiré.');
    const absolutePath = path.resolve(this.mediaRoot, recording.path);
    if (!absolutePath.startsWith(`${this.mediaRoot}${path.sep}`)) throw new ForbiddenException();
    await fs.access(absolutePath);
    await this.audit(home.id, userId, 'CAMERA_RECORDING_VIEWED', recording.cameraId, {
      recordingId: recording.id,
      sourceEventId: recording.sourceEventId,
      doorName: recording.doorName,
    });
    return new StreamableFile(createReadStream(absolutePath), {
      type: recording.mimeType,
      disposition: `inline; filename="camera-${recording.id}.mp4"`,
    });
  }

  public async cleanupExpiredSnapshots(): Promise<void> {
    const expired = await this.prisma.cameraSnapshot.findMany({
      where: { expiresAt: { lte: new Date() } },
      select: { id: true, path: true },
      take: 200,
    });
    for (const snapshot of expired) {
      const absolutePath = path.resolve(this.mediaRoot, snapshot.path);
      if (absolutePath.startsWith(`${this.mediaRoot}${path.sep}`)) {
        await fs.rm(absolutePath, { force: true });
      }
    }
    if (expired.length) {
      await this.prisma.cameraSnapshot.deleteMany({
        where: { id: { in: expired.map((snapshot) => snapshot.id) } },
      });
    }
    const expiredRecordings = await this.prisma.cameraRecording.findMany({
      where: { expiresAt: { lte: new Date() } },
      select: { id: true, path: true },
      take: 200,
    });
    for (const recording of expiredRecordings) {
      const absolutePath = path.resolve(this.mediaRoot, recording.path);
      if (absolutePath.startsWith(`${this.mediaRoot}${path.sep}`)) {
        await fs.rm(absolutePath, { force: true });
      }
    }
    if (expiredRecordings.length) {
      await this.prisma.cameraRecording.deleteMany({
        where: { id: { in: expiredRecordings.map((recording) => recording.id) } },
      });
    }
  }

  private async reconcileStreams(): Promise<void> {
    const cameras = await this.prisma.camera.findMany({
      where: { liveEnabled: true, privacyMode: false },
      select: { id: true },
    });
    await Promise.allSettled(cameras.map((camera) => this.syncStream(camera.id)));
  }

  private async syncStream(cameraId: string): Promise<void> {
    const camera = await this.prisma.camera.findUniqueOrThrow({ where: { id: cameraId } });
    if (camera.privacyMode || !camera.liveEnabled) return;
    try {
      const query = new URLSearchParams({
        name: camera.streamKey,
        src: decryptCameraSecret(camera.streamUrlEncrypted),
      });
      const response = await fetch(`${this.go2rtcUrl}/api/streams?${query}`, { method: 'PUT' });
      if (!response.ok) throw new Error(`go2rtc returned ${response.status}`);
      await this.probeCamera(camera.id, camera.streamKey);
    } catch {
      await this.prisma.camera.update({ where: { id: camera.id }, data: { status: 'DEGRADED' } });
    }
  }

  private async probeCamera(cameraId: string, streamKey: string): Promise<void> {
    try {
      const query = new URLSearchParams({ src: streamKey });
      const response = await fetch(`${this.go2rtcUrl}/api/frame.jpeg?${query}`, {
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) throw new Error(`go2rtc probe returned ${response.status}`);
      await response.body?.cancel();
      await this.prisma.camera.update({
        where: { id: cameraId },
        data: { status: 'ONLINE', lastSeenAt: new Date() },
      });
    } catch {
      await this.prisma.camera.update({
        where: { id: cameraId },
        data: { status: 'OFFLINE' },
      });
    }
  }

  private async removeStream(streamKey: string): Promise<void> {
    const query = new URLSearchParams({ src: streamKey });
    const response = await fetch(`${this.go2rtcUrl}/api/streams?${query}`, { method: 'DELETE' });
    if (!response.ok) throw new Error(`go2rtc returned ${response.status}`);
  }

  private async validateLinks(homeId: string, input: CameraConfiguration) {
    const room = await this.prisma.room.findFirst({ where: { id: input.roomId, homeId } });
    if (!room) throw new NotFoundException('Pièce introuvable.');
    const stream = await this.prisma.sensor.findUnique({
      where: { homeId_entityId: { homeId, entityId: input.streamEntityId } },
    });
    if (!stream || stream.domain !== 'camera') {
      throw new NotFoundException('Entité caméra Home Assistant introuvable.');
    }
    let personSensorId: string | null = null;
    if (input.personEntityId) {
      const person = await this.prisma.sensor.findUnique({
        where: { homeId_entityId: { homeId, entityId: input.personEntityId } },
      });
      if (!person) throw new NotFoundException('Entité de présence caméra introuvable.');
      personSensorId = person.id;
    }
    if (input.privacyEntityId) {
      const privacy = await this.prisma.sensor.findUnique({
        where: { homeId_entityId: { homeId, entityId: input.privacyEntityId } },
      });
      if (!privacy) throw new NotFoundException('Entité de confidentialité introuvable.');
    }
    return {
      deviceId: stream.deviceId,
      personSensorId,
      intimateSpace: ['BEDROOM', 'BATHROOM'].includes(room.kind),
    };
  }

  private async mapPersonSensor(sensorId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.sensorMapping.upsert({
        where: { sensorId },
        update: { capability: 'person_presence', transform: 'ON_OFF', enabled: true },
        create: { sensorId, capability: 'person_presence', transform: 'ON_OFF', enabled: true },
      }),
      this.prisma.sensor.update({
        where: { id: sensorId },
        data: { capability: 'person_presence', compatibility: 'PARTIAL' },
      }),
    ]);
  }

  private async cameraForHome(homeId: string, cameraId: string) {
    const camera = await this.prisma.camera.findFirst({ where: { id: cameraId, homeId } });
    if (!camera) throw new NotFoundException('Caméra introuvable.');
    return camera;
  }

  private present(camera: {
    id: string;
    name: string;
    provider: string;
    status: string;
    compatibility: string;
    room: { id: string; name: string; kind: string } | null;
    liveEnabled: boolean;
    talkEnabled: boolean;
    ptzEnabled: boolean;
    privacySupported: boolean;
    snapshotEnabled: boolean;
    privacyMode: boolean;
    consentedAt: Date | null;
    lastSeenAt: Date | null;
    lastPersonSeenAt: Date | null;
  }) {
    return {
      id: camera.id,
      name: camera.name,
      provider: camera.provider,
      status: camera.status,
      compatibility: camera.compatibility,
      room: camera.room,
      capabilities: {
        live: camera.liveEnabled,
        talk: camera.talkEnabled,
        ptz: camera.ptzEnabled,
        privacy: camera.privacySupported,
        snapshot: camera.snapshotEnabled,
      },
      privacyMode: camera.privacyMode,
      consentedAt: camera.consentedAt?.toISOString() ?? null,
      lastSeenAt: camera.lastSeenAt?.toISOString() ?? null,
      lastPersonSeenAt: camera.lastPersonSeenAt?.toISOString() ?? null,
    };
  }

  private signTicket(payload: Ticket): string {
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = createHmac('sha256', this.ticketSecret()).update(encoded).digest('base64url');
    return `${encoded}.${signature}`;
  }

  private verifyTicket(ticket: string): Ticket | null {
    const [encoded, provided] = ticket.split('.');
    if (!encoded || !provided) return null;
    const expected = createHmac('sha256', this.ticketSecret()).update(encoded).digest();
    const actual = Buffer.from(provided, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    try {
      const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Ticket;
      return typeof parsed.streamKey === 'string' && typeof parsed.exp === 'number' ? parsed : null;
    } catch {
      return null;
    }
  }

  private ticketSecret(): string {
    const value = process.env.CAMERA_TICKET_KEY ?? process.env.SESSION_SECRET;
    if (!value) throw new Error('CAMERA_TICKET_KEY is required');
    return value;
  }

  private async audit(
    homeId: string,
    actorId: string,
    action: string,
    target: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: { homeId, actorId, action, target, metadata: metadata as Prisma.InputJsonObject },
    });
  }

  private async homeFor(userId: string, roles: readonly string[]) {
    const home = await this.prisma.home.findFirst({
      where: {
        organization: {
          memberships: {
            some: {
              userId,
              disabledAt: null,
              systemRole: { in: [...roles] as MembershipRole[] },
            },
          },
        },
      },
      select: { id: true },
    });
    if (!home) throw new ForbiddenException('Accès caméra refusé.');
    return home;
  }
}
