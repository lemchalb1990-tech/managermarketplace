import { Module } from '@nestjs/common';
import { EcommerceModule } from '../ecommerce/ecommerce.module';
import { OrderAuditService } from './order-audit.service';
import { OrderAuditController } from './order-audit.controller';

@Module({
  imports: [EcommerceModule],
  providers: [OrderAuditService],
  controllers: [OrderAuditController],
})
export class OrderAuditModule {}
