import { Module } from '@nestjs/common';
import { AccessProfilesService } from './access-profiles.service';
import { AccessProfilesController } from './access-profiles.controller';

@Module({
  providers: [AccessProfilesService],
  controllers: [AccessProfilesController],
  exports: [AccessProfilesService],
})
export class AccessProfilesModule {}
