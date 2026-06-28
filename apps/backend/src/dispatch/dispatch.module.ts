import { Module } from '@nestjs/common';
import { DispatchController } from './dispatch.controller';
import { DispatchService } from './dispatch.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [DispatchController],
  providers: [DispatchService],
})
export class DispatchModule {}
