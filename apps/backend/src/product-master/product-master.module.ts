import { Module } from '@nestjs/common';
import { ProductMasterController } from './product-master.controller';
import { ProductMasterService } from './product-master.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ProductMasterController],
  providers: [ProductMasterService],
  exports: [ProductMasterService],
})
export class ProductMasterModule {}
