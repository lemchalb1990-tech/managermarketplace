import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { InvitationsService } from './invitations.service';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [EmailModule],
  providers: [UsersService, InvitationsService],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule {}
