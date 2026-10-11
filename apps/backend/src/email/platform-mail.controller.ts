import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PlatformMailService } from './platform-mail.service';

// Prueba del correo de la plataforma (Configuración → Correo de la plataforma).
@Controller('platform-mail')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class PlatformMailController {
  constructor(private mail: PlatformMailService) {}

  @Post('test')
  test(@Body() body: { to: string }) {
    return this.mail.sendTest(String(body?.to || '').trim());
  }
}
