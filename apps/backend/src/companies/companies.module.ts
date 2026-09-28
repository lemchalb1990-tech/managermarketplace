import { Module } from '@nestjs/common';
import { CompaniesService } from './companies.service';
import { CompaniesController } from './companies.controller';
import { CompanyClosureService } from './company-closure.service';
import { CompanyClosureController } from './company-closure.controller';
import { PurchasesModule } from '../purchases/purchases.module';

@Module({
  imports: [PurchasesModule],
  providers: [CompaniesService, CompanyClosureService],
  controllers: [CompaniesController, CompanyClosureController],
  exports: [CompaniesService],
})
export class CompaniesModule {}
