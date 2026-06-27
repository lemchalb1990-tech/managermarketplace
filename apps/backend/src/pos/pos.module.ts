import { Module } from '@nestjs/common';
import { PosController } from './pos.controller';
import { PosService } from './pos.service';
import { PrismaModule } from '../prisma/prisma.module';
import { EcommerceModule } from '../ecommerce/ecommerce.module';

@Module({
  imports: [PrismaModule, EcommerceModule],  // EcommerceModule exports SyncService
  controllers: [PosController],
  providers: [PosService],
  exports: [PosService],
})
export class PosModule {}
