import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DiscoveryService } from './discovery.service';

@ApiTags('discovery')
@Controller('discovery')
export class DiscoveryController {
  public constructor(private readonly discovery: DiscoveryService) {}

  @Get()
  public info() {
    return this.discovery.info();
  }
}
