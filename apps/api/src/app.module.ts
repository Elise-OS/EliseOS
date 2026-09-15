import { ScreenService } from './modules/screen/screen.service';
import {
  ScreenController,
  ScreenDeviceController,
  ScreenMediaController,
  ScreenDeviceMediaController,
} from './modules/screen/screen.controller';
import { Module } from '@nestjs/common';
import { AlertsController } from './modules/alerts/alerts.controller';
import { AlertsService } from './modules/alerts/alerts.service';
import { AuthController } from './modules/auth/auth.controller';
import { AuthService } from './modules/auth/auth.service';
import { SessionGuard } from './modules/auth/session.guard';
import { DiscoveryController } from './modules/discovery/discovery.controller';
import { DiscoveryService } from './modules/discovery/discovery.service';
import { ActivityController } from './modules/household/activity.controller';
import { ActivityService } from './modules/household/activity.service';
import { RealtimeService } from './modules/household/realtime.service';
import { ResidentMediaController } from './modules/household/resident-media.controller';
import { ResidentMediaService } from './modules/household/resident-media.service';
import { IngestionService } from './modules/sensing/ingestion.service';
import { MqttIngestionService } from './modules/sensing/mqtt-ingestion.service';
import { SimulationController } from './modules/sensing/simulation.controller';
import { SimulationService } from './modules/sensing/simulation.service';
import { SystemController } from './modules/system/system.controller';
import { MedicationsController } from './modules/medications/medications.controller';
import { MedicationsService } from './modules/medications/medications.service';
import { EquipmentController } from './modules/equipment/equipment.controller';
import { EquipmentService } from './modules/equipment/equipment.service';
import { NotificationsController } from './modules/notifications/notifications.controller';
import { NotificationsService } from './modules/notifications/notifications.service';
import { PrismaService } from './platform/prisma.service';
import { SeedService } from './platform/seed.service';
import { CameraMediaAuthController, CamerasController } from './modules/cameras/cameras.controller';
import { CamerasService } from './modules/cameras/cameras.service';
import { SensorsController } from './modules/sensors/sensors.controller';
import { SensorsService } from './modules/sensors/sensors.service';
import { HomePlanController } from './modules/household/home-plan.controller';
import { HomePlanService } from './modules/household/home-plan.service';
import { PeopleController } from './modules/household/people.controller';
import { PeopleService } from './modules/household/people.service';
import { RemoteAccessController } from './modules/remote-access/remote-access.controller';
import { RemoteAccessService } from './modules/remote-access/remote-access.service';
import { RemoteAccessAgentClient } from './modules/remote-access/remote-access-agent.client';

@Module({
  controllers: [
    ScreenController,
    ScreenDeviceController,
    ScreenMediaController,
    ScreenDeviceMediaController,
    SystemController,
    AuthController,
    ActivityController,
    AlertsController,
    DiscoveryController,
    ResidentMediaController,
    SimulationController,
    MedicationsController,
    EquipmentController,
    NotificationsController,
    CamerasController,
    CameraMediaAuthController,
    SensorsController,
    HomePlanController,
    PeopleController,
    RemoteAccessController,
  ],
  providers: [
    ScreenService,
    PrismaService,
    SeedService,
    AuthService,
    SessionGuard,
    DiscoveryService,
    ActivityService,
    RealtimeService,
    ResidentMediaService,
    AlertsService,
    IngestionService,
    EquipmentService,
    NotificationsService,
    MqttIngestionService,
    SimulationService,
    MedicationsService,
    CamerasService,
    SensorsService,
    HomePlanService,
    PeopleService,
    RemoteAccessService,
    RemoteAccessAgentClient,
  ],
})
export class AppModule {}
