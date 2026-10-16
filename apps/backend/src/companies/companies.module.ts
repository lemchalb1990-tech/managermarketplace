import { Module } from '@nestjs/common';
import { CompaniesService } from './companies.service';
import { CompaniesController } from './companies.controller';
import { StorageUsageService } from './storage-usage.service';
import { StorageUsageController } from './storage-usage.controller';
import { CompanyClosureService } from './company-closure.service';
import { CompanyClosureController } from './company-closure.controller';
import { CompanyInvitationsService } from './company-invitations.service';
import { CompanyInvitationsController } from './company-invitations.controller';
import { CompanySetupController } from './company-setup.controller';
import { PurchasesModule } from '../purchases/purchases.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [PurchasesModule, EmailModule],
  providers: [CompaniesService, CompanyClosureService, CompanyInvitationsService, StorageUsageService],
  controllers: [StorageUsageController, CompaniesController, CompanyClosureController, CompanyInvitationsController, CompanySetupController],
  exports: [CompaniesService],
})
export class CompaniesModule {}
