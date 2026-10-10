import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CouriersController } from './couriers.controller';
import { CouriersService } from './couriers.service';

@Module({
  imports: [PrismaModule],
  controllers: [CouriersController],
  providers: [CouriersService],
})
export class CouriersModule {}
