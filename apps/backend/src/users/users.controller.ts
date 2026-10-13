import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { UsersService } from './users.service';
import { InvitationsService } from './invitations.service';
import { UserDeletionService } from './user-deletion.service';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN)
export class UsersController {
  constructor(private service: UsersService, private invitations: InvitationsService, private deletion: UserDeletionService) {}

  @Post()
  create(@Body() dto: CreateUserDto, @CurrentUser() user: any) {
    return this.service.create(dto, user);
  }

  @Get()
  findAll(@CurrentUser() user: any) {
    return this.service.findAll(user);
  }

  // ── Invitaciones (antes de ':id' para que no se confundan con un id de usuario) ──
  @Get('invitations')
  listInvitations(@CurrentUser() user: any, @Query('companyId') companyId?: string) {
    return this.invitations.list(user, companyId);
  }

  @Post('invitations')
  invite(@CurrentUser() user: any, @Body() body: any) {
    return this.invitations.create(user, body || {});
  }

  @Post('invitations/:id/resend')
  resendInvitation(@CurrentUser() user: any, @Param('id') id: string) {
    return this.invitations.resend(user, id);
  }

  @Post('invitations/:id/link')
  invitationLink(@CurrentUser() user: any, @Param('id') id: string) {
    return this.invitations.link(user, id);
  }

  @Post('invitations/:id/cancel')
  cancelInvitation(@CurrentUser() user: any, @Param('id') id: string) {
    return this.invitations.cancel(user, id);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.findOne(id, user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto, @CurrentUser() user: any) {
    return this.service.update(id, dto, user);
  }

  // Eliminar usuario (solo Super Admin): sus registros pasan a un administrador de la empresa.
  @Get(':id/delete-preview')
  @Roles(Role.SUPER_ADMIN)
  deletePreview(@Param('id') id: string, @CurrentUser() user: any) {
    return this.deletion.preview(id, user);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN)
  remove(@Param('id') id: string, @Body() body: { targetUserId?: string; confirmEmail?: string }, @CurrentUser() user: any) {
    return this.deletion.remove(id, body || {}, user);
  }
}
